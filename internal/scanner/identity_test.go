package scanner

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/lumina-media/lumina/internal/config"
	"github.com/lumina-media/lumina/internal/library"
)

func openIdentityTestScanner(t *testing.T, root config.LibraryRoot) (*Scanner, library.Store) {
	t.Helper()
	store, err := library.OpenStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.Close() })
	return New(config.Config{Libraries: []config.LibraryRoot{root}}, store, nil), store
}

func writeIdentityTestFile(t *testing.T, path string, data []byte) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, data, 0o644); err != nil {
		t.Fatal(err)
	}
}

func indexIdentityTestFile(t *testing.T, scanner *Scanner, root config.LibraryRoot, path string) {
	t.Helper()
	fi, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if err := scanner.indexFile(root, path, fi); err != nil {
		t.Fatal(err)
	}
}

func TestExactDuplicatePromotesToVerifiedIdentityAndMerges(t *testing.T) {
	root := config.LibraryRoot{Name: "Movies", Path: t.TempDir(), Kind: "movies"}
	scanner, store := openIdentityTestScanner(t, root)
	first := filepath.Join(root.Path, "Copy A", "Movie.2024.mkv")
	second := filepath.Join(root.Path, "Copy B", "Movie.2024.mkv")
	writeIdentityTestFile(t, first, []byte("identical movie bytes"))
	writeIdentityTestFile(t, second, []byte("identical movie bytes"))
	indexIdentityTestFile(t, scanner, root, first)
	items := store.List(root.Name)
	if len(items) != 1 {
		t.Fatalf("first scan produced %d items", len(items))
	}
	if strings.Contains(items[0].Hash, ":") {
		t.Fatalf("first unique file was fully hashed: %q", items[0].Hash)
	}
	indexIdentityTestFile(t, scanner, root, second)
	items = store.List(root.Name)
	if len(items) != 1 {
		t.Fatalf("exact duplicate produced %d items", len(items))
	}
	if len(items[0].Paths) != 2 {
		t.Fatalf("merged duplicate paths = %v", items[0].Paths)
	}
	if strings.Count(items[0].Hash, ":") < 2 {
		t.Fatalf("duplicate identity was not fully verified: %q", items[0].Hash)
	}
	for _, path := range []string{first, second} {
		_, _, cachedIdentity, ok := store.FileState(path)
		if !ok || cachedIdentity != items[0].Hash {
			t.Fatalf("cached identity for %s = %q (ok=%v), want %q", path, cachedIdentity, ok, items[0].Hash)
		}
	}
}

func writeSampleCollisionFile(t *testing.T, path string, middle byte) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	f, err := os.Create(path)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	size := int64(20 << 20)
	if err := f.Truncate(size); err != nil {
		t.Fatal(err)
	}
	if _, err := f.WriteAt([]byte("same-head"), 0); err != nil {
		t.Fatal(err)
	}
	if _, err := f.WriteAt([]byte{middle}, 10<<20); err != nil {
		t.Fatal(err)
	}
	if _, err := f.WriteAt([]byte("same-tail"), size-9); err != nil {
		t.Fatal(err)
	}
}

func TestSamePathCacheInvalidationPreservesSampleIdentity(t *testing.T) {
	root := config.LibraryRoot{Name: "Movies", Path: t.TempDir(), Kind: "movies"}
	scanner, store := openIdentityTestScanner(t, root)
	path := filepath.Join(root.Path, "Movie.2024.mkv")
	writeIdentityTestFile(t, path, []byte("movie bytes"))
	indexIdentityTestFile(t, scanner, root, path)
	before := store.List(root.Name)
	if len(before) != 1 || strings.Contains(before[0].Hash, ":") {
		t.Fatalf("initial identity = %+v", before)
	}
	fi, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if err := store.SetFileState(path, fi.Size(), fi.ModTime().UnixNano()-1, before[0].Hash); err != nil {
		t.Fatal(err)
	}
	indexIdentityTestFile(t, scanner, root, path)
	after := store.List(root.Name)
	if len(after) != 1 {
		t.Fatalf("cache invalidation forked %d items: %+v", len(after), after)
	}
	if after[0].ID != before[0].ID || after[0].Hash != before[0].Hash || after[0].State != library.StateActive {
		t.Fatalf("same-path identity changed: before=%+v after=%+v", before[0], after[0])
	}
	_, cachedMtime, cachedHash, ok := store.FileState(path)
	if !ok || cachedMtime != fi.ModTime().UnixNano() || cachedHash != before[0].Hash {
		t.Fatalf("cache not refreshed: mtime=%d hash=%q ok=%v", cachedMtime, cachedHash, ok)
	}
}

