// Plex migration endpoints: connection test + watch-state import.
package api

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/lumina-media/lumina/internal/config"
	"github.com/lumina-media/lumina/internal/plex"
)

// GET /api/v1/config/plex — the saved Plex connection, so the settings UI
// can prefill. Local single-user server: the token round-trips in full.
func (s *Server) plexConfigGet(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, s.cfg.Plex)
}

// POST /api/v1/config/plex — persist URL + token to lumina.json (atomic
// one-key write), then use them for all future syncs.
func (s *Server) plexConfigSave(w http.ResponseWriter, r *http.Request) {
	var body config.PlexConfig
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<16)).Decode(&body); err != nil {
		http.Error(w, "invalid JSON: "+err.Error(), http.StatusBadRequest)
		return
	}
	body.URL = strings.TrimSpace(body.URL)
	body.Token = strings.TrimSpace(body.Token)
	if err := config.SavePlex(s.configPath, body); err != nil {
		http.Error(w, "save config: "+err.Error(), http.StatusInternalServerError)
		return
	}
	s.cfg.Plex = body
	writeJSON(w, body)
}

func (s *Server) plexClient(urlOverride, tokenOverride string) *plex.Client {
	url, token := urlOverride, tokenOverride
	if url == "" {
		url = s.cfg.Plex.URL
	}
	if token == "" {
		token = s.cfg.Plex.Token
	}
	return plex.NewClient(url, token)
}

// GET /api/v1/plex/test — verify connectivity; query params url/token
// override the configured ones (handy before saving config).
func (s *Server) plexTest(w http.ResponseWriter, r *http.Request) {
	c := s.plexClient(r.URL.Query().Get("url"), r.URL.Query().Get("token"))
	if !c.Available() {
		http.Error(w, "plex url+token required (query params or config)", http.StatusBadRequest)
		return
	}
	name, err := c.ServerName(r.Context())
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}
	sections, err := c.Sections(r.Context())
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}
	writeJSON(w, map[string]any{
		"serverName": name,
		"sections":   sections,
	})
}

// POST /api/v1/plex/import — preview or apply the watch-state migration.
// Body: {"userId":"usr-1","direction":"pull|push|two-way","apply":false,
//        "url":"...","token":"..."} — url/token optional if configured.
// apply=false is a pure preview with zero writes; ALWAYS preview first.
func (s *Server) plexImport(w http.ResponseWriter, r *http.Request) {
	var body struct {
		UserID    string `json:"userId"`
		Direction string `json:"direction"`
		Apply     bool   `json:"apply"`
		URL       string `json:"url"`
		Token     string `json:"token"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, "bad body", http.StatusBadRequest)
		return
	}
	c := s.plexClient(body.URL, body.Token)
	if !c.Available() {
		http.Error(w, "plex url+token required (body or config)", http.StatusBadRequest)
		return
	}
	dir := plex.Direction(body.Direction)
	switch dir {
	case plex.Pull, plex.Push, plex.TwoWay:
	default:
		dir = plex.Pull
	}
	if !s.plexSyncMu.TryLock() {
		http.Error(w, "another Plex sync is running — try again in a moment", http.StatusConflict)
		return
	}
	defer s.plexSyncMu.Unlock()
	report, err := plex.Import(r.Context(), c, s.store, body.UserID, dir, body.Apply)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}
	writeJSON(w, report)
}

// RunPlexSync periodically PULLS Plex watch state for every user, so
// Continue Watching stays warm without a manual import. Interval comes
// from plex.syncIntervalMinutes: 0 = 30-minute default, negative = off.
// The first run fires 45s after boot rather than a full interval in.
func (s *Server) RunPlexSync(ctx context.Context) {
	interval := s.cfg.Plex.SyncIntervalMinutes
	if interval == 0 {
		interval = 30
	}
	if interval < 0 {
		log.Printf("plex: periodic watch-state sync disabled")
		return
	}
	log.Printf("plex: periodic watch-state sync every %d min", interval)
	ticker := time.NewTicker(time.Duration(interval) * time.Minute)
	defer ticker.Stop()
	first := time.NewTimer(45 * time.Second)
	defer first.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-first.C:
			s.plexSyncAll(ctx)
		case <-ticker.C:
			s.plexSyncAll(ctx)
		}
	}
}

func (s *Server) plexSyncAll(ctx context.Context) {
	if s.cfg.Plex.URL == "" || s.cfg.Plex.Token == "" {
		return
	}
	if !s.plexSyncMu.TryLock() {
		return // a manual import owns the lock this tick
	}
	defer s.plexSyncMu.Unlock()
	users, err := s.store.ListUsers()
	if err != nil || len(users) == 0 {
		return
	}
	c := s.plexClient("", "")
	marked := 0
	pulled := 0
	for _, u := range users {
		report, err := plex.Import(ctx, c, s.store, u.ID, plex.Pull, true)
		if err != nil {
			log.Printf("plex: auto-sync %s: %v", u.ID, err)
			continue
		}
		pulled++
		marked += report.MarkedLumina
	}
	s.plexSyncLast = time.Now()
	s.plexSyncSummary = fmt.Sprintf("pulled for %d user(s) · %d playhead(s) imported", pulled, marked)
	log.Printf("plex: auto-sync: %s", s.plexSyncSummary)
}

// GET /api/v1/plex/syncstatus — loop state for the Integrations page.
func (s *Server) plexSyncStatus(w http.ResponseWriter, _ *http.Request) {
	interval := s.cfg.Plex.SyncIntervalMinutes
	if interval == 0 {
		interval = 30
	}
	writeJSON(w, map[string]any{
		"configured":      s.cfg.Plex.URL != "" && s.cfg.Plex.Token != "",
		"enabled":         interval > 0,
		"intervalMinutes": interval,
		"lastRun":         s.plexSyncLast,
		"summary":         s.plexSyncSummary,
	})
}
