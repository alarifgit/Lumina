package library

import (
	"path/filepath"
	"testing"
)

func TestUpsertByHashRehomesPathToSingleOwner(t *testing.T) {
	store, err := OpenStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	path := filepath.Join("/media", "movie.mkv")
	first, err := store.UpsertByHash("first", "Movies", func(it *Item) {
		it.Kind = KindMovie
		it.Title = "First"
		it.State = StateActive
		it.Paths = []string{path}
	})
	if err != nil {
		t.Fatal(err)
	}
	second, err := store.UpsertByHash("second", "Movies", func(it *Item) {
		it.Kind = KindMovie
		it.Title = "Second"
		it.State = StateActive
		it.Paths = []string{path}
	})
	if err != nil {
		t.Fatal(err)
	}
	gotFirst, err := store.Get(first.ID)
	if err != nil {
		t.Fatal(err)
	}
	if gotFirst.State != StateMissing || len(gotFirst.Paths) != 0 {
		t.Fatalf("previous owner = state %q paths %v", gotFirst.State, gotFirst.Paths)
	}
	gotSecond, err := store.Get(second.ID)
	if err != nil {
		t.Fatal(err)
	}
	if gotSecond.State != StateActive || len(gotSecond.Paths) != 1 || gotSecond.Paths[0] != path {
		t.Fatalf("new owner = state %q paths %v", gotSecond.State, gotSecond.Paths)
	}
}

func TestMarkMissingPrunesStalePathsAndCache(t *testing.T) {
	store, err := OpenStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	current := filepath.Join("/media", "current.mkv")
	stale := filepath.Join("/media", "old-name.mkv")
	item, err := store.UpsertByHash("hash", "Movies", func(it *Item) {
		it.Kind = KindMovie
		it.Title = "Movie"
		it.State = StateActive
		it.Paths = []string{current, stale}
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := store.SetFileState(stale, 10, 20, "hash"); err != nil {
		t.Fatal(err)
	}
	_, beforeRevision, err := store.CatalogRevision()
	if err != nil {
		t.Fatal(err)
	}
	missing, err := store.MarkMissing("Movies", map[string]bool{current: true})
	if err != nil {
		t.Fatal(err)
	}
	if missing != 0 {
		t.Fatalf("missing count = %d, want 0", missing)
	}
	got, err := store.Get(item.ID)
	_, afterRevision, err := store.CatalogRevision()
	if err != nil {
		t.Fatal(err)
	}
	if afterRevision <= beforeRevision {
		t.Fatalf("catalog revision did not advance after stale-path pruning: %d -> %d", beforeRevision, afterRevision)
	}
	if err != nil {
		t.Fatal(err)
	}
	if got.State != StateActive || len(got.Paths) != 1 || got.Paths[0] != current {
		t.Fatalf("pruned item = state %q paths %v", got.State, got.Paths)
	}
	if _, _, _, ok := store.FileState(stale); ok {
		t.Fatal("stale path cache was retained")
	}
}
