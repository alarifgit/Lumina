package library

import (
	"path/filepath"
	"testing"
)

func TestReconcileLibrariesDoesNotMergeLiveSampleCollision(t *testing.T) {
	store, err := OpenStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	firstPath := filepath.Join("/media", "first.mkv")
	secondPath := filepath.Join("/media", "second.mkv")
	if _, err := store.UpsertByHash("sample", "Old Movies", func(it *Item) {
		it.Kind, it.Title, it.State, it.Paths = KindMovie, "First", StateActive, []string{firstPath}
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := store.UpsertByHash("sample", "Movies", func(it *Item) {
		it.Kind, it.Title, it.State, it.Paths = KindMovie, "Second", StateActive, []string{secondPath}
	}); err != nil {
		t.Fatal(err)
	}
	result, err := store.ReconcileLibraries([]LibraryRoot{{Name: "Movies", Path: "/media", Kind: "movies"}})
	if err != nil {
		t.Fatal(err)
	}
	if result.Merged != 0 {
		t.Fatalf("live sampled collision was merged: %+v", result)
	}
	items := store.List("")
	if len(items) != 2 {
		t.Fatalf("live sampled collision produced %d items", len(items))
	}
	active, missing := 0, 0
	for _, item := range items {
		if item.State == StateActive {
			active++
			if len(item.Paths) != 1 || item.Paths[0] != secondPath {
				t.Fatalf("active collision paths = %v", item.Paths)
			}
		} else {
			missing++
		}
	}
	if active != 1 || missing != 1 {
		t.Fatalf("collision states: active=%d missing=%d", active, missing)
	}
}
