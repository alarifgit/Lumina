// Metadata endpoints: manual re-identification (Phase 6).
package api

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"

	"github.com/lumina-media/lumina/internal/library"
	"github.com/lumina-media/lumina/internal/metadata"
)

// POST /api/v1/metadata/rematch-unidentified — requeue every ACTIVE item
// that has no TMDB id. The button next to "matching improved" moments:
// one click instead of right-clicking every straggler.
func (s *Server) rematchUnidentified(w http.ResponseWriter, r *http.Request) {
	if s.mw == nil || !s.mw.Available() {
		http.Error(w, "metadata unavailable: no TMDB API key configured",
			http.StatusServiceUnavailable)
		return
	}
	queued := 0
	for _, it := range s.store.List("") {
		if it.State != library.StateActive || it.TMDBID != 0 {
			continue
		}
		hint := metadata.IdentifyHint{}
		if it.Kind == library.KindEpisode && len(it.Paths) > 0 {
			for _, root := range s.cfg.Libraries {
				if root.Name == it.Library {
					hint = metadata.HintFor(root.Path, it.Paths[0], true)
					break
				}
			}
		}
		s.mw.EnqueueHint(it, hint)
		queued++
	}
	writeJSON(w, map[string]int{"queued": queued})
}

// POST /api/v1/items/{id}/metadata/refresh — force re-identification.
func (s *Server) refreshMetadata(w http.ResponseWriter, r *http.Request) {
	it := s.itemFor(w, r)
	if it == nil {
		return
	}
	if s.mw == nil || !s.mw.Available() {
		http.Error(w, "metadata unavailable: no TMDB API key configured",
			http.StatusServiceUnavailable)
		return
	}
	// Re-identification gets the same folder-structure hints as a scan:
	// without them, absolute-numbered anime can never re-match.
	hint := metadata.IdentifyHint{}
	if it.Kind == library.KindEpisode && len(it.Paths) > 0 {
		for _, root := range s.cfg.Libraries {
			if root.Name == it.Library {
				hint = metadata.HintFor(root.Path, it.Paths[0], true)
				break
			}
		}
	}
	s.mw.EnqueueHint(*it, hint)
	w.WriteHeader(http.StatusAccepted)
}

// GET /api/v1/metadata/search?kind=movies|tv&q=... — TMDB candidates for
// the "fix match" picker. kind defaults to movies.
func (s *Server) metadataSearch(w http.ResponseWriter, r *http.Request) {
	if s.mw == nil || !s.mw.Available() {
		http.Error(w, "metadata unavailable: no TMDB API key configured",
			http.StatusServiceUnavailable)
		return
	}
	kind := r.URL.Query().Get("kind")
	if kind != "tv" {
		kind = "movies"
	}
	q := strings.TrimSpace(r.URL.Query().Get("q"))
	if q == "" {
		http.Error(w, "missing ?q=", http.StatusBadRequest)
		return
	}
	results, err := s.mw.Search(r.Context(), kind, q)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}
	writeJSON(w, results)
}

// GET /api/v1/metadata/series/{tmdbId}/episodes — per-episode TMDB data
// (names, overviews, stills, air dates) for the series detail page.
// Server-side 24h memoized; costs 1 + N_seasons TMDB requests on a miss.
func (s *Server) seriesEpisodes(w http.ResponseWriter, r *http.Request) {
	if s.mw == nil || !s.mw.Available() {
		http.Error(w, "metadata unavailable: no TMDB API key configured",
			http.StatusServiceUnavailable)
		return
	}
	id, err := strconv.Atoi(r.PathValue("tmdbId"))
	if err != nil || id <= 0 {
		http.Error(w, "need a positive numeric TMDB id", http.StatusBadRequest)
		return
	}
	eps, err := s.mw.SeriesEpisodes(r.Context(), id)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}
	writeJSON(w, map[string]any{"tmdbId": id, "episodes": eps})
}

// POST /api/v1/items/{id}/identify — apply an explicit TMDB id chosen in
// the fix-match UI. Body: {"tmdbId": 12345}. Returns the updated item.
func (s *Server) identifyItem(w http.ResponseWriter, r *http.Request) {
	it := s.itemFor(w, r)
	if it == nil {
		return
	}
	if s.mw == nil || !s.mw.Available() {
		http.Error(w, "metadata unavailable: no TMDB API key configured",
			http.StatusServiceUnavailable)
		return
	}
	var body struct {
		TMDBID int `json:"tmdbId"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<16)).Decode(&body); err != nil || body.TMDBID <= 0 {
		http.Error(w, "need {\"tmdbId\": <positive integer>}", http.StatusBadRequest)
		return
	}
	if err := s.mw.ApplyMatch(r.Context(), *it, body.TMDBID); err != nil {
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}
	updated, err := s.store.Get(it.ID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	writeJSON(w, updated)
}
