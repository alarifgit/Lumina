// Package scanner implements Lumina's event-driven, three-tier scanner.
//
// Tier 1 (inotify): local paths — recursive fsnotify watcher (watch.go).
// Tier 2 (events):  exact paths pushed by *arr webhooks / compat shim.
// Tier 3 (sweep):   mtime-based incremental walk — required because inotify
// does NOT propagate remote changes over CIFS/NFS mounts.
package scanner

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"io"
	"log"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/lumina-media/lumina/internal/config"
	"github.com/lumina-media/lumina/internal/library"
	"github.com/lumina-media/lumina/internal/metadata"
)

const hashChunk = 8 << 20 // 8 MiB head + 8 MiB tail; never hash whole files

// scanWorkers parallelises stat+hash during a walk. SMB latency, not CPU,
// is the bottleneck — 8 concurrent reads turns a multi-hour initial scan
// of a network share into something closer to wire speed.
const scanWorkers = 8

// WatcherTier reports which mechanism is live for a root — surfaced in the
// admin UI so failures are never silent (Plex's SMB "auto-detect" failure mode).
type WatcherTier string

const (
	TierInotify WatcherTier = "inotify"
	TierSweep   WatcherTier = "sweep"
)

type Scanner struct {
	mu     sync.RWMutex
	cfg    config.Config
	store  library.Store
	meta   *metadata.Worker // nil = metadata disabled
	events chan string      // Tier-2 targeted refresh queue

	tiers       map[string]WatcherTier
	baseCtx     context.Context
	rootCancels map[string]context.CancelFunc
	roots       map[string]config.LibraryRoot
}

func New(cfg config.Config, store library.Store, meta *metadata.Worker) *Scanner {
	return &Scanner{
		cfg:         cfg,
		store:       store,
		meta:        meta,
		events:      make(chan string, 256),
		tiers:       map[string]WatcherTier{},
		rootCancels: map[string]context.CancelFunc{},
		roots:       map[string]config.LibraryRoot{},
	}
}

// Notify enqueues a path for targeted refresh (Tier 2). Non-blocking:
// a burst of *arr events must never back-pressure HTTP handlers.
func (s *Scanner) Notify(path string) {
	select {
	case s.events <- path:
	default:
		log.Printf("scanner: event queue full, dropped %s", path)
	}
}

// Remove tombstones an externally-reported deleted path (Tier-2 deletes).
func (s *Scanner) Remove(path string) {
	local := s.mapPath(path)
	if _, err := s.store.TombstonePath(local); err != nil {
		log.Printf("scanner: tombstone %s: %v", local, err)
	}
}

// Tiers reports the live watcher tier per library root.
func (s *Scanner) Tiers() map[string]WatcherTier {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := make(map[string]WatcherTier, len(s.tiers))
	for k, v := range s.tiers {
		out[k] = v
	}
	return out
}

// SetLibraries replaces the configured roots and reconciles live watchers:
// new roots start immediately, removed roots are cancelled, and kind/path
// changes are treated as remove+add. Called by the admin API after the
// config file has been saved.
func (s *Scanner) SetLibraries(libs []config.LibraryRoot) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.cfg.Libraries = append([]config.LibraryRoot(nil), libs...)
	s.reconcileRootsLocked(s.baseCtx)
}

// reconcileRootsLocked starts/stops per-root watcher goroutines to match
// s.cfg.Libraries. The caller must hold s.mu. A nil base context means Run
// has not started yet; roots are recorded and started when Run begins.
func (s *Scanner) reconcileRootsLocked(base context.Context) {
	desired := make(map[string]config.LibraryRoot, len(s.cfg.Libraries))
	for _, root := range s.cfg.Libraries {
		desired[root.Path] = root
		s.tiers[root.Path] = tierFor(root.Path)
	}

	for path, cancel := range s.rootCancels {
		root, ok := desired[path]
		if !ok || root != s.roots[path] {
			cancel()
			delete(s.rootCancels, path)
			delete(s.roots, path)
			delete(s.tiers, path)
		}
	}

	for path, root := range desired {
		if _, running := s.rootCancels[path]; running {
			continue
		}
		s.roots[path] = root
		if base == nil {
			continue
		}
		ctx, cancel := context.WithCancel(base)
		s.rootCancels[path] = cancel
		switch s.tiers[path] {
		case TierInotify:
			go s.watchRoot(ctx, root)
		case TierSweep:
			go s.sweepLoop(ctx, root)
		}
	}
}

// Run starts the Tier-2 event loop and reconciles Tier-1/Tier-3 roots.
// Blocks until ctx is cancelled.
func (s *Scanner) Run(ctx context.Context) {
	s.mu.Lock()
	s.baseCtx = ctx
	s.reconcileRootsLocked(ctx)
	s.mu.Unlock()

	for {
		select {
		case <-ctx.Done():
			return
		case path := <-s.events:
			s.RefreshPath(path)
		}
	}
}

