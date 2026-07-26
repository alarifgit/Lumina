// SQLite store (modernc.org/sqlite — pure Go, keeps the binary static).
//
// Schema notes:
//   - UNIQUE(hash, library) enforces content-hash identity.
//   - item_paths keeps every path an item has been seen at (renames,
//     hardlinks) with ON DELETE CASCADE.
//   - WAL mode + busy_timeout: single writer, concurrent readers.
//   - playheads (watch-state journal) is reserved here for Phase 3.
package library

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"time"

	_ "modernc.org/sqlite"
)

const schema = `
PRAGMA journal_mode = WAL;
PRAGMA busy_timeout = 5000;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS items (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    hash       TEXT    NOT NULL,
    library    TEXT    NOT NULL,
    kind       TEXT    NOT NULL,
    title      TEXT    NOT NULL DEFAULT '',
    year       INTEGER NOT NULL DEFAULT 0,
    state      TEXT    NOT NULL DEFAULT 'active',
    size_bytes INTEGER NOT NULL DEFAULT 0,
    added_at   TEXT    NOT NULL,
    updated_at TEXT    NOT NULL,
    missing_at TEXT,
    UNIQUE (hash, library)
);

CREATE TABLE IF NOT EXISTS item_paths (
    item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    path    TEXT    NOT NULL,
    seen_at TEXT    NOT NULL,
    PRIMARY KEY (item_id, path)
);
CREATE INDEX IF NOT EXISTS idx_items_library ON items(library, state);

-- Scan accelerator: last-indexed (size, mtime) per path. A file whose
-- stat matches is REUSED — its content hash is not recomputed. This is
-- the difference between a sweep reading 16 MiB per file over SMB and a
-- sweep doing one cheap stat per file.
CREATE TABLE IF NOT EXISTS file_states (
    path  TEXT    PRIMARY KEY,
    size  INTEGER NOT NULL,
    mtime INTEGER NOT NULL,
    hash  TEXT    NOT NULL
);

-- Phase 3: users + watch-state journal (append-only; resume state is derived).
CREATE TABLE IF NOT EXISTS users (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS playheads (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    item_id     INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    position_ms INTEGER NOT NULL,
    duration_ms INTEGER NOT NULL DEFAULT 0,
    version     INTEGER NOT NULL,
    created_at  TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_playheads_user_item ON playheads(user_id, item_id, version);

-- My List: per-user bookmarks (Plex's "Add to My List" / watchlist).
CREATE TABLE IF NOT EXISTS mylist (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    added_at TEXT NOT NULL,
    PRIMARY KEY (user_id, item_id)
);
`

// migrate handles post-Phase-1 schema drift: playheads created before
// duration_ms existed, and items created before Phase-6 metadata columns.
func (s *sqliteStore) migrate() error {
	if err := s.ensureColumn("playheads", "duration_ms",
		`ALTER TABLE playheads ADD COLUMN duration_ms INTEGER NOT NULL DEFAULT 0`); err != nil {
		return err
	}
	for _, col := range []struct{ name, ddl string }{
		{"tmdb_id", `ALTER TABLE items ADD COLUMN tmdb_id INTEGER NOT NULL DEFAULT 0`},
		{"overview", `ALTER TABLE items ADD COLUMN overview TEXT NOT NULL DEFAULT ''`},
		{"poster_url", `ALTER TABLE items ADD COLUMN poster_url TEXT NOT NULL DEFAULT ''`},
		{"backdrop_url", `ALTER TABLE items ADD COLUMN backdrop_url TEXT NOT NULL DEFAULT ''`},
		{"genres", `ALTER TABLE items ADD COLUMN genres TEXT NOT NULL DEFAULT '[]'`},
	} {
		if err := s.ensureColumn("items", col.name, col.ddl); err != nil {
			return err
		}
	}
	// Artwork quality bump (w780 → w1280 backdrops): stored URLs carry the
	// size in the path, so rewrite in place instead of re-fetching 6k items.
	// Idempotent — runs on every boot, rewrites only what still matches.
	for _, q := range []string{
		`UPDATE items SET backdrop_url = REPLACE(backdrop_url, '/t/p/w780/', '/t/p/w1280/') WHERE backdrop_url LIKE '%/t/p/w780/%'`,
	} {
		if _, err := s.db.Exec(q); err != nil {
			return fmt.Errorf("migrate artwork urls: %w", err)
		}
	}
	return nil
}

