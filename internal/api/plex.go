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

// episodeLister hands the sync the metadata worker for multi-season
// absolute-number flattening — or nil (not a typed-nil interface) when
// TMDB isn't configured, which cleanly disables that fallback.
func (s *Server) episodeLister() plex.EpisodeLister {
	if s.mw == nil || !s.mw.Available() {
		return nil
	}
	return s.mw
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
	report, err := plex.Import(r.Context(), c, s.store, body.UserID, dir, body.Apply, s.episodeLister())
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}
	// Only an APPLY becomes "the last sync" — previews are read-only
	// rehearsals and must not overwrite the real status panel.
	if body.Apply {
		s.plexReport = reportView("manual", report)
		s.plexSyncLast = time.Now()
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
	reps := []*plex.ImportReport{}
	for _, u := range users {
		report, err := plex.Import(ctx, c, s.store, u.ID, plex.Pull, true, s.episodeLister())
		if err != nil {
			log.Printf("plex: auto-sync %s: %v", u.ID, err)
			continue
		}
		pulled++
		marked += report.MarkedLumina
		reps = append(reps, report)
	}
	s.plexSyncLast = time.Now()
	s.plexReport = reportView("auto", reps...)
	s.plexSyncSummary = fmt.Sprintf("pulled for %d user(s) · %d playhead(s) imported", pulled, marked)
	log.Printf("plex: auto-sync: %s", s.plexSyncSummary)
}

// plexSyncReportView is the compact, JSON-ready digest of the last import
// (manual or scheduled) shown on the Integrations page. Aggregated across
// users; unmatched rows are what the user acts on, so they get itemised
// (capped) while everything else stays as counts.
type plexSyncReportView struct {
	At             time.Time `json:"at"`
	Mode           string    `json:"mode"` // manual | auto
	Scanned        int       `json:"scanned"`
	Matched        int       `json:"matched"`
	MarkedLumina   int       `json:"markedLumina"`
	ScrobbledPlex  int       `json:"scrobbledPlex"`
	AlreadySynced  int       `json:"alreadySynced"`
	Unmatched      int       `json:"unmatched"`
	Errors         []string  `json:"errors,omitempty"`
	UnmatchedItems []string  `json:"unmatchedItems,omitempty"`
	Truncated      bool      `json:"truncated"`
}

func reportView(mode string, reps ...*plex.ImportReport) *plexSyncReportView {
	v := &plexSyncReportView{At: time.Now(), Mode: mode}
	for _, r := range reps {
		if r == nil {
			continue
		}
		v.Scanned += r.Scanned
		v.Matched += r.Matched
		v.MarkedLumina += r.MarkedLumina
		v.ScrobbledPlex += r.ScrobbledPlex
		v.AlreadySynced += r.AlreadySynced
		v.Unmatched += r.Unmatched
		v.Errors = append(v.Errors, r.Errors...)
		for _, it := range r.Items {
			if it.Action != "unmatched" {
				continue
			}
			if len(v.UnmatchedItems) >= 50 {
				v.Truncated = true
				continue
			}
			label := it.Title
			if it.Subtitle != "" {
				label += " · " + it.Subtitle
			}
			v.UnmatchedItems = append(v.UnmatchedItems, label)
		}
		if r.ItemsTruncated {
			v.Truncated = true
		}
	}
	return v
}

// GET /api/v1/plex/syncstatus — loop state + last-import digest for the
// Integrations page. A running import holds plexSyncMu for a while, so the
// read is TryLock-best-effort: busy = report omitted + running:true rather
// than a hung HTTP request.
func (s *Server) plexSyncStatus(w http.ResponseWriter, _ *http.Request) {
	interval := s.cfg.Plex.SyncIntervalMinutes
	if interval == 0 {
		interval = 30
	}
	running := false
	var report *plexSyncReportView
	if s.plexSyncMu.TryLock() {
		report = s.plexReport
		s.plexSyncMu.Unlock()
	} else {
		running = true
	}
	writeJSON(w, map[string]any{
		"configured":      s.cfg.Plex.URL != "" && s.cfg.Plex.Token != "",
		"enabled":         interval > 0,
		"intervalMinutes": interval,
		"lastRun":         s.plexSyncLast,
		"summary":         s.plexSyncSummary,
		"running":         running,
		"report":          report,
	})
}
