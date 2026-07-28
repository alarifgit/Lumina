// *arr status endpoint: aggregated queue + calendar per instance.
package api

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/lumina-media/lumina/internal/arr"
	"github.com/lumina-media/lumina/internal/config"
)

// GET /api/v1/arr/status — outbound reachability, download queue and
// 7-day calendar for every configured Radarr/Sonarr instance.
func (s *Server) arrStatus(w http.ResponseWriter, r *http.Request) {
	instances := s.configSnapshot().Arr
	if len(instances) == 0 {
		writeJSON(w, []any{})
		return
	}
	writeJSON(w, arr.FetchStatuses(r.Context(), instances))
}

// GET /api/v1/config/arr — the configured instances, so the settings UI
// can render the editor. API keys round-trip in full (local server).
func (s *Server) arrConfigGet(w http.ResponseWriter, _ *http.Request) {
	out := s.configSnapshot().Arr
	if out == nil {
		out = []config.ArrInstance{}
	}
	writeJSON(w, out)
}

// POST /api/v1/config/arr — persist the instance list to lumina.json
// (atomic one-key write), then use it for all future status/webhook work.
func (s *Server) arrConfigSave(w http.ResponseWriter, r *http.Request) {
	var body []config.ArrInstance
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<16)).Decode(&body); err != nil {
		http.Error(w, "invalid JSON: "+err.Error(), http.StatusBadRequest)
		return
	}
	clean := make([]config.ArrInstance, 0, len(body))
	for _, inst := range body {
		inst.Name = strings.TrimSpace(inst.Name)
		inst.URL = strings.TrimRight(strings.TrimSpace(inst.URL), "/")
		inst.APIKey = strings.TrimSpace(inst.APIKey)
		if inst.URL == "" {
			continue // a row without a URL is an empty editor row, not an instance
		}
		if inst.Name == "" {
			inst.Name = inst.URL
		}
		clean = append(clean, inst)
	}
	s.cfgMu.Lock()
	if err := config.SaveArr(s.configPath, clean); err != nil {
		s.cfgMu.Unlock()
		http.Error(w, "save config: "+err.Error(), http.StatusInternalServerError)
		return
	}
	s.cfg.Arr = append([]config.ArrInstance(nil), clean...)
	s.cfgMu.Unlock()
	writeJSON(w, clean)
}
