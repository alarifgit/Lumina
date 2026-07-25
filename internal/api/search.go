// Global search: substring over item titles, prefix hits first.
package api

import (
	"net/http"
	"strings"

	"github.com/lumina-media/lumina/internal/library"
)

// GET /api/v1/search?q= — case-insensitive substring over active item
// titles. Prefix matches rank above substring matches. Capped at 60.
func (s *Server) searchItems(w http.ResponseWriter, r *http.Request) {
	q := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("q")))
	if q == "" {
		writeJSON(w, []library.Item{})
		return
	}
	var prefix, substr []library.Item
	for _, it := range s.store.List("") {
		if it.State != library.StateActive {
			continue
		}
		t := strings.ToLower(it.Title)
		switch {
		case strings.HasPrefix(t, q):
			prefix = append(prefix, it)
		case strings.Contains(t, q):
			substr = append(substr, it)
		}
	}
	out := append(prefix, substr...)
	if len(out) > 60 {
		out = out[:60]
	}
	if out == nil {
		out = []library.Item{}
	}
	writeJSON(w, out)
}
