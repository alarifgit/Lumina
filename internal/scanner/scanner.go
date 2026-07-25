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
	return nil
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
	if err == nil && it != nil && it.TMDBID == 0 && s.meta != nil {
		// Folder structure is the authoritative series identity for TV:
		// "/TV/Bleach/Season 17/file.mkv" → series "Bleach", season 17 —
		// regardless of how the filename itself is written. Anime files
		// without SxxExx markers get an absolute-episode hint instead
		// ("[Group] Show - 362" → E362).
		hint := metadata.IdentifyHint{}
		if kind == library.KindEpisode {
			if rel, rerr := filepath.Rel(root.Path, path); rerr == nil {
				comps := strings.Split(rel, string(filepath.Separator))
				if len(comps) >= 2 {
					folder := metadata.ParseFilename(comps[0])
					hint.Series = folder.Title
					if season := metadata.SeasonFromDir(comps[len(comps)-2]); season > 0 {
						hint.Season = season
					}
				}
			}
			base := strings.TrimSuffix(filepath.Base(path), filepath.Ext(path))
			if !episodeMarkerRe.MatchString(base) {
				hint.AbsEpisode = metadata.ParseAbsoluteEpisode(base)
			}
		}
		s.meta.EnqueueHint(*it, hint)
	}
	return err
}

var episodeMarkerRe = regexp.MustCompile(`(?i)\bs\d{1,2}\s*e\d{1,4}\b`)

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
