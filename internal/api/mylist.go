// My List endpoints: per-user bookmarks.
package api

import (
	"encoding/json"
	"net/http"
)

// GET /api/v1/users/{uid}/mylist — bookmarked item ids for the web client.
func (s *Server) userMyList(w http.ResponseWriter, r *http.Request) {
	ids, err := s.store.MyListIDs(r.PathValue("uid"))
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	writeJSON(w, ids)
}

// POST /api/v1/items/{id}/mylist — toggle one bookmark.
// Body: {"userId":"usr-1"} → {"added": true|false}
func (s *Server) toggleMyList(w http.ResponseWriter, r *http.Request) {
	var body struct {
		UserID string `json:"userId"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.UserID == "" {
		http.Error(w, "need {\"userId\": ...}", http.StatusBadRequest)
		return
	}
	if it := s.itemFor(w, r); it == nil {
		return
	}
	added, err := s.store.ToggleMyList(body.UserID, r.PathValue("id"))
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	writeJSON(w, map[string]bool{"added": added})
}