// tierFor picks the live watcher tier by inspecting the host mount table.
// Network filesystems (cifs/nfs/fuse) get Tier 3; local paths get Tier 1.
func tierFor(root string) WatcherTier {
	data, err := os.ReadFile("/proc/mounts")
	if err != nil {
		// Non-Linux (dev machines): assume local.
		return TierInotify
	}
	bestLen := -1
	tier := TierInotify
	for _, line := range strings.Split(string(data), "\n") {
		f := strings.Fields(line)
		if len(f) < 3 {
			continue
		}
		mountPoint, fsType := f[1], f[2]
		if root == mountPoint || strings.HasPrefix(root, mountPoint+"/") {
			if len(mountPoint) > bestLen {
				bestLen = len(mountPoint)
				switch fsType {
				case "cifs", "smb3", "smbfs", "nfs", "nfs4", "fuse", "fuse.rclone":
					tier = TierSweep
				default:
					tier = TierInotify
				}
			}
		}
	}
	return tier
}

// RefreshPath stats and indexes a single file — the Tier-2 fast path used
// by *arr webhooks and the Emby/Jellyfin compat shim.
func (s *Scanner) RefreshPath(path string) {
	local := s.mapPath(path)
	lib := s.libraryFor(local)
	if lib == nil {
		log.Printf("scanner: no library contains %s (mapped from %s)", local, path)
		return
	}
	fi, err := os.Stat(local)
	if err != nil {
		log.Printf("scanner: stat %s: %v", local, err)
		return
	}
	if fi.IsDir() {
		s.ScanRoot(context.Background(), *lib)
		return
	}
	if err := s.indexFile(*lib, local, fi); err != nil {
		log.Printf("scanner: index %s: %v", local, err)
	}
}

func (s *Scanner) libraryFor(path string) *config.LibraryRoot {
	s.mu.RLock()
	libs := append([]config.LibraryRoot(nil), s.cfg.Libraries...)
	s.mu.RUnlock()
	for i := range libs {
		root := libs[i]
		if path == root.Path || strings.HasPrefix(path, root.Path+string(os.PathSeparator)) {
			return &root
		}
	}
	return nil
}

func (s *Scanner) mapPath(external string) string {
	s.mu.RLock()
	cfg := s.cfg
	s.mu.RUnlock()
	return cfg.MapPath(external)
}

func (s *Scanner) setTier(path string, tier WatcherTier) {
	s.mu.Lock()
	s.tiers[path] = tier
	s.mu.Unlock()
}

func (s *Scanner) tier(path string) WatcherTier {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.tiers[path]
}

// skipDirNames are directory names that never contain library media:
// NAS/system sidecars plus Plex-style extras folders. Skipping them at walk
// time means bonus features never pollute Recently Added.
var skipDirNames = map[string]bool{
	"@eadir": true, ".appledouble": true, "#recycle": true, "$recycle.bin": true,
	"extras": true, "extra": true, "featurettes": true, "trailers": true,
	"samples": true, "sample": true, "behind the scenes": true,
	"behind-the-scenes": true, "deleted scenes": true, "interviews": true,
}

// skipFileRe drops filesystem sidecars (AppleDouble "._*", Thumbs.db) and
// sample/trailer/featurette clips.
var skipFileRe = regexp.MustCompile(`(?i)^(\..*|thumbs\.db|desktop\.ini)$|(?:^|[ ._-])(sample|trailer|featurette)(?:[ ._-]|$)`)

