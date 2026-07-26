// Package api exposes Lumina's HTTP surface: the native /api/v1 API,
// the /hooks/arr webhook endpoint, and the Emby/Jellyfin compatibility
// shim that lets Radarr/Sonarr (and later Jellyseerr, Bazarr, …) treat
// Lumina as a first-class citizen.
package api

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/lumina-media/lumina/internal/arr"
	"github.com/lumina-media/lumina/internal/config"
	"github.com/lumina-media/lumina/internal/library"
	"github.com/lumina-media/lumina/internal/metadata"
	"github.com/lumina-media/lumina/internal/scanner"
	"github.com/lumina-media/lumina/internal/transcode"
)

const ServerVersion = "0.0.1"

type Server struct {
	cfg        config.Config
	configPath string
	store      library.Store
	sc         *scanner.Scanner
	caps       transcode.Capabilities
	tm         *transcode.Manager
	mw         *metadata.Worker
	http       *http.Server

	// Periodic Plex watch-state pull. plexSyncMu also guards against a
	// manual import overlapping the loop (imports are not re-entrant).
	plexSyncMu      sync.Mutex
	plexSyncLast    time.Time
	plexSyncSummary string
	plexReport      *plexSyncReportView // digest of the last import, for the UI
}

func New(cfg config.Config, configPath string, store library.Store, sc *scanner.Scanner, caps transcode.Capabilities, tm *transcode.Manager, mw *metadata.Worker) *Server {
	s := &Server{cfg: cfg, configPath: configPath, store: store, sc: sc, caps: caps, tm: tm, mw: mw}
	mux := http.NewServeMux()

	// Native API
	mux.HandleFunc("GET /healthz", s.healthz)
	mux.HandleFunc("GET /api/v1/libraries", s.listLibraries)
	mux.HandleFunc("POST /api/v1/config/libraries", s.saveLibraries)
	mux.HandleFunc("GET /api/v1/items", s.listItems)
	mux.HandleFunc("GET /api/v1/items/{id}", s.getItem)
	mux.HandleFunc("GET /api/v1/items/{id}/info", s.itemInfo)
	mux.HandleFunc("GET /api/v1/items/{id}/stream", s.directStream)
	mux.HandleFunc("GET /api/v1/items/{id}/hls/{file...}", s.hlsFile)
	mux.HandleFunc("GET /api/v1/system/capabilities", s.capabilities)
	mux.HandleFunc("GET /api/v1/system/sessions", s.sessions)
	mux.HandleFunc("GET /api/v1/system/sessions/debug", s.sessionsDebug)
	mux.HandleFunc("GET /api/v1/system/activity", s.activity)

	// Users + watch-state journal
	mux.HandleFunc("GET /api/v1/users", s.listUsers)
	mux.HandleFunc("POST /api/v1/users", s.createUser)
	mux.HandleFunc("GET /api/v1/users/{uid}/playheads", s.userPlayheads)
	mux.HandleFunc("GET /api/v1/users/{uid}/mylist", s.userMyList)
	mux.HandleFunc("POST /api/v1/items/{id}/mylist", s.toggleMyList)
	mux.HandleFunc("GET /api/v1/search", s.searchItems)
	mux.HandleFunc("GET /api/v1/items/{id}/playhead", s.getPlayhead)
	mux.HandleFunc("POST /api/v1/items/{id}/playhead", s.postPlayhead)
	mux.HandleFunc("GET /api/v1/items/{id}/subtitles", s.listSubtitles)
	mux.HandleFunc("GET /api/v1/items/{id}/subtitles/{subid}", s.subtitleVTT)
	mux.HandleFunc("POST /api/v1/items/{id}/metadata/refresh", s.refreshMetadata)
	mux.HandleFunc("GET /api/v1/metadata/search", s.metadataSearch)
	mux.HandleFunc("GET /api/v1/metadata/series/{tmdbId}/episodes", s.seriesEpisodes)
	mux.HandleFunc("POST /api/v1/items/{id}/identify", s.identifyItem)

	// Plex migration import
	mux.HandleFunc("GET /api/v1/plex/test", s.plexTest)
	mux.HandleFunc("POST /api/v1/plex/import", s.plexImport)
	mux.HandleFunc("GET /api/v1/config/plex", s.plexConfigGet)
	mux.HandleFunc("POST /api/v1/config/plex", s.plexConfigSave)
	mux.HandleFunc("GET /api/v1/config/arr", s.arrConfigGet)
	mux.HandleFunc("POST /api/v1/config/arr", s.arrConfigSave)
	mux.HandleFunc("GET /api/v1/plex/syncstatus", s.plexSyncStatus)
	mux.HandleFunc("POST /api/v1/metadata/rematch-unidentified", s.rematchUnidentified)

	// *arr native webhooks + outbound status
	mux.HandleFunc("POST /hooks/arr", arr.Handler(sc))
	mux.HandleFunc("GET /api/v1/arr/status", s.arrStatus)

	// Emby/Jellyfin compatibility shim (see shim.go)
	s.registerShim(mux)

	// Embedded web client (webui.go) — must be last: "GET /" is the
	// catch-all pattern.
	s.registerWebUI(mux)

	s.http = &http.Server{
		Addr:              cfg.HTTPAddr,
		Handler:           logRequests(mux),
		ReadHeaderTimeout: 10 * time.Second,
	}
	return s
}

