// Embedded web client: the single-binary story. `go:embed` packs web/
// into the lumina binary and FileServerFS serves it at /.
package api

import (
	"crypto/sha256"
	"embed"
	"fmt"
	"io/fs"
	"net/http"
	"strings"
)

//go:embed all:web
var webContent embed.FS

func (s *Server) registerWebUI(mux *http.ServeMux) {
	sub, err := fs.Sub(webContent, "web")
	if err != nil {
		return // build without web assets; API still works
	}
	mux.Handle("GET /", webHandler(sub))
}

// webHandler keeps the document shell fresh while giving immutable embedded
// assets cheap conditional revalidation. Embedded files have no modtimes, so
// strong content-derived ETags avoid retransmitting large JS, images, and hls.js
// without ever serving stale bytes after a rebuild.
func webHandler(webFS fs.FS) http.Handler {
	files := http.FileServerFS(webFS)
	etags := make(map[string]string)
	_ = fs.WalkDir(webFS, ".", func(path string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil || entry.IsDir() {
			return walkErr
		}
		body, err := fs.ReadFile(webFS, path)
		if err != nil {
			return err
		}
		sum := sha256.Sum256(body)
		etags["/"+strings.TrimPrefix(path, "./")] = fmt.Sprintf("\"%x\"", sum)
		return nil
	})
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/" || r.URL.Path == "/index.html" {
			w.Header().Set("Cache-Control", "no-store, must-revalidate")
			files.ServeHTTP(w, r)
			return
		}
		if etag := etags[r.URL.Path]; etag != "" {
			w.Header().Set("Cache-Control", "public, max-age=0, must-revalidate")
			w.Header().Set("ETag", etag)
			if r.Header.Get("If-None-Match") == etag {
				w.WriteHeader(http.StatusNotModified)
				return
			}
		}
		files.ServeHTTP(w, r)
	})
}
