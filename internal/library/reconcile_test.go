package library

import (
	"path/filepath"
	"testing"
)

func TestReconcileLibrariesPreservesItemAcrossRegisteredRename(t *testing.T) {
	store, err := OpenStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	path := filepath.Join("/media", "movie.mkv")
	item, err := store.UpsertByHash("sample", "Old Movies", func(it *Item) {
		it.Kind, it.Title, it.State, it.Paths = KindMovie, "Movie", StateActive, []string{path}
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.ReconcileLibraries([]LibraryRoot{{Name: "Old Movies", Path: "/media", Kind: "movies"}}); err != nil {
		t.Fatal(err)
	}
	result, err := store.ReconcileLibraries([]LibraryRoot{{Name: "Movies", Path: "/media", Kind: "movies"}})
	if err != nil {
		t.Fatal(err)
	}
	if result.Renamed != 1 || result.Merged != 0 {
		t.Fatalf("rename result = %+v", result)
	}
	got, err := store.Get(item.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got == nil || got.Library != "Movies" || got.State != StateActive || len(got.Paths) != 1 {
		t.Fatalf("renamed item = %+v", got)
	}
}

func TestReconcileLibrariesMergesIdentityShadowAndPreservesUserState(t *testing.T) {
	store, err := OpenStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	raw, err := store.UpsertByHash("sample", "Movies", func(it *Item) {
		it.Kind, it.Title, it.State = KindMovie, "Movie", StateMissing
	})
	if err != nil {
		t.Fatal(err)
	}
	canonical, err := store.UpsertByHash("sample:full:logical", "Movies", func(it *Item) {
		it.Kind, it.Title, it.State = KindMovie, "Movie", StateActive
		it.Paths = []string{filepath.Join("/media", "movie.mkv")}
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := store.RecordPlayhead("usr-1", raw.ID, 42_000, 100_000); err != nil {
		t.Fatal(err)
	}
	if added, err := store.ToggleMyList("usr-1", raw.ID); err != nil || !added {
		t.Fatalf("bookmark raw item: added=%v err=%v", added, err)
	}
	result, err := store.ReconcileLibraries([]LibraryRoot{{Name: "Movies", Path: "/media", Kind: "movies"}})
	if err != nil {
		t.Fatal(err)
	}
	if result.Merged != 1 {
		t.Fatalf("merge result = %+v", result)
	}
	if got, err := store.Get(raw.ID); err != nil || got != nil {
		t.Fatalf("shadow still exists: item=%+v err=%v", got, err)
	}
	playhead, err := store.Playhead("usr-1", canonical.ID)
	if err != nil || playhead == nil || playhead.PositionMs != 42_000 {
		t.Fatalf("merged playhead = %+v err=%v", playhead, err)
	}
	bookmarks, err := store.MyListIDs("usr-1")
	if err != nil || !bookmarks[canonical.ID] || bookmarks[raw.ID] {
		t.Fatalf("merged bookmarks = %v err=%v", bookmarks, err)
	}
}

func TestReconcileLibrariesRepairsMatchedRetiredShadow(t *testing.T) {
	store, err := OpenStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	retired, err := store.UpsertByHash("sample", "TV Shows", func(it *Item) {
		it.Kind, it.Title, it.TMDBID, it.State = KindEpisode, "Show S01E01", 123, StateMissing
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := store.SetMetadata(retired.ID, Metadata{TMDBID: 123, Title: "Show S01E01"}); err != nil {
		t.Fatal(err)
	}
	active, err := store.UpsertByHash("sample:full:logical", "TV", func(it *Item) {
		it.Kind, it.Title, it.TMDBID, it.State = KindEpisode, "Show S01E01 · Pilot", 123, StateActive
		it.Paths = []string{filepath.Join("/tv", "Show", "Show.S01E01.mkv")}
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := store.SetMetadata(active.ID, Metadata{TMDBID: 123, Title: "Show S01E01 · Pilot"}); err != nil {
		t.Fatal(err)
	}
	if err := store.RecordPlayhead("usr-1", retired.ID, 75_000, 100_000); err != nil {
		t.Fatal(err)
	}
	result, err := store.ReconcileLibraries([]LibraryRoot{{Name: "TV", Path: "/tv", Kind: "tv"}})
	if err != nil {
		t.Fatal(err)
	}
	if result.Merged != 1 {
		t.Fatalf("retired-shadow result = %+v", result)
	}
	if got, err := store.Get(retired.ID); err != nil || got != nil {
		t.Fatalf("retired shadow still exists: item=%+v err=%v", got, err)
	}
	playhead, err := store.Playhead("usr-1", active.ID)
	if err != nil || playhead == nil || playhead.PositionMs != 75_000 {
		t.Fatalf("retired playhead = %+v err=%v", playhead, err)
	}
}

func TestReconcileLibrariesRetiresRemovedRootOwnership(t *testing.T) {
	store, err := OpenStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	path := filepath.Join("/removed", "movie.mkv")
	item, err := store.UpsertByHash("sample", "Removed", func(it *Item) {
		it.Kind, it.Title, it.State, it.Paths = KindMovie, "Movie", StateActive, []string{path}
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := store.SetFileState(path, 10, 20, "sample"); err != nil {
		t.Fatal(err)
	}
	result, err := store.ReconcileLibraries([]LibraryRoot{{Name: "Movies", Path: "/media", Kind: "movies"}})
	if err != nil {
		t.Fatal(err)
	}
	if result.Retired != 1 {
		t.Fatalf("retire result = %+v", result)
	}
	got, err := store.Get(item.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.State != StateMissing || len(got.Paths) != 0 {
		t.Fatalf("retired item = state %q paths %v", got.State, got.Paths)
	}
	if _, _, _, ok := store.FileState(path); ok {
		t.Fatal("removed-root file state was retained")
	}
}
