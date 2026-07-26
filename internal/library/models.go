// Package library defines Lumina's core data model and the Store
// contract. The SQLite implementation (sqlite.go, modernc.org/sqlite —
// pure Go, no cgo, static binary preserved) is the only store; the
// Phase-0 JSON placeholder has been retired. See ARCHITECTURE.md §5.
package library

import "time"

// Store is the persistence contract the scanner and API depend on.
// Identity is ALWAYS the content hash, never a path.
type Store interface {
	// UpsertByHash inserts or updates the item identified by
	// (hash, libraryName). For a known hash, mutate receives a copy of
	// the EXISTING item (Paths, AddedAt preserved); for a new hash it
	// receives a fresh item with ID/Hash/Library/AddedAt set.
	UpsertByHash(hash, libraryName string, mutate func(it *Item)) (*Item, error)

	// MarkMissing tombstones every active item in a library that has no
	// path in present. Returns the count tombstoned — callers compare
	// against library size for the "everything is gone" safety halt.
	MarkMissing(library string, present map[string]bool) (int, error)

	// TombstonePath forgets one path. If the owning item has no paths
	// left, it becomes missing. Returns true if something changed.
	TombstonePath(path string) (bool, error)

	// Get returns one item by ID, or nil if unknown.
	Get(id string) (*Item, error)

	// List returns items (optionally filtered by library), title-sorted.
	List(library string) []Item

	// --- users + watch-state journal (Phase 3) ---

	ListUsers() ([]User, error)
	CreateUser(name string) (*User, error)
	// RecordPlayhead appends a journal row (server-assigned version).
	RecordPlayhead(userID, itemID string, positionMs, durationMs int64) error
	// Playheads derives latest state per item for a user.
	Playheads(userID string) (map[string]Playhead, error)
	// Playhead derives one (user, item) state; nil if never played.
	Playhead(userID, itemID string) (*Playhead, error)
	// RecentPlayheads returns the latest report per (user, item) written
	// since the cutoff — the "now playing" view.
	RecentPlayheads(since time.Time) ([]PlayheadReport, error)

	// SetMetadata writes provider results (real title, year, artwork).
	SetMetadata(id string, m Metadata) error

	// My List (per-user bookmarks). Toggle returns the NEW membership
	// state; MyListIDs returns the set the web client badges from.
	ToggleMyList(userID, itemID string) (bool, error)
	MyListIDs(userID string) (map[string]bool, error)

	// FileState returns the last-indexed (size, mtime, hash) for a path —
	// the scan accelerator that lets sweeps skip re-hashing unchanged files.
	FileState(path string) (size, mtime int64, hash string, ok bool)
	// SetFileState records what a path looked like when it was hashed.
	SetFileState(path string, size, mtime int64, hash string) error

	Close() error
}

type Kind string

const (
	KindMovie   Kind = "movie"
	KindEpisode Kind = "episode"
	// KindExtra is bonus content in Plex-style extras folders (Featurettes/,
	// Extras/, …) inside a movie/TV directory. Extras never go to the
	// metadata worker — TMDB doesn't index stage greetings and PVs.
	KindExtra Kind = "extra"
)

// ItemState implements the tombstone rule: a vanished file is "missing",
// never auto-purged. Dropped SMB mounts must not destroy libraries.
type ItemState string

const (
	StateActive  ItemState = "active"
	StateMissing ItemState = "missing"
)

type Item struct {
	ID        string    `json:"id"`
	Hash      string    `json:"hash"` // content hash — the item's true identity
	Kind      Kind      `json:"kind"`
	Library   string    `json:"library"`
	Title     string    `json:"title"`
	Year      int       `json:"year,omitempty"`
	State     ItemState `json:"state"`
	SizeBytes int64     `json:"sizeBytes"`
	// Paths is every location this item has been seen at (renames, hardlinks).
	Paths     []string  `json:"paths"`
	AddedAt   time.Time `json:"addedAt"`
	UpdatedAt time.Time `json:"updatedAt"`
	MissingAt time.Time `json:"missingAt,omitempty"`

	// Metadata (Phase 6): filled by the TMDB worker; empty = procedural
	// poster. User overrides (later phase) always win over providers.
	TMDBID      int      `json:"tmdbId,omitempty"`
	Overview    string   `json:"overview,omitempty"`
	PosterURL   string   `json:"posterUrl,omitempty"`
	BackdropURL string   `json:"backdropUrl,omitempty"`
	Genres      []string `json:"genres,omitempty"`
}

// Metadata is what a provider (TMDB first) knows about an item.
type Metadata struct {
	TMDBID      int      `json:"tmdbId"`
	Title       string   `json:"title"`
	Year        int      `json:"year"`
	Overview    string   `json:"overview"`
	PosterURL   string   `json:"posterUrl"`
	BackdropURL string   `json:"backdropUrl"`
	Genres      []string `json:"genres"`
}

// MediaFileExts is the scanner's accept list.
var MediaFileExts = map[string]bool{
	".mkv": true, ".mp4": true, ".m4v": true, ".avi": true,
	".mov": true, ".ts": true, ".m2ts": true, ".webm": true,
	".mpg": true, ".mpeg": true, ".wmv": true, ".flv": true,
}