func (s *sqliteStore) ensureColumn(table, column, ddl string) error {
	var count int
	if err := s.db.QueryRow(
		`SELECT COUNT(*) FROM pragma_table_info(?) WHERE name=?`, table, column).
		Scan(&count); err != nil {
		return err
	}
	if count > 0 {
		return nil
	}
	if _, err := s.db.Exec(ddl); err != nil {
		return fmt.Errorf("migrate %s.%s: %w", table, column, err)
	}
	return nil
}

// SetMetadata writes provider (TMDB) results. Real title and year replace
// the filename-derived placeholders; artwork empty = procedural posters.
func (s *sqliteStore) SetMetadata(id string, m Metadata) error {
	genres, err := json.Marshal(m.Genres)
	if err != nil {
		genres = []byte("[]")
	}
	_, err = s.db.Exec(
		`UPDATE items SET tmdb_id=?, title=?, year=?, overview=?, poster_url=?, backdrop_url=?, genres=?, updated_at=?
		 WHERE id=?`,
		m.TMDBID, m.Title, m.Year, m.Overview, m.PosterURL, m.BackdropURL,
		string(genres), fmtTime(time.Now()), numericID(id))
	return err
}

type sqliteStore struct {
	db *sql.DB
}

// OpenStore opens (creating if needed) the SQLite database under dataDir.
func OpenStore(dataDir string) (Store, error) {
	if err := ensureDir(dataDir); err != nil {
		return nil, err
	}
	db, err := sql.Open("sqlite", filepath.Join(dataDir, "lumina.db"))
	if err != nil {
		return nil, fmt.Errorf("open sqlite: %w", err)
	}
	// Single writer: serialise at the driver level too, WAL allows readers.
	db.SetMaxOpenConns(1)
	if _, err := db.Exec(schema); err != nil {
		db.Close()
		return nil, fmt.Errorf("migrate: %w", err)
	}
	s := &sqliteStore{db: db}
	if err := s.migrate(); err != nil {
		db.Close()
		return nil, err
	}
	if err := s.ensureDefaultUser(); err != nil {
		db.Close()
		return nil, fmt.Errorf("seed default user: %w", err)
	}
	return s, nil
}

func (s *sqliteStore) Close() error { return s.db.Close() }

// FileState returns the last-indexed (size, mtime, hash) for a path.
// ok=false means the path was never indexed (or the row was lost).
func (s *sqliteStore) FileState(path string) (size, mtime int64, hash string, ok bool) {
	err := s.db.QueryRow(
		`SELECT size, mtime, hash FROM file_states WHERE path=?`, path).
		Scan(&size, &mtime, &hash)
	if err != nil {
		return 0, 0, "", false
	}
	return size, mtime, hash, true
}

// SetFileState records what a path looked like when it was hashed.
func (s *sqliteStore) SetFileState(path string, size, mtime int64, hash string) error {
	_, err := s.db.Exec(
		`INSERT INTO file_states (path, size, mtime, hash) VALUES (?, ?, ?, ?)
		 ON CONFLICT (path) DO UPDATE SET size=excluded.size, mtime=excluded.mtime, hash=excluded.hash`,
		path, size, mtime, hash)
	return err
}

