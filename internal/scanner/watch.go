// Tier 1: recursive inotify watching for local roots via fsnotify.
//
// Why debounce: an import (or a big copy) arrives as a burst of Write
// events, and hashing a half-written file would poison the content-hash
// identity. Events per path are collapsed and only fire after the file
// has been quiet for debounceAfter. (A stricter "size-stable" check is
// a possible refinement; the Tier-3 sweep and later events self-heal
// any race regardless.)
//
// Removals: fsnotify Remove/Rename tombstones the path immediately —
// the item itself is only marked missing once its last path is gone
// (store.TombstonePath), so renames followed by a Create revive it.
package scanner

import (
	"context"
	"log"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/fsnotify/fsnotify"

	"github.com/lumina-media/lumina/internal/config"
	"github.com/lumina-media/lumina/internal/library"
)

const debounceAfter = 5 * time.Second

// watchRoot runs a recursive fsnotify watcher for one local root.
// Blocks until ctx is cancelled.
func (s *Scanner) watchRoot(ctx context.Context, root config.LibraryRoot) {
	fsw, err := fsnotify.NewWatcher()
	if err != nil {
		log.Printf("watcher: %s: fsnotify unavailable (%v) — falling back to sweep", root.Path, err)
		s.setTier(root.Path, TierSweep)
		go s.sweepLoop(ctx, root)
		return
	}
	defer fsw.Close()

	// fsnotify is not recursive: register every existing directory,
	// then register new ones as they appear.
	if err := filepath.WalkDir(root.Path, func(path string, d os.DirEntry, err error) error {
		if err != nil || !d.IsDir() {
			return nil
		}
		return fsw.Add(path)
	}); err != nil {
		log.Printf("watcher: %s: initial dir registration: %v", root.Path, err)
	}

	var mu sync.Mutex
	timers := map[string]*time.Timer{}
	debounce := func(path string) {
		mu.Lock()
		defer mu.Unlock()
		if t, ok := timers[path]; ok {
			t.Stop()
		}
		timers[path] = time.AfterFunc(debounceAfter, func() {
			mu.Lock()
			delete(timers, path)
			mu.Unlock()
			s.RefreshPath(path)
		})
	}

	for {
		select {
		case <-ctx.Done():
			mu.Lock()
			for _, t := range timers {
				t.Stop()
			}
			mu.Unlock()
			return

		case ev, ok := <-fsw.Events:
			if !ok {
				return
			}
			switch {
			case ev.Op&(fsnotify.Remove|fsnotify.Rename) != 0:
				if _, err := s.store.TombstonePath(ev.Name); err != nil {
					log.Printf("watcher: tombstone %s: %v", ev.Name, err)
				}
			case ev.Op&(fsnotify.Create|fsnotify.Write) != 0:
				if fi, err := os.Stat(ev.Name); err == nil && fi.IsDir() {
					if ev.Op&fsnotify.Create != 0 {
						if err := fsw.Add(ev.Name); err != nil {
							log.Printf("watcher: watch new dir %s: %v", ev.Name, err)
						}
					}
					continue
				}
				if library.MediaFileExts[strings.ToLower(filepath.Ext(ev.Name))] {
					debounce(ev.Name)
				}
			}

		case err, ok := <-fsw.Errors:
			if !ok {
				return
			}
			log.Printf("watcher: %s: %v", root.Path, err)
		}
	}
}
