package library

import (
	"path/filepath"
	"testing"
)

func TestTombstonePathRemovesDirectoryTreeAndCachedState(t *testing.T) {
	store, err := OpenStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()

	root := filepath.Join(string(filepath.Separator), "media", "Show")
	first := filepath.Join(root, "Season 1", "episode-one.mkv")
	second := filepath.Join(root, "Season 1", "episode-two.mkv")
	outside := filepath.Join(string(filepath.Separator), "media", "Other", "movie.mkv")

	item, err := store.UpsertByHash("hash-one", "TV", func(it *Item) {
		it.Kind = KindEpisode
		it.Title = "Episode One"
		it.State = StateActive
		it.Paths = []string{first}
	})
	if err != nil {
		t.Fatal(err)
	}
	_, err = store.UpsertByHash("hash-two", "TV", func(it *Item) {
		it.Kind = KindEpisode
		it.Title = "Episode Two"
		it.State = StateActive
		it.Paths = []string{second}
	})
	if err != nil {
		t.Fatal(err)
	}
	_, err = store.UpsertByHash("hash-three", "TV", func(it *Item) {
		it.Kind = KindMovie
		it.Title = "Outside"
		it.State = StateActive
		it.Paths = []string{outside}
	})
	if err != nil {
		t.Fatal(err)
	}
	for _, p := range []string{first, second, outside} {
		if err := store.SetFileState(p, 10, 20, "cached"); err != nil {
			t.Fatal(err)
		}
	}

	changed, err := store.TombstonePath(root)
	if err != nil {
		t.Fatal(err)
	}
	if !changed {
		t.Fatal("expected directory tombstone to remove child paths")
	}
	got, err := store.Get(item.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.State != StateMissing || len(got.Paths) != 0 {
		t.Fatalf("child item not tombstoned: state=%q paths=%v", got.State, got.Paths)
	}
	if _, _, _, ok := store.FileState(first); ok {
		t.Fatal("stale child file state was retained")
	}
	if _, _, _, ok := store.FileState(outside); !ok {
		t.Fatal("unrelated file state was removed")
	}
}

func TestCatalogRevisionTracksItems(t *testing.T) {
	store, err := OpenStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()

	count, revision, err := store.CatalogRevision()
	if err != nil {
		t.Fatal(err)
	}
	if count != 0 || revision != 0 {
		t.Fatalf("empty revision = (%d, %d), want (0, 0)", count, revision)
	}

	_, err = store.UpsertByHash("hash-one", "Movies", func(it *Item) {
		it.Kind = KindMovie
		it.Title = "One"
		it.State = StateActive
	})
	if err != nil {
		t.Fatal(err)
	}
	_, err = store.UpsertByHash("hash-two", "Movies", func(it *Item) {
		it.Kind = KindMovie
		it.Title = "Two"
		it.State = StateActive
	})
	if err != nil {
		t.Fatal(err)
	}

	count, revision, err = store.CatalogRevision()
	if err != nil {
		t.Fatal(err)
	}
	if count != 2 || revision < 2 {
		t.Fatalf("populated revision = (%d, %d), want (2, revision >= 2)", count, revision)
	}
}
