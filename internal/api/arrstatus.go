// *arr status endpoint: aggregated queue + calendar per instance.
package api

import (
	"net/http"

	"github.com/lumina-media/lumina/internal/arr"
)

// GET /api/v1/arr/status — outbound reachability, download queue and
// 7-day calendar for every configured Radarr/Sonarr instance.
func (s *Server) arrStatus(w http.ResponseWriter, r *http.Request) {
	if len(s.cfg.Arr) == 0 {
		writeJSON(w, []any{})
		return
	}
	writeJSON(w, arr.FetchStatuses(r.Context(), s.cfg.Arr))
}