func (s *Server) ListenAndServe() error { return s.http.ListenAndServe() }
func (s *Server) Shutdown(ctx context.Context) error {
	return s.http.Shutdown(ctx)
}

func (s *Server) healthz(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, map[string]string{"status": "ok", "version": ServerVersion})
}

func (s *Server) listLibraries(w http.ResponseWriter, _ *http.Request) {
	type lib struct {
		config.LibraryRoot
		Watcher scanner.WatcherTier `json:"watcher"`
		Items   int                 `json:"items"`
		Exists  bool                `json:"exists"`
	}
	tiers := s.sc.Tiers()

	// os.Stat on a network mount can block for seconds (NAS spin-up, SMB
	// reconnect). Sequentially that's one stall PER LIBRARY — 20s+ boots
	// were seen in the wild. Stat every root concurrently and cap the wait:
	// the page loads in the time of the SLOWEST mount, not the sum, and a
	// hung mount degrades to exists=false instead of hanging the UI.
	type statResult struct {
		i  int
		ok bool
	}
	ch := make(chan statResult, len(s.cfg.Libraries))
	for i, root := range s.cfg.Libraries {
		go func(i int, path string) {
			_, err := os.Stat(path)
			ch <- statResult{i, err == nil}
		}(i, root.Path)
	}
	exists := make([]bool, len(s.cfg.Libraries))
	deadline := time.After(4 * time.Second)
	for remaining := len(s.cfg.Libraries); remaining > 0; {
		select {
		case r := <-ch:
			exists[r.i] = r.ok
			remaining--
		case <-deadline:
			remaining = 0 // stragglers reported as not-visible
		}
	}

	out := []lib{}
	for i, root := range s.cfg.Libraries {
		out = append(out, lib{
			LibraryRoot: root,
			Watcher:     tiers[root.Path],
			Items:       len(s.store.List(root.Name)),
			Exists:      exists[i],
		})
	}
	writeJSON(w, out)
}

// saveLibraries is the admin UI's write path: validate, persist ONLY the
// libraries key to lumina.json, reconcile live watchers, then kick a scan.
func (s *Server) saveLibraries(w http.ResponseWriter, r *http.Request) {
	var libs []config.LibraryRoot
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20))
	if err := dec.Decode(&libs); err != nil {
		http.Error(w, "invalid JSON: "+err.Error(), http.StatusBadRequest)
		return
	}
	for i := range libs {
		libs[i].Name = strings.TrimSpace(libs[i].Name)
		libs[i].Path = strings.TrimSpace(libs[i].Path)
		libs[i].Kind = strings.TrimSpace(libs[i].Kind)
	}
	if err := validateLibraries(libs); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	if err := config.SaveLibraries(s.configPath, libs); err != nil {
		log.Printf("api: save libraries: %v", err)
		http.Error(w, "save config: "+err.Error(), http.StatusInternalServerError)
		return
	}

	s.cfg.Libraries = append([]config.LibraryRoot(nil), libs...)
	s.sc.SetLibraries(libs)
	for _, root := range libs {
		s.sc.Notify(root.Path) // dir → ScanRoot on the scanner event loop
	}
	s.listLibraries(w, r)
}

func validateLibraries(libs []config.LibraryRoot) error {
	seenName := map[string]bool{}
	seenPath := map[string]bool{}
	for i, lib := range libs {
		n := i + 1
		if lib.Name == "" {
			return fmt.Errorf("library %d: name is required", n)
		}
		if lib.Path == "" {
			return fmt.Errorf("library %q: path is required", lib.Name)
		}
		if !filepath.IsAbs(lib.Path) {
			return fmt.Errorf("library %q: path must be absolute inside the container (e.g. /media/movies)", lib.Name)
		}
		if lib.Kind != "movies" && lib.Kind != "tv" {
			return fmt.Errorf("library %q: kind must be \"movies\" or \"tv\"", lib.Name)
		}
		if seenName[lib.Name] {
			return fmt.Errorf("duplicate library name %q", lib.Name)
		}
		if seenPath[lib.Path] {
			return fmt.Errorf("duplicate library path %q", lib.Path)
		}
		seenName[lib.Name] = true
		seenPath[lib.Path] = true
	}
	return nil
}

func (s *Server) listItems(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, s.store.List(r.URL.Query().Get("library")))
}

func (s *Server) capabilities(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, s.caps)
}

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(v); err != nil {
		log.Printf("api: encode response: %v", err)
	}
}

func logRequests(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		next.ServeHTTP(w, r)
		log.Printf("%s %s (%s)", r.Method, r.URL.Path, time.Since(start).Round(time.Millisecond))
	})
}
