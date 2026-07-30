package config

import (
	"os"
	"path/filepath"
	"testing"
)

func TestLoadNormalizesConfiguredPaths(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "lumina.json")
	data := []byte(`{"libraries":[{"name":" Movies ","path":" /media/movies/ ","kind":" movies "}],"pathMappings":[{"from":" /downloads/ ","to":" /media/movies/ "}]}`)
	if err := os.WriteFile(path, data, 0o600); err != nil {
		t.Fatal(err)
	}

	cfg, err := Load(path)
	if err != nil {
		t.Fatal(err)
	}
	if got, want := cfg.Libraries[0], (LibraryRoot{Name: "Movies", Path: "/media/movies", Kind: "movies"}); got != want {
		t.Fatalf("library = %+v, want %+v", got, want)
	}
	if got, want := cfg.PathMappings[0].From, "/downloads"; got != want {
		t.Fatalf("mapping from = %q, want %q", got, want)
	}
	if got, want := cfg.PathMappings[0].To, "/media/movies"; got != want {
		t.Fatalf("mapping to = %q, want %q", got, want)
	}
}
