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

const hashChunk = 8 << 20 // fast fingerprint: 8 MiB head + 8 MiB tail

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

	// identityMu keeps candidate lookup, full verification, and upsert atomic
	// while the expensive sampled reads still run across scan workers.
	identityMu  sync.Mutex
	tiers       map[string]WatcherTier
	baseCtx     context.Context
	rootCancels map[string]context.CancelFunc
	roots       map[string]config.LibraryRoot
}

func New(cfg config.Config, store library.Store, meta *metadata.Worker) *Scanner {
	cfg.Libraries = cleanLibraryRoots(cfg.Libraries)
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
	libs = cleanLibraryRoots(libs)
	s.reconcileLibraryStore(libs)
	s.mu.Lock()
	defer s.mu.Unlock()
	s.cfg.Libraries = libs
	s.reconcileRootsLocked(s.baseCtx)
}

func cleanLibraryRoots(libs []config.LibraryRoot) []config.LibraryRoot {
	out := append([]config.LibraryRoot(nil), libs...)
	for i := range out {
		if out[i].Path != "" {
			out[i].Path = filepath.Clean(out[i].Path)
		}
	}
	return out
}

func (s *Scanner) reconcileLibraryStore(roots []config.LibraryRoot) {
	if s.store == nil {
		return
	}
	stored := make([]library.LibraryRoot, 0, len(roots))
	for _, root := range roots {
		stored = append(stored, library.LibraryRoot{
			Name: root.Name,
			Path: root.Path,
			Kind: root.Kind,
		})
	}
	result, err := s.store.ReconcileLibraries(stored)
	if err != nil {
		log.Printf("scanner: reconcile library configuration: %v", err)
		return
	}
	if result.Renamed > 0 || result.Merged > 0 || result.Retired > 0 {
		log.Printf("scanner: library configuration reconciled — %d renamed, %d history row(s) merged, %d retired",
			result.Renamed, result.Merged, result.Retired)
	}
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
	s.mu.RLock()
	roots := append([]config.LibraryRoot(nil), s.cfg.Libraries...)
	s.mu.RUnlock()
	s.reconcileLibraryStore(roots)

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
	path = filepath.Clean(path)
	for i := range libs {
		root := libs[i]
		root.Path = filepath.Clean(root.Path)
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

// skipDirNames are directory names that never contain library media.
// Extras folders are deliberately not skipped: indexFile classifies their
// contents as KindExtra and excludes them from metadata matching.
var skipDirNames = map[string]bool{
	"@eadir": true, ".appledouble": true, "#recycle": true, "$recycle.bin": true,
	"samples": true, "sample": true,
}

func shouldSkipDir(name string) bool {
	return skipDirNames[strings.ToLower(name)]
}

// System sidecars are always skipped. Release clips are allowed only inside
// recognized extras directories, where they are indexed as KindExtra.
var systemFileRe = regexp.MustCompile(`(?i)^(\..*|thumbs\.db|desktop\.ini)$`)
var releaseClipRe = regexp.MustCompile(`(?i)(?:^|[ ._-])(sample|trailer|featurette)(?:[ ._-]|$)`)

func shouldSkipFile(path, name string) bool {
	if systemFileRe.MatchString(name) {
		return true
	}
	return releaseClipRe.MatchString(name) && !isExtrasPath(path)
}

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
			if shouldSkipDir(d.Name()) {
				return filepath.SkipDir
			}
			return nil
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}
		if shouldSkipFile(path, d.Name()) {
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
	checked, rehomed, verified := 0, 0, 0
	for _, it := range s.store.List(root.Name) {
		if ctx.Err() != nil {
			return
		}
		if len(it.Paths) < 2 {
			continue
		}
		checked++
		switch n := s.repairItemPaths(root, it); {
		case n > 0:
			rehomed += n
		case n == 0:
			verified++
		}
	}
	// Always summarise: "no reconcile lines" must mean "nothing to do",
	// never "did it run?" — the line also marks the end of the boot scan.
	if checked > 0 {
		log.Printf("scanner: reconcile %q: %d multi-path item(s) checked — %d path(s) re-homed, %d item(s) verified same-content",
			root.Name, checked, rehomed, verified)
	}
}

// repairItemPaths verifies every path once, then trusts only an explicit
// full-verification marker whose size, nanosecond mtime, and canonical identity
// still match. The first path retains the item/watch history; paths with
// different bytes or conflicting parsed identities are detached and re-indexed
// under their own verified identity.
func (s *Scanner) repairItemPaths(root config.LibraryRoot, it library.Item) int {
	if s.itemPathsStillVerified(it) {
		return 0
	}
	type checked struct {
		path    string
		sample  string
		full    string
		logical string
		fi      os.FileInfo
	}
	all := make([]checked, 0, len(it.Paths))
	for _, p := range it.Paths {
		fi, err := os.Stat(p)
		if err != nil {
			log.Printf("scanner: reconcile %s (%q): stat %s: %v — skipped",
				it.ID, it.Title, p, err)
			return -1
		}
		sample, err := ContentHash(p, fi.Size())
		if err != nil {
			log.Printf("scanner: reconcile %s (%q): sample %s: %v — skipped",
				it.ID, it.Title, p, err)
			return -1
		}
		full, err := FullContentHash(p)
		if err != nil {
			log.Printf("scanner: reconcile %s (%q): full hash %s: %v — skipped",
				it.ID, it.Title, p, err)
			return -1
		}
		all = append(all, checked{p, sample, full, parsedContentIdentity(root, p), fi})
	}
	for _, c := range all {
		current, err := os.Stat(c.path)
		if err != nil {
			log.Printf("scanner: reconcile %s (%q): re-stat %s: %v — retry later",
				it.ID, it.Title, c.path, err)
			return -1
		}
		if current.IsDir() || current.Size() != c.fi.Size() || current.ModTime().UnixNano() != c.fi.ModTime().UnixNano() {
			log.Printf("scanner: reconcile %s (%q): %s changed while hashing — retry later",
				it.ID, it.Title, c.path)
			return -1
		}
	}
	owner := all[0]
	canonical := canonicalIdentity(owner.sample, owner.full, owner.logical)
	if it.Hash != canonical {
		if err := s.store.RekeyItemHash(it.ID, canonical); err != nil {
			log.Printf("scanner: reconcile %s (%q): re-key refused (%v) — left as-is",
				it.ID, it.Title, err)
			return -1
		}
		it.Hash = canonical
	}
	detached := 0
	for i, c := range all {
		if i == 0 {
			continue
		}
		sameLogical := owner.logical == "" || c.logical == "" || owner.logical == c.logical
		if c.full == owner.full && sameLogical {
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
		detached++
		log.Printf("scanner: reconcile: %s detached from %s (%q) — full hash/logical identity differs",
			filepath.Base(c.path), it.ID, it.Title)
	}
	for _, c := range all {
		sameLogical := owner.logical == "" || c.logical == "" || owner.logical == c.logical
		if c.full != owner.full || !sameLogical {
			continue
		}
		if err := s.store.SetVerifiedFileState(
			c.path, c.fi.Size(), c.fi.ModTime().UnixNano(), canonical,
		); err != nil {
			log.Printf("scanner: reconcile %s (%q): cache verified path %s: %v",
				it.ID, it.Title, c.path, err)
		}
	}
	if detached == 0 {
		log.Printf("scanner: reconcile %s (%q): all %d paths are byte-identical with compatible identities — keeping merged",
			it.ID, it.Title, len(all))
	}
	return detached
}

func (s *Scanner) itemPathsStillVerified(it library.Item) bool {
	if len(it.Paths) < 2 {
		return false
	}
	sampleEnd := strings.IndexByte(it.Hash, ':')
	if sampleEnd <= 0 {
		return false
	}
	if _, ok := verifiedFullFromIdentity(it.Hash, it.Hash[:sampleEnd]); !ok {
		return false
	}
	for _, path := range it.Paths {
		fi, err := os.Stat(path)
		if err != nil || fi.IsDir() {
			return false
		}
		size, mtime, hash, ok := s.store.VerifiedFileState(path)
		if !ok || size != fi.Size() || mtime != fi.ModTime().UnixNano() || hash != it.Hash {
			return false
		}
	}
	return true
}

func (s *Scanner) sweepLoop(ctx context.Context, root config.LibraryRoot) {
	if s.tier(root.Path) != TierSweep {
		return
	}
	s.mu.RLock()
	interval := time.Duration(s.cfg.SweepIntervalMinutes) * time.Minute
	s.mu.RUnlock()
	if interval <= 0 {
		interval = 10 * time.Minute
	}
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

// indexFile records a media file using a fast sampled fingerprint. When that
// sample already exists, resolveIdentity verifies full-file SHA-256 before
// merging; unchanged size+mtime-ns paths reuse the previously resolved key.
func (s *Scanner) indexFile(root config.LibraryRoot, path string, fi os.FileInfo) error {
	size, mtime := fi.Size(), fi.ModTime().UnixNano()
	identity := ""
	sampleHash := ""
	cached := false
	if stSize, stMtime, stHash, ok := s.store.FileState(path); ok && stSize == size && stMtime == mtime {
		identity = stHash
		cached = true
	} else {
		var err error
		sampleHash, err = ContentHash(path, size)
		if err != nil {
			return err
		}
	}

	s.identityMu.Lock()
	if !cached {
		var err error
		identity, err = s.resolveIdentity(root, path, sampleHash)
		if err != nil {
			s.identityMu.Unlock()
			return err
		}
		if err := s.store.SetFileState(path, size, mtime, identity); err != nil {
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
	it, err := s.store.UpsertByHash(identity, root.Name, func(it *library.Item) {
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
	s.identityMu.Unlock()
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
	"extras": true, "extra": true, "featurettes": true,
	"behind the scenes": true, "behind-the-scenes": true, "deleted scenes": true, "interviews": true,
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

// ContentHash is the cheap candidate fingerprint:
// sha256(size ‖ head 8MiB ‖ tail 8MiB). A collision triggers definitive
// FullContentHash verification before any merge. TODO: blake3 for speed.
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
