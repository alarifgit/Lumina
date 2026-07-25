// Watch-state endpoints: users, playhead journal writes, derived reads.
package api

import (
	"encoding/json"
	"net/http"
)

// GET /api/v1/users
func (s *Server) listUsers(w http.ResponseWriter, _ *http.Request) {
	users, err := s.store.ListUsers()
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	writeJSON(w, users)
}

// POST /api/v1/users — body {"name": "..."}. Minimal multi-user support;
// real auth arrives in a later phase.
func (s *Server) createUser(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Name string `json:"name"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Name == "" {
		http.Error(w, "need {\"name\": ...}", http.StatusBadRequest)
		return
	}
	u, err := s.store.CreateUser(body.Name)
	if err != nil {
		http.Error(w, err.Error(), http.StatusConflict) // UNIQUE(name)
		return
	}
	writeJSON(w, u)
}

// GET /api/v1/users/{uid}/playheads — derived state for every item the
// user has touched; the web client renders progress bars from this map.
func (s *Server) userPlayheads(w http.ResponseWriter, r *http.Request) {
	phs, err := s.store.Playheads(r.PathValue("uid"))
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	writeJSON(w, phs)
}

// GET /api/v1/items/{id}/playhead?user=usr-1 — resume point for the player.
func (s *Server) getPlayhead(w http.ResponseWriter, r *http.Request) {
	uid := r.URL.Query().Get("user")
	if uid == "" {
		http.Error(w, "missing ?user=", http.StatusBadRequest)
		return
	}
	ph, err := s.store.Playhead(uid, r.PathValue("id"))
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if ph == nil {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	writeJSON(w, ph)
}

// POST /api/v1/items/{id}/playhead — append a journal row.
// Body: {"userId":"usr-1","positionMs":12345,"durationMs":5400000}
//
// Clients report on a throttle (~every 10s while playing), on pause, and
// on player close. The journal is append-only; out-of-order reports are
// harmless because the version is assigned here, server-side.
func (s *Server) postPlayhead(w http.ResponseWriter, r *http.Request) {
	var body struct {
		UserID     string `json:"userId"`
		PositionMs int64  `json:"positionMs"`
		DurationMs int64  `json:"durationMs"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.UserID == "" {
		http.Error(w, "need {\"userId\",\"positionMs\",\"durationMs\"}", http.StatusBadRequest)
		return
	}
	if body.PositionMs < 0 {
		body.PositionMs = 0
	}
	// Verify the item exists so the journal never holds orphans.
	if it := s.itemFor(w, r); it == nil {
		return
	}
	if err := s.store.RecordPlayhead(body.UserID, r.PathValue("id"),
		body.PositionMs, body.DurationMs); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