// ScanRoot performs an incremental walk of a library root and applies the
// tombstone rule. If the root comes up completely empty while the library
// has known items (classic dropped-SMB-mount signature), scanning halts
// instead of marking everything missing.
//
// The walk itself only collects candidates; the expensive part (stat is
// done at walk time, hashing is not) runs in a pool of scanWorkers
// goroutines. Unchanged files (size+mtime match file_states) skip the
// 16 MiB content hash entirely — that is what makes sweeps over SMB cheap.
func (s *Scanner) ScanRoot(ctx context.Context, root config.LibraryRoot) error {
	type candidate struct {
		path string
		fi   os.FileInfo
	}
	cands := make(chan candidate, 4*scanWorkers)
	present := map[string]bool{}
	var presentMu sync.Mutex

	var wg sync.WaitGroup
	for i := 0; i < scanWorkers; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for c := range cands {
				if ctx.Err() != nil {
					return
				}
				presentMu.Lock()
				present[c.path] = true
				presentMu.Unlock()
				if err := s.indexFile(root, c.path, c.fi); err != nil {
					log.Printf("scanner: index %s: %v", c.path, err)
				}
			}
		}()
	}

	walkErr := filepath.WalkDir(root.Path, func(path string, d os.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		if d.IsDir() {
			if skipDirNames[strings.ToLower(d.Name())] {
				return filepath.SkipDir
			}
			return nil
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}
		if skipFileRe.MatchString(d.Name()) {
			return nil
		}
		if !library.MediaFileExts[strings.ToLower(filepath.Ext(path))] {
			return nil
		}
		fi, err := d.Info()
		if err != nil {
			return nil
		}
		select {
		case cands <- candidate{path, fi}:
		case <-ctx.Done():
			return ctx.Err()
		}
		return nil
	})
	close(cands)
	wg.Wait()
	if walkErr != nil {
		return walkErr
	}

	if len(present) == 0 && len(s.store.List(root.Name)) > 0 {
		log.Printf("scanner: SAFETY HALT — %s appears empty but library %q has items; "+
			"tombstoning skipped (dropped mount?)", root.Path, root.Name)
		return nil
	}
	missing, err := s.store.MarkMissing(root.Name, present)
	if err != nil {
		return err
	}
	if missing > 0 {
		log.Printf("scanner: %d item(s) tombstoned in %q", missing, root.Name)
	}
	// Historic mis-merges surface as multi-path items; reconcile re-hashes
	// every path and re-homes any file whose content is not the item's.
	s.reconcileSplitPaths(ctx, root)
	return nil
}

// reconcileSplitPaths repairs historic mis-merges: items carrying several
// paths that are NOT the same content (an early scanner parked files on
// the wrong item — content-hash identity cannot produce this today, but
// the parked rows persist forever because path history is append-only).
// Genuine same-content duplicates (a file and its copy) are left attached:
// that IS the same file, whatever its name says.
func (s *Scanner) reconcileSplitPaths(ctx context.Context, root config.LibraryRoot) {
	for _, it := range s.store.List(root.Name) {
		if ctx.Err() != nil {
			return
		}
		if len(it.Paths) < 2 {
			continue
		}
		s.repairItemPaths(root, it)
	}
}

// repairItemPaths re-hashes every path of one multi-path item FRESH —
// file_states is not trusted here, it may carry the same historic damage.
// A path whose true hash is not the item's hash is detached and re-indexed,
// landing on (or creating) the item its content actually belongs to, which
// also queues it for metadata identification. If the stored hash matches
// NONE of the files, the item is re-keyed to its first path's true hash.
func (s *Scanner) repairItemPaths(root config.LibraryRoot, it library.Item) {
	type checked struct {
		path string
		hash string
		fi   os.FileInfo
	}
	all := make([]checked, 0, len(it.Paths))
	for _, p := range it.Paths {
		fi, err := os.Stat(p)
		if err != nil {
			return // a path unreadable (dropped mount?) — touch nothing
		}
		h, err := ContentHash(p, fi.Size())
		if err != nil {
			return
		}
		all = append(all, checked{p, h, fi})
	}
	ownerHash := it.Hash
	owners := 0
	for _, c := range all {
		if c.hash == ownerHash {
			owners++
		}
	}
	if owners == 0 {
		ownerHash = all[0].hash
		if err := s.store.RekeyItemHash(it.ID, ownerHash); err != nil {
			log.Printf("scanner: reconcile %s (%q): re-key refused (%v) — left as-is",
				it.ID, it.Title, err)
			return
		}
		log.Printf("scanner: reconcile %s (%q): re-keyed to %s's content hash",
			it.ID, it.Title, filepath.Base(all[0].path))
	}
	for _, c := range all {
		if c.hash == ownerHash {
			continue
		}
		// Correct the cached state FIRST so the re-index below (and every
		// future sweep's hash-skip) works from the true hash.
		if err := s.store.SetFileState(c.path, c.fi.Size(), c.fi.ModTime().Unix(), c.hash); err != nil {
			log.Printf("scanner: reconcile: record file state %s: %v", c.path, err)
			continue
		}
		if _, err := s.store.TombstonePath(c.path); err != nil {
			log.Printf("scanner: reconcile: detach %s: %v", c.path, err)
			continue
		}
		if err := s.indexFile(root, c.path, c.fi); err != nil {
			log.Printf("scanner: reconcile: re-index %s: %v", c.path, err)
			continue
		}
		log.Printf("scanner: reconcile: %s detached from %s (%q) — re-homed by content",
			filepath.Base(c.path), it.ID, it.Title)
	}
}

func (s *Scanner) sweepLoop(ctx context.Context, root config.LibraryRoot) {
	if s.tier(root.Path) != TierSweep {
		return
	}
	s.mu.RLock()
	interval := time.Duration(s.cfg.SweepIntervalMinutes) * time.Minute
	s.mu.RUnlock()
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if err := s.ScanRoot(ctx, root); err != nil {
				log.Printf("scanner: sweep %s: %v", root.Path, err)
			}
		}
	}
}

