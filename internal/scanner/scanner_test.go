package scanner

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/lumina-media/lumina/internal/config"
)

func TestLibraryForNormalizesRootPath(t *testing.T) {
	s := New(config.Config{Libraries: []config.LibraryRoot{{Name: "TV", Path: "/media/tv/", Kind: "tv"}}}, nil, nil)

	got := s.libraryFor("/media/tv/Show/Season 01/episode.mkv")
	if got == nil {
		t.Fatal("normalized library root did not match child path")
	}
	if got.Path != "/media/tv" {
		t.Fatalf("library path = %q, want /media/tv", got.Path)
	}
	if got := s.libraryFor("/media/tv-shows/episode.mkv"); got != nil {
		t.Fatalf("segment-prefix collision matched library: %+v", got)
	}
}

func TestExtrasDirectoriesAreScannable(t *testing.T) {
	cases := []string{
		filepath.Join("/media", "Movies", "Film", "Featurettes", "Trailer.mkv"),
		filepath.Join("/media", "Movies", "Film", "Extra", "Interview.mkv"),
		filepath.Join("/media", "Movies", "Film", "Behind-the-Scenes", "Making Of.mkv"),
	}
	for _, path := range cases {
		if !isExtrasPath(path) {
			t.Errorf("isExtrasPath(%q) = false", path)
		}
		if shouldSkipDir(filepath.Base(filepath.Dir(path))) {
			t.Errorf("extras directory %q would be skipped", filepath.Dir(path))
		}
		if shouldSkipFile(path, filepath.Base(path)) {
			t.Errorf("extras file %q would be skipped", path)
		}
	}
	hidden := filepath.Join("/media", "Movies", "Film", "Featurettes", ".hidden.mkv")
	if !shouldSkipFile(hidden, filepath.Base(hidden)) {
		t.Errorf("system sidecar %q was not skipped", hidden)
	}
	special := filepath.Join("/media", "TV", "Show", "Specials", "S00E01.mkv")
	if isExtrasPath(special) {
		t.Errorf("TV specials path %q was classified as an extra", special)
	}
}

func TestWalkWatchDirsRegistersNestedTreesAndSkipsJunk(t *testing.T) {
	root := t.TempDir()
	wanted := []string{
		filepath.Join(root, "Show"),
		filepath.Join(root, "Show", "Season 01"),
		filepath.Join(root, "Movie", "Featurettes"),
	}
	for _, dir := range wanted {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			t.Fatal(err)
		}
	}
	skipped := filepath.Join(root, "@eaDir", "nested")
	if err := os.MkdirAll(skipped, 0o755); err != nil {
		t.Fatal(err)
	}

	got := map[string]bool{}
	if err := walkWatchDirs(root, func(path string) error {
		got[path] = true
		return nil
	}); err != nil {
		t.Fatal(err)
	}

	if !got[root] {
		t.Error("library root was not registered")
	}
	for _, path := range wanted {
		if !got[path] {
			t.Errorf("nested directory %q was not registered", path)
		}
	}
	if got[skipped] {
		t.Errorf("junk directory %q was registered", skipped)
	}
}
