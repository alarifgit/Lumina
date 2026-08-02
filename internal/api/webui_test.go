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

func readWebTestAsset(t *testing.T, name string) string {
	t.Helper()
	b, err := os.ReadFile("web/" + name)
	if err != nil {
		t.Fatalf("read web/%s: %v", name, err)
	}
	return string(b)
}

func openingTagByID(t *testing.T, markup, id string) string {
	t.Helper()
	needle := `id="` + id + `"`
	idStart := strings.Index(markup, needle)
	if idStart == -1 {
		t.Fatalf("web shell is missing id %q", id)
	}
	tagStart := strings.LastIndex(markup[:idStart], "<")
	tagEnd := strings.Index(markup[idStart:], ">")
	if tagStart == -1 || tagEnd == -1 {
		t.Fatalf("could not locate opening tag for id %q", id)
	}
	return markup[tagStart : idStart+tagEnd+1]
}

func firstBodyDirectionContract(t *testing.T, markup string) string {
	t.Helper()
	bodyStart := strings.Index(markup, "<body")
	if bodyStart == -1 {
		t.Fatal("web shell is missing a body element")
	}
	bodyOpenEnd := strings.Index(markup[bodyStart:], ">")
	if bodyOpenEnd == -1 {
		t.Fatal("web shell body opening tag is malformed")
	}
	body := strings.TrimSpace(markup[bodyStart+bodyOpenEnd+1:])
	if !strings.HasPrefix(body, "<!--") {
		t.Fatal("the first body child must be the durable direction contract comment")
	}
	commentEnd := strings.Index(body, "-->")
	if commentEnd == -1 {
		t.Fatal("the first body comment is not closed")
	}
	return body[:commentEnd+3]
}

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

func TestWebDirectionContractIsFirstBodyChild(t *testing.T) {
	markup := readWebTestAsset(t, "index.html")
	contract := firstBodyDirectionContract(t, markup)
	for _, section := range []string{
		"THESIS:",
		"OWN-WORLD:",
		"STORY:",
		"FIRST VIEWPORT:",
		"FORM:",
		"FINISH:",
	} {
		if !strings.Contains(contract, section) {
			t.Errorf("direction contract is missing %q", section)
		}
	}
}

func TestWebDirectionContractPinsApprovedAeroWorld(t *testing.T) {
	contract := firstBodyDirectionContract(t, readWebTestAsset(t, "index.html"))
	for _, required := range []string{
		"Carried Spotlight",
		"Layered Horizon",
		"Split Aero",
		"Panorama rail spacing",
		"surface seed 254e3584",
	} {
		if !strings.Contains(contract, required) {
			t.Errorf("approved redesign contract is missing %q", required)
		}
	}
}

func TestWebShellUsesOfficialBrandAssets(t *testing.T) {
	sources := readWebTestAsset(t, "index.html") + "\n" + readWebTestAsset(t, "app.js")
	for _, asset := range []string{
		"brand/wordmark.webp",
		"brand/emblem-512.png",
	} {
		if !strings.Contains(sources, `src="/`+asset+`"`) {
			t.Errorf("web client must reference the official /%s asset", asset)
		}
		info, err := os.Stat("web/" + asset)
		if err != nil {
			t.Errorf("official web/%s asset is unavailable: %v", asset, err)
		} else if info.Size() == 0 {
			t.Errorf("official web/%s asset is empty", asset)
		}
	}
}

func TestWebShellKeepsCoreSemanticSurfaces(t *testing.T) {
	markup := readWebTestAsset(t, "index.html")
	for _, landmark := range []string{
		"<header",
		`<nav id="libraries"`,
		`<main id="grid"`,
	} {
		if !strings.Contains(markup, landmark) {
			t.Errorf("web shell is missing core landmark %q", landmark)
		}
	}

	for _, id := range []string{"settings-page", "search-page", "player-overlay"} {
		tag := openingTagByID(t, markup, id)
		if !strings.Contains(tag, `role="dialog"`) || !strings.Contains(tag, `aria-modal="true"`) {
			t.Errorf("%s must remain a modal dialog; opening tag is %q", id, tag)
		}
	}

	for _, id := range []string{
		"app-status",
		"video",
		"player-controls",
		"seek-bar",
		"pc-play",
		"pc-quality",
		"cc-select",
	} {
		openingTagByID(t, markup, id)
	}
}

func TestProductionRedesignContracts(t *testing.T) {
	styles := readWebTestAsset(t, "style.css")
	for _, marker := range []string{
		"Layered Aero production system",
		"--aero-edge:",
		"--lumina-gold:",
		"@media (min-width: 1280px)",
		"@media (max-width: 760px)",
	} {
		if !strings.Contains(styles, marker) {
			t.Errorf("production redesign styles are missing stable marker %q", marker)
		}
	}

	for _, asset := range []string{"nav-home.svg", "nav-library.svg", "nav-list.svg"} {
		if !strings.Contains(styles, `url("/icons/`+asset+`")`) {
			t.Errorf("production navigation must use local /icons/%s", asset)
		}
		if info, err := os.Stat("web/icons/" + asset); err != nil {
			t.Errorf("local navigation asset web/icons/%s is unavailable: %v", asset, err)
		} else if info.Size() == 0 {
			t.Errorf("local navigation asset web/icons/%s is empty", asset)
		}
	}

	client := readWebTestAsset(t, "app.js")
	for _, marker := range []string{
		"BROWSE_BATCH_SIZE",
		"it.library === lib.name",
		"manageFilterTimer = setTimeout(",
	} {
		if !strings.Contains(client, marker) {
			t.Errorf("production client is missing stable behavior marker %q", marker)
		}
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
