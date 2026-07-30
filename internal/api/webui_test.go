package api

import (
	"io/fs"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
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

func TestHomeViewFetchesCatalogRevision(t *testing.T) {
	app, err := os.ReadFile("web/app.js")
	if err != nil {
		t.Fatalf("read web client: %v", err)
	}
	catalogStart := strings.Index(string(app), "async function loadCatalog()")
	catalogEnd := strings.Index(string(app), "// Transcode-session timeline state")
	if catalogStart == -1 || catalogEnd == -1 || catalogEnd <= catalogStart {
		t.Fatal("could not locate the catalog loader")
	}
	catalog := string(app)[catalogStart:catalogEnd]
	homeStart := strings.Index(string(app), "async function loadHome()")
	homeEnd := strings.Index(string(app), "// Plex/Netflix-style rail paging")
	if homeStart == -1 || homeEnd == -1 || homeEnd <= homeStart {
		t.Fatal("could not locate the home view")
	}
	home := string(app)[homeStart:homeEnd]
	if !strings.Contains(catalog, `api("/api/v1/items/revision")`) ||
		!strings.Contains(catalog, "catalogStamp = `${revision.count}:${revision.revision}`;") ||
		!strings.Contains(home, "loadCatalog()") {
		t.Fatal("home view must seed catalog polling from its shared catalog loader")
	}
}

func TestManageViewSurfacesVerifiedContentConflicts(t *testing.T) {
	app, err := os.ReadFile("web/app.js")
	if err != nil {
		t.Fatalf("read web client: %v", err)
	}
	client := string(app)
	for _, required := range []string{
		"const contentKeyFor = (it)",
		"isContentConflict(it)",
		"content conflict</span>",
	} {
		if !strings.Contains(client, required) {
			t.Fatalf("manage view is missing verified conflict marker %q", required)
		}
	}
}

func TestManageViewSeparatesMissingHistoryFromActiveItems(t *testing.T) {
	app, err := os.ReadFile("web/app.js")
	if err != nil {
		t.Fatalf("read web client: %v", err)
	}
	index, err := os.ReadFile("web/index.html")
	if err != nil {
		t.Fatalf("read web markup: %v", err)
	}
	for _, required := range []string{
		`value="active" selected>Active items`,
		`value="missing">Missing history`,
	} {
		if !strings.Contains(string(index), required) {
			t.Fatalf("manage filters are missing %q", required)
		}
	}
	for _, required := range []string{
		`status === "active" && it.state !== "active"`,
		"missing history",
		"· retired</option>",
	} {
		if !strings.Contains(string(app), required) {
			t.Fatalf("manage client is missing %q", required)
		}
	}
}
