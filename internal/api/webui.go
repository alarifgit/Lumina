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
	mux.Handle("GET /", http.FileServerFS(sub))
}
