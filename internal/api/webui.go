// Embedded web client: the single-binary story. `go:embed` packs web/
// into the lumina binary and FileServerFS serves it at /.
package api

import (
	"embed"
	"io/fs"
	"net/http"
)

//go:embed all:web
var webContent embed.FS

func (s *Server) registerWebUI(mux *http.ServeMux) {
	sub, err := fs.Sub(webContent, "web")
	if err != nil {
		return // build without web assets; API still works
	}
	// The embedded FS carries no modtimes/ETags, so browsers cannot
	// revalidate — without this they serve STALE app.js/index.html across
	// rebuilds (new features "not showing up" until a hard refresh).
	mux.Handle("GET /", noStore(http.FileServerFS(sub)))
}

// noStore marks the UI shell uncacheable. Assets are tiny and served over
// LAN; correctness across rebuilds beats a saved round trip.
func noStore(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store, must-revalidate")
		next.ServeHTTP(w, r)
	})
}