func TestSampleCollisionWithDifferentMiddleDoesNotMerge(t *testing.T) {
	root := config.LibraryRoot{Name: "Movies", Path: t.TempDir(), Kind: "movies"}
	scanner, store := openIdentityTestScanner(t, root)
	first := filepath.Join(root.Path, "Copy A", "Movie.2024.mkv")
	second := filepath.Join(root.Path, "Copy B", "Movie.2024.mkv")
	writeSampleCollisionFile(t, first, 'A')
	writeSampleCollisionFile(t, second, 'B')
	firstInfo, err := os.Stat(first)
	if err != nil {
		t.Fatal(err)
	}
	secondInfo, err := os.Stat(second)
	if err != nil {
		t.Fatal(err)
	}
	firstSample, err := ContentHash(first, firstInfo.Size())
	if err != nil {
		t.Fatal(err)
	}
	secondSample, err := ContentHash(second, secondInfo.Size())
	if err != nil {
		t.Fatal(err)
	}
	if firstSample != secondSample {
		t.Fatal("test files did not produce the intended sampled collision")
	}
	indexIdentityTestFile(t, scanner, root, first)
	indexIdentityTestFile(t, scanner, root, second)
	items := store.List(root.Name)
	if len(items) != 2 {
		t.Fatalf("sampled collision merged into %d item(s)", len(items))
	}
	if items[0].Hash == items[1].Hash {
		t.Fatalf("different full hashes share identity %q", items[0].Hash)
	}
}

func TestByteIdenticalConflictingEpisodesRemainSeparate(t *testing.T) {
	root := config.LibraryRoot{Name: "TV", Path: t.TempDir(), Kind: "tv"}
	scanner, store := openIdentityTestScanner(t, root)
	first := filepath.Join(root.Path, "Show", "Season 01", "Show.S01E01.mkv")
	second := filepath.Join(root.Path, "Show", "Season 01", "Show.S01E02.mkv")
	writeIdentityTestFile(t, first, []byte("same mistakenly copied episode"))
	writeIdentityTestFile(t, second, []byte("same mistakenly copied episode"))
	indexIdentityTestFile(t, scanner, root, first)
	indexIdentityTestFile(t, scanner, root, second)
	items := store.List(root.Name)
	if len(items) != 2 {
		t.Fatalf("conflicting episodes merged into %d item(s)", len(items))
	}
	if items[0].Hash == items[1].Hash {
		t.Fatalf("conflicting episodes share identity %q", items[0].Hash)
	}
	firstParts := strings.Split(items[0].Hash, ":")
	secondParts := strings.Split(items[1].Hash, ":")
	if len(firstParts) < 3 || len(secondParts) < 3 || firstParts[0] != secondParts[0] || firstParts[1] != secondParts[1] {
		t.Fatalf("conflict did not retain shared verified content key: %q vs %q", items[0].Hash, items[1].Hash)
	}
}

func TestSameSizeReplacementWithinOneSecondRehomesPath(t *testing.T) {
	root := config.LibraryRoot{Name: "Movies", Path: t.TempDir(), Kind: "movies"}
	scanner, store := openIdentityTestScanner(t, root)
	path := filepath.Join(root.Path, "Movie.2024.mkv")
	writeIdentityTestFile(t, path, []byte("AAAA"))
	firstTime := time.Unix(1_700_000_000, 100)
	if err := os.Chtimes(path, firstTime, firstTime); err != nil {
		t.Fatal(err)
	}
	indexIdentityTestFile(t, scanner, root, path)
	writeIdentityTestFile(t, path, []byte("BBBB"))
	secondTime := time.Unix(1_700_000_000, 500_000_000)
	if err := os.Chtimes(path, secondTime, secondTime); err != nil {
		t.Fatal(err)
	}
	indexIdentityTestFile(t, scanner, root, path)
	items := store.List(root.Name)
	if len(items) != 2 {
		t.Fatalf("replacement produced %d items, want old tombstone plus new item", len(items))
	}
	active := 0
	for _, item := range items {
		if item.State == library.StateActive {
			active++
			if len(item.Paths) != 1 || item.Paths[0] != path {
				t.Fatalf("active replacement paths = %v", item.Paths)
			}
		}
	}
	if active != 1 {
		t.Fatalf("active replacement count = %d, want 1", active)
	}
	_, mtime, _, ok := store.FileState(path)
	if !ok || mtime != secondTime.UnixNano() {
		t.Fatalf("cached mtime = %d (ok=%v), want %d", mtime, ok, secondTime.UnixNano())
	}
}