// indexFile records a media file, keyed by content hash. The hash is
// REUSED when size+mtime match the last index (file_states) — the hash
// itself is stable identity, so skipping the 16 MiB read loses nothing.
// A skipped-hash file still goes through UpsertByHash: that re-activates
// items whose file vanished and came back unchanged.
func (s *Scanner) indexFile(root config.LibraryRoot, path string, fi os.FileInfo) error {
	size, mtime := fi.Size(), fi.ModTime().Unix()
	hash := ""
	if stSize, stMtime, stHash, ok := s.store.FileState(path); ok && stSize == size && stMtime == mtime {
		hash = stHash // unchanged — skip the 16 MiB SMB read
	} else {
		var err error
		hash, err = ContentHash(path, size)
		if err != nil {
			return err
		}
		if err := s.store.SetFileState(path, size, mtime, hash); err != nil {
			log.Printf("scanner: record file state %s: %v", path, err)
		}
	}
	kind := library.KindMovie
	if root.Kind == "tv" {
		kind = library.KindEpisode
	}
	// Plex-style extras folders ("Movie Name (2019)/Featurettes/PV 1.mkv"):
	// bonus content, not a matchable title. Tag it and keep it out of the
	// TMDB queue — these files can never be "identified".
	extra := isExtrasPath(path)
	if extra {
		kind = library.KindExtra
	}
	title := strings.TrimSuffix(filepath.Base(path), filepath.Ext(path))
	it, err := s.store.UpsertByHash(hash, root.Name, func(it *library.Item) {
		it.Kind = kind
		// Never clobber a provider (TMDB) title with a filename title.
		if it.Title == "" {
			it.Title = title
		}
		it.SizeBytes = fi.Size()
		it.State = library.StateActive
		it.MissingAt = time.Time{}
		// "Recently added" should mean "recently acquired", not "when the
		// scanner happened to walk past". Items take the file's mtime when
		// it is EARLIER than what we have: new items inherit it directly,
		// and first-scan batches (which all shared one scan timestamp)
		// backfill to each file's true mod time on the next sweep. mtime
		// only ever moves added_at backwards, so this is idempotent.
		// Future-dated mtimes (clock skew) are ignored.
		if mt := fi.ModTime(); !mt.IsZero() && mt.Before(time.Now()) && mt.Before(it.AddedAt) {
			it.AddedAt = mt
		}
		for _, p := range it.Paths {
			if p == path {
				return // already tracked at this path
			}
		}
		it.Paths = append(it.Paths, path)
	})
	// Unidentified items go to the metadata worker (no-op without a
	// TMDB key; the worker also dedups naturally via SetMetadata).
	// Extras are excluded by definition — TMDB has no entry for "Official PV 2".
	if err == nil && it != nil && it.TMDBID == 0 && s.meta != nil && !extra {
		s.meta.EnqueueHint(*it, metadata.HintFor(root.Path, path, kind == library.KindEpisode))
	}
	return err
}

// extrasDirs: folder names Plex/Jellyfin treat as bonus content.
var extrasDirs = map[string]bool{
	"extras": true, "featurettes": true, "specials": true,
	"behind the scenes": true, "deleted scenes": true, "interviews": true,
	"scenes": true, "shorts": true, "trailers": true, "bloopers": true,
}

// isExtrasPath reports whether any directory component of path is an
// extras folder (case-insensitive).
func isExtrasPath(path string) bool {
	dir := filepath.Dir(path)
	for {
		base := strings.ToLower(filepath.Base(dir))
		if extrasDirs[base] {
			return true
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			return false
		}
		dir = parent
	}
}

// ContentHash is the item's identity: sha256(size ‖ head 8MiB ‖ tail 8MiB).
// Survives renames, moves, and remounts. TODO: blake3 for speed.
func ContentHash(path string, size int64) (string, error) {
	f, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer f.Close()

	h := sha256.New()
	var sizeBuf [8]byte
	for i := 0; i < 8; i++ {
		sizeBuf[i] = byte(size >> (8 * i))
	}
	h.Write(sizeBuf[:])

	head := size
	if head > hashChunk {
		head = hashChunk
	}
	if _, err := io.CopyN(h, f, head); err != nil && err != io.EOF {
		return "", err
	}
	if size > hashChunk {
		tailStart := size - hashChunk
		if tailStart < head {
			tailStart = head // small file: don't double-hash
		}
		if _, err := f.Seek(tailStart, io.SeekStart); err != nil {
			return "", err
		}
		if _, err := io.CopyN(h, f, size-tailStart); err != nil && err != io.EOF {
			return "", err
		}
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}