func (s *sqliteStore) UpsertByHash(hash, libraryName string, mutate func(it *Item)) (*Item, error) {
	tx, err := s.db.Begin()
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	it, err := getItemByHashTx(tx, hash, libraryName)
	if err != nil && err != sql.ErrNoRows {
		return nil, err
	}
	isNew := it == nil
	if isNew {
		it = &Item{Hash: hash, Library: libraryName, AddedAt: time.Now()}
	}
	mutate(it)
	it.Hash = hash // identity fields are store-owned
	it.Library = libraryName
	it.UpdatedAt = time.Now()

	if isNew {
		res, err := tx.Exec(
			`INSERT INTO items (hash, library, kind, title, year, state, size_bytes, added_at, updated_at, missing_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			it.Hash, it.Library, string(it.Kind), it.Title, it.Year, string(it.State),
			it.SizeBytes, fmtTime(it.AddedAt), fmtTime(it.UpdatedAt), fmtTimePtr(it.MissingAt),
		)
		if err != nil {
			return nil, fmt.Errorf("insert item: %w", err)
		}
		id, _ := res.LastInsertId()
		it.ID = fmt.Sprintf("itm-%d", id)
	} else {
		if _, err := tx.Exec(
			`UPDATE items SET kind=?, title=?, year=?, state=?, size_bytes=?, added_at=?, updated_at=?, missing_at=?
			 WHERE id=?`,
			string(it.Kind), it.Title, it.Year, string(it.State), it.SizeBytes,
			fmtTime(it.AddedAt), fmtTime(it.UpdatedAt), fmtTimePtr(it.MissingAt), numericID(it.ID),
		); err != nil {
			return nil, fmt.Errorf("update item: %w", err)
		}
	}

	// Sync paths: upsert each path, keep history.
	for _, p := range it.Paths {
		if _, err := tx.Exec(
			`INSERT INTO item_paths (item_id, path, seen_at) VALUES (?, ?, ?)
			 ON CONFLICT (item_id, path) DO UPDATE SET seen_at=excluded.seen_at`,
			numericID(it.ID), p, fmtTime(time.Now()),
		); err != nil {
			return nil, fmt.Errorf("upsert path: %w", err)
		}
	}
	// Reload authoritative path list (history may exceed what mutate set).
	paths, err := pathsForTx(tx, numericID(it.ID))
	if err != nil {
		return nil, err
	}
	it.Paths = paths

	return it, tx.Commit()
}

func (s *sqliteStore) MarkMissing(libraryName string, present map[string]bool) (int, error) {
	items := s.List(libraryName)
	missing := 0
	for _, it := range items {
		if it.State != StateActive {
			continue
		}
		seen := false
		for _, p := range it.Paths {
			if present[p] {
				seen = true
				break
			}
		}
		if seen {
			continue
		}
		if _, err := s.db.Exec(
			`UPDATE items SET state=?, missing_at=?, updated_at=? WHERE id=?`,
			string(StateMissing), fmtTime(time.Now()), fmtTime(time.Now()), numericID(it.ID),
		); err != nil {
			return missing, err
		}
		missing++
	}
	return missing, nil
}

func (s *sqliteStore) TombstonePath(path string) (bool, error) {
	res, err := s.db.Exec(`DELETE FROM item_paths WHERE path=?`, path)
	if err != nil {
		return false, err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return false, nil
	}
	// Items left with no paths become missing.
	if _, err := s.db.Exec(
		`UPDATE items SET state=?, missing_at=?, updated_at=?
		 WHERE state=? AND NOT EXISTS (SELECT 1 FROM item_paths WHERE item_id = items.id)`,
		string(StateMissing), fmtTime(time.Now()), fmtTime(time.Now()), string(StateActive),
	); err != nil {
		return true, err
	}
	return true, nil
}

func (s *sqliteStore) Get(id string) (*Item, error) {
	row := s.db.QueryRow(
		`SELECT id, hash, library, kind, title, year, state, size_bytes, added_at, updated_at, missing_at,
		        tmdb_id, overview, poster_url, backdrop_url, genres
		 FROM items WHERE id=?`, numericID(id))
	var it Item
	var rowID int64
	var kind, state, added, updated string
	var missing sql.NullString
	var genres string
	if err := row.Scan(&rowID, &it.Hash, &it.Library, &kind, &it.Title, &it.Year,
		&state, &it.SizeBytes, &added, &updated, &missing,
		&it.TMDBID, &it.Overview, &it.PosterURL, &it.BackdropURL, &genres); err != nil {
		if err == sql.ErrNoRows {
			return nil, nil
		}
		return nil, err
	}
	it.ID = id
	it.Kind = Kind(kind)
	it.State = ItemState(state)
	it.AddedAt = parseTime(added)
	it.UpdatedAt = parseTime(updated)
	if missing.Valid {
		it.MissingAt = parseTime(missing.String)
	}
	_ = json.Unmarshal([]byte(genres), &it.Genres)
	paths, err := s.pathsFor(rowID)
	if err != nil {
		return nil, err
	}
	it.Paths = paths
	return &it, nil
}

func (s *sqliteStore) List(libraryName string) []Item {
	q := `SELECT id, hash, library, kind, title, year, state, size_bytes, added_at, updated_at, missing_at,
	             tmdb_id, overview, poster_url, backdrop_url, genres FROM items`
	args := []any{}
	if libraryName != "" {
		q += ` WHERE library=?`
		args = append(args, libraryName)
	}
	rows, err := s.db.Query(q, args...)
	if err != nil {
		return nil
	}

	out := []Item{}
	ids := []int64{}
	for rows.Next() {
		var it Item
		var id int64
		var kind, state, added, updated string
		var missing sql.NullString
		var genres string
		if err := rows.Scan(&id, &it.Hash, &it.Library, &kind, &it.Title, &it.Year,
			&state, &it.SizeBytes, &added, &updated, &missing,
			&it.TMDBID, &it.Overview, &it.PosterURL, &it.BackdropURL, &genres); err != nil {
			continue
		}
		it.ID = fmt.Sprintf("itm-%d", id)
		it.Kind = Kind(kind)
		it.State = ItemState(state)
		it.AddedAt = parseTime(added)
		it.UpdatedAt = parseTime(updated)
		if missing.Valid {
			it.MissingAt = parseTime(missing.String)
		}
		_ = json.Unmarshal([]byte(genres), &it.Genres)
		out = append(out, it)
		ids = append(ids, id)
	}
	// Close BEFORE fetching paths: the pool is capped at one connection, so a
	// nested query while rows is open deadlocks against itself.
	if err := rows.Close(); err != nil {
		return nil
	}
	for i, id := range ids {
		out[i].Paths, _ = s.pathsFor(id)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Title < out[j].Title })
	return out
}

// --- helpers ---------------------------------------------------------------

func getItemByHashTx(tx *sql.Tx, hash, libraryName string) (*Item, error) {
	row := tx.QueryRow(
		`SELECT id, kind, title, year, state, size_bytes, added_at, updated_at, missing_at, tmdb_id
		 FROM items WHERE hash=? AND library=?`, hash, libraryName)
	var it Item
	var id int64
	var kind, state, added, updated string
	var missing sql.NullString
	if err := row.Scan(&id, &kind, &it.Title, &it.Year, &state, &it.SizeBytes,
		&added, &updated, &missing, &it.TMDBID); err != nil {
		return nil, err
	}
	it.ID = fmt.Sprintf("itm-%d", id)
	it.Hash = hash
	it.Library = libraryName
	it.Kind = Kind(kind)
	it.State = ItemState(state)
	it.AddedAt = parseTime(added)
	it.UpdatedAt = parseTime(updated)
	if missing.Valid {
		it.MissingAt = parseTime(missing.String)
	}
	paths, err := pathsForTx(tx, id)
	if err != nil {
		return nil, err
	}
	it.Paths = paths
	return &it, nil
}

func pathsForTx(q interface {
	Query(string, ...any) (*sql.Rows, error)
}, itemID int64) ([]string, error) {
	rows, err := q.Query(`SELECT path FROM item_paths WHERE item_id=? ORDER BY seen_at`, itemID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []string{}
	for rows.Next() {
		var p string
		if err := rows.Scan(&p); err == nil {
			out = append(out, p)
		}
	}
	return out, rows.Err()
}

func (s *sqliteStore) pathsFor(itemID int64) ([]string, error) {
	return pathsForTx(s.db, itemID)
}

func ensureDir(dir string) error { return os.MkdirAll(dir, 0o755) }

func numericID(id string) int64 {
	var n int64
	fmt.Sscanf(id, "itm-%d", &n)
	return n
}

// Times are stored as RFC3339Nano strings: modernc.org/sqlite handles TEXT
// cleanly, and it keeps zero-vs-NULL semantics explicit.
func fmtTime(t time.Time) string { return t.UTC().Format(time.RFC3339Nano) }

func fmtTimePtr(t time.Time) any {
	if t.IsZero() {
		return nil
	}
	return fmtTime(t)
}

func parseTime(s string) time.Time {
	t, _ := time.Parse(time.RFC3339Nano, s)
	return t
}
