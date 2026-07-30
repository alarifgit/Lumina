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
	"errors"
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
		if err := s.ScanRoot(ctx, root); err != nil && ctx.Err() == nil {
			log.Printf("watcher: recovery scan %s: %v", root.Path, err)
		}
		s.sweepLoop(ctx, root)
		return
	}
	defer fsw.Close()

	// fsnotify is not recursive: register every existing directory,
	// then register new ones as they appear.
	if err := walkWatchDirs(root.Path, fsw.Add); err != nil {
		log.Printf("watcher: %s: initial dir registration failed (%v) — falling back to sweep", root.Path, err)
		s.setTier(root.Path, TierSweep)
		_ = fsw.Close()
		if err := s.ScanRoot(ctx, root); err != nil && ctx.Err() == nil {
			log.Printf("watcher: recovery scan %s: %v", root.Path, err)
		}
		s.sweepLoop(ctx, root)
		return
	}

	var mu sync.Mutex
	timers := map[string]*time.Timer{}
	debounce := func(path string) {
		mu.Lock()
		defer mu.Unlock()
		if t, ok := timers[path]; ok {
			t.Stop()
		}
		var timer *time.Timer
		timer = time.AfterFunc(debounceAfter, func() {
			mu.Lock()
			if timers[path] != timer {
				mu.Unlock()
				return
			}
			delete(timers, path)
			mu.Unlock()
			s.RefreshPath(path)
		})
		timers[path] = timer
	}
	fallbackToSweep := func(reason string) {
		if ctx.Err() != nil {
			return
		}
		log.Printf("watcher: %s: %s — falling back to sweep", root.Path, reason)
		s.setTier(root.Path, TierSweep)
		mu.Lock()
		for _, timer := range timers {
			timer.Stop()
		}
		clear(timers)
		mu.Unlock()
		_ = fsw.Close()
		if err := s.ScanRoot(ctx, root); err != nil && ctx.Err() == nil {
			log.Printf("watcher: recovery scan %s: %v", root.Path, err)
		}
		s.sweepLoop(ctx, root)
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
				fallbackToSweep("event channel closed")
				return
			}
			switch {
			case ev.Op&(fsnotify.Remove|fsnotify.Rename) != 0:
				if _, err := s.store.TombstonePath(ev.Name); err != nil {
					log.Printf("watcher: tombstone %s: %v", ev.Name, err)
				}
				// A renamed/removed directory may not emit an event for every
				// child, so reconcile the root once the event burst settles.
				debounce(root.Path)
			case ev.Op&(fsnotify.Create|fsnotify.Write) != 0:
				if fi, err := os.Stat(ev.Name); err == nil && fi.IsDir() {
					if ev.Op&fsnotify.Create != 0 {
						if shouldSkipDir(fi.Name()) {
							continue
						}
						if err := walkWatchDirs(ev.Name, fsw.Add); err != nil {
							fallbackToSweep("new directory registration failed: " + err.Error())
							return
						}
						// Moved-in directory trees already contain files and
						// may produce no child Create events.
						debounce(ev.Name)
					}
					continue
				}
				if library.MediaFileExts[strings.ToLower(filepath.Ext(ev.Name))] {
					debounce(ev.Name)
				}
			}

		case err, ok := <-fsw.Errors:
			if !ok {
				fallbackToSweep("error channel closed")
				return
			}
			if errors.Is(err, fsnotify.ErrEventOverflow) {
				fallbackToSweep("event queue overflow")
				return
			}
			log.Printf("watcher: %s: %v", root.Path, err)
		}
	}
}

// walkWatchDirs registers root and every existing descendant directory.
// fsnotify is not recursive, and moved-in trees may arrive fully populated.
func walkWatchDirs(root string, add func(string) error) error {
	return filepath.WalkDir(root, func(path string, d os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if !d.IsDir() {
			return nil
		}
		if path != root && shouldSkipDir(d.Name()) {
			return filepath.SkipDir
		}
		return add(path)
	})
}
