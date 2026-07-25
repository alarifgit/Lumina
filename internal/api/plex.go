// Plex migration endpoints: connection test + watch-state import.
package api

import (
	"encoding/json"
	"net/http"

	"github.com/lumina-media/lumina/internal/plex"
)

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
	report, err := plex.Import(r.Context(), c, s.store, body.UserID, dir, body.Apply)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}
	writeJSON(w, report)
}
