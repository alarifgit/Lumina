package api

import (
	"io/fs"
	"net/http"
	"net/http/httptest"
	"testing"
	"testing/fstest"
)

func TestWebHandlerCaching(t *testing.T) {
	webFS := fstest.MapFS{
		"index.html": &fstest.MapFile{Data: []byte("<h1>Lumina</h1>")},
		"app.js":     &fstest.MapFile{Data: []byte("console.log('lumina')")},
	}
	var source fs.FS = webFS
	handler := webHandler(source)

	shell := httptest.NewRecorder()
	handler.ServeHTTP(shell, httptest.NewRequest(http.MethodGet, "/", nil))
	if got := shell.Header().Get("Cache-Control"); got != "no-store, must-revalidate" {
		t.Fatalf("shell Cache-Control = %q", got)
	}

	asset := httptest.NewRecorder()
	handler.ServeHTTP(asset, httptest.NewRequest(http.MethodGet, "/app.js", nil))
	etag := asset.Header().Get("ETag")
	if etag == "" {
		t.Fatal("asset response has no ETag")
	}
	if got := asset.Header().Get("Cache-Control"); got != "public, max-age=0, must-revalidate" {
		t.Fatalf("asset Cache-Control = %q", got)
	}

	req := httptest.NewRequest(http.MethodGet, "/app.js", nil)
	req.Header.Set("If-None-Match", etag)
	revalidated := httptest.NewRecorder()
	handler.ServeHTTP(revalidated, req)
	if revalidated.Code != http.StatusNotModified {
		t.Fatalf("revalidation status = %d, want %d", revalidated.Code, http.StatusNotModified)
	}
	if revalidated.Body.Len() != 0 {
		t.Fatalf("304 response body length = %d", revalidated.Body.Len())
	}
}
