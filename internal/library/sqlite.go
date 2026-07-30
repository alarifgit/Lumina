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
	"strings"
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

-- Durable root registry: a display-name edit at an unchanged path is a
-- rename, not a new identity namespace. The scanner syncs this table before
-- starting or replacing root watchers.
CREATE TABLE IF NOT EXISTS library_roots (
    path       TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    kind       TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_library_roots_name ON library_roots(name);

-- Constant-time change token for lightweight client polling. Item writes bump
-- the singleton revision through triggers, including metadata and tombstones.
CREATE TABLE IF NOT EXISTS catalog_revision (
    id       INTEGER PRIMARY KEY CHECK (id = 1),
    revision INTEGER NOT NULL DEFAULT 0
);
INSERT OR IGNORE INTO catalog_revision (id, revision) VALUES (1, 0);
CREATE TRIGGER IF NOT EXISTS items_revision_insert AFTER INSERT ON items BEGIN
    UPDATE catalog_revision SET revision = revision + 1 WHERE id = 1;
END;
CREATE TRIGGER IF NOT EXISTS items_revision_update AFTER UPDATE ON items BEGIN
    UPDATE catalog_revision SET revision = revision + 1 WHERE id = 1;
END;
CREATE TRIGGER IF NOT EXISTS items_revision_delete AFTER DELETE ON items BEGIN
    UPDATE catalog_revision SET revision = revision + 1 WHERE id = 1;
END;

-- Scan accelerator: last-indexed (size, nanosecond mtime) per path. A file
-- whose stat matches reuses its resolved identity. This is
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
    avatar     TEXT NOT NULL DEFAULT '',
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
// duration_ms existed, items created before Phase-6 metadata columns,
// users created before avatars.
func (s *sqliteStore) migrate() error {
	if err := s.ensureColumn("playheads", "duration_ms",
		`ALTER TABLE playheads ADD COLUMN duration_ms INTEGER NOT NULL DEFAULT 0`); err != nil {
		return err
	}
	if err := s.ensureColumn("users", "avatar",
		`ALTER TABLE users ADD COLUMN avatar TEXT NOT NULL DEFAULT ''`); err != nil {
		return err
	}
	for _, col := range []struct{ name, ddl string }{
		{"tmdb_id", `ALTER TABLE items ADD COLUMN tmdb_id INTEGER NOT NULL DEFAULT 0`},
		{"overview", `ALTER TABLE items ADD COLUMN overview TEXT NOT NULL DEFAULT ''`},
		{"poster_url", `ALTER TABLE items ADD COLUMN poster_url TEXT NOT NULL DEFAULT ''`},
		{"backdrop_url", `ALTER TABLE items ADD COLUMN backdrop_url TEXT NOT NULL DEFAULT ''`},
		{"genres", `ALTER TABLE items ADD COLUMN genres TEXT NOT NULL DEFAULT '[]'`},
		{"orig_title", `ALTER TABLE items ADD COLUMN orig_title TEXT NOT NULL DEFAULT ''`},
	} {
		if err := s.ensureColumn("items", col.name, col.ddl); err != nil {
			return err
		}
	}
	if err := s.ensureGlobalPathOwnership(); err != nil {
		return err
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

// ensureGlobalPathOwnership repairs historic rows where one filesystem path
// belonged to several items, then makes single ownership a database invariant.
func (s *sqliteStore) ensureGlobalPathOwnership() error {
	var indexExists int
	if err := s.db.QueryRow(
		`SELECT COUNT(*) FROM sqlite_master WHERE type='index' AND name='idx_item_paths_unique_path'`,
	).Scan(&indexExists); err != nil {
		return err
	}
	if indexExists > 0 {
		return nil
	}
	queries := []string{
		// Prefer the owner whose identity matches the cached fingerprint.
		`DELETE FROM item_paths
		 WHERE rowid IN (
		   SELECT ip.rowid FROM item_paths ip
		   JOIN items current_item ON current_item.id=ip.item_id
		   JOIN file_states fs ON fs.path=ip.path
		   WHERE current_item.hash<>fs.hash
		     AND EXISTS (
		       SELECT 1 FROM item_paths preferred
		       JOIN items preferred_item ON preferred_item.id=preferred.item_id
		       WHERE preferred.path=ip.path AND preferred_item.hash=fs.hash
		     )
		 )`,
		// Any ambiguity left is old data with no authoritative cache entry.
		`DELETE FROM item_paths
		 WHERE rowid NOT IN (SELECT MAX(rowid) FROM item_paths GROUP BY path)`,
		`UPDATE items SET state='missing', missing_at=COALESCE(missing_at, updated_at)
		 WHERE state='active' AND NOT EXISTS (
		   SELECT 1 FROM item_paths WHERE item_id=items.id
		 )`,
		`CREATE UNIQUE INDEX IF NOT EXISTS idx_item_paths_unique_path ON item_paths(path)`,
	}
	for _, q := range queries {
		if _, err := s.db.Exec(q); err != nil {
			return fmt.Errorf("migrate path ownership: %w", err)
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
		`UPDATE items SET tmdb_id=?, title=?, orig_title=?, year=?, overview=?, poster_url=?, backdrop_url=?, genres=?, updated_at=?
		 WHERE id=?`,
		m.TMDBID, m.Title, m.OrigTitle, m.Year, m.Overview, m.PosterURL, m.BackdropURL,
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

	// A live filesystem path has exactly one owner. Rehome it before the
	// unique-path insert so in-place replacements cannot leave ghost items.
	itemID := numericID(it.ID)
	for _, p := range it.Paths {
		if _, err := tx.Exec(
			`DELETE FROM item_paths WHERE path=? AND item_id<>?`, p, itemID); err != nil {
			return nil, fmt.Errorf("rehome path: %w", err)
		}
		if _, err := tx.Exec(
			`INSERT INTO item_paths (item_id, path, seen_at) VALUES (?, ?, ?)
			 ON CONFLICT (item_id, path) DO UPDATE SET seen_at=excluded.seen_at`,
			itemID, p, fmtTime(time.Now()),
		); err != nil {
			return nil, fmt.Errorf("upsert path: %w", err)
		}
	}
	now := fmtTime(time.Now())
	if _, err := tx.Exec(
		`UPDATE items SET state=?, missing_at=?, updated_at=?
		 WHERE state=? AND NOT EXISTS (SELECT 1 FROM item_paths WHERE item_id=items.id)`,
		string(StateMissing), now, now, string(StateActive),
	); err != nil {
		return nil, fmt.Errorf("tombstone previous path owner: %w", err)
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
	tx, err := s.db.Begin()
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()
	missing := 0
	now := fmtTime(time.Now())
	for _, it := range items {
		seen := false
		pruned := false
		for _, p := range it.Paths {
			if present[p] {
				seen = true
				continue
			}
			if _, err := tx.Exec(
				`DELETE FROM item_paths WHERE item_id=? AND path=?`, numericID(it.ID), p,
			); err != nil {
				return missing, err
			}
			if _, err := tx.Exec(`DELETE FROM file_states WHERE path=?`, p); err != nil {
				return missing, err
			}
			pruned = true
		}
		if it.State == StateActive && !seen {
			if _, err := tx.Exec(
				`UPDATE items SET state=?, missing_at=?, updated_at=? WHERE id=?`,
				string(StateMissing), now, now, numericID(it.ID),
			); err != nil {
				return missing, err
			}
			missing++
		} else if pruned {
			if _, err := tx.Exec(`UPDATE items SET updated_at=? WHERE id=?`, now, numericID(it.ID)); err != nil {
				return missing, err
			}
		}
	}
	if err := tx.Commit(); err != nil {
		return missing, err
	}
	return missing, nil
}

func (s *sqliteStore) TombstonePath(path string) (bool, error) {
	// A directory rename/remove event names only the directory. Forget both
	// that exact path and every tracked child so items cannot remain active
	// with paths that no longer exist. Escape LIKE metacharacters because
	// valid media paths may contain '%' or '_'.
	escapeLike := func(v string) string {
		r := strings.NewReplacer(`\`, `\\`, "%", `\%`, "_", `\_`)
		return r.Replace(filepath.Clean(v))
	}
	pattern := escapeLike(path) + string(os.PathSeparator) + "%"
	tx, err := s.db.Begin()
	if err != nil {
		return false, err
	}
	defer tx.Rollback()
	res, err := tx.Exec(`DELETE FROM item_paths WHERE path=? OR path LIKE ? ESCAPE '\'`, path, pattern)
	if err != nil {
		return false, err
	}
	if _, err := tx.Exec(`DELETE FROM file_states WHERE path=? OR path LIKE ? ESCAPE '\'`, path, pattern); err != nil {
		return false, err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return false, tx.Commit()
	}
	// Items left with no paths become missing.
	if _, err := tx.Exec(
		`UPDATE items SET state=?, missing_at=?, updated_at=?
		 WHERE state=? AND NOT EXISTS (SELECT 1 FROM item_paths WHERE item_id = items.id)`,
		string(StateMissing), fmtTime(time.Now()), fmtTime(time.Now()), string(StateActive),
	); err != nil {
		return true, err
	}
	return true, tx.Commit()
}

// RekeyItemHash rewrites an item's stored content hash. The scanner's
// reconcile pass uses it when the stored hash matches none of the item's
// files (historic damage predating content-hash identity). UNIQUE(hash,
// library) may refuse — the caller leaves the item as-is and logs it.
func (s *sqliteStore) RekeyItemHash(id, hash string) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	itemID := numericID(id)
	if _, err := tx.Exec(`UPDATE items SET hash=?, updated_at=? WHERE id=?`,
		hash, fmtTime(time.Now()), itemID); err != nil {
		return err
	}
	if _, err := tx.Exec(
		`UPDATE file_states SET hash=? WHERE path IN (
		   SELECT path FROM item_paths WHERE item_id=?
		 )`,
		hash, itemID,
	); err != nil {
		return err
	}
	return tx.Commit()
}

func (s *sqliteStore) Get(id string) (*Item, error) {
	row := s.db.QueryRow(
		`SELECT id, hash, library, kind, title, year, state, size_bytes, added_at, updated_at, missing_at,
		        tmdb_id, orig_title, overview, poster_url, backdrop_url, genres
		 FROM items WHERE id=?`, numericID(id))
	var it Item
	var rowID int64
	var kind, state, added, updated string
	var missing sql.NullString
	var genres string
	if err := row.Scan(&rowID, &it.Hash, &it.Library, &kind, &it.Title, &it.Year,
		&state, &it.SizeBytes, &added, &updated, &missing,
		&it.TMDBID, &it.OrigTitle, &it.Overview, &it.PosterURL, &it.BackdropURL, &genres); err != nil {
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
	             tmdb_id, orig_title, overview, poster_url, backdrop_url, genres FROM items`
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
			&it.TMDBID, &it.OrigTitle, &it.Overview, &it.PosterURL, &it.BackdropURL, &genres); err != nil {
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

func (s *sqliteStore) HashCandidates(sampleHash, libraryName string) ([]Item, error) {
	rows, err := s.db.Query(
		`SELECT id FROM items
		 WHERE library=? AND (hash=? OR hash GLOB ?)`,
		libraryName, sampleHash, sampleHash+":*")
	if err != nil {
		return nil, err
	}
	ids := []int64{}
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			_ = rows.Close()
			return nil, err
		}
		ids = append(ids, id)
	}
	if err := rows.Err(); err != nil {
		_ = rows.Close()
		return nil, err
	}
	if err := rows.Close(); err != nil {
		return nil, err
	}
	out := make([]Item, 0, len(ids))
	for _, id := range ids {
		it, err := s.Get(fmt.Sprintf("itm-%d", id))
		if err != nil {
			return nil, err
		}
		if it != nil {
			out = append(out, *it)
		}
	}
	return out, nil
}

func (s *sqliteStore) CatalogRevision() (count int, revision int64, err error) {
	err = s.db.QueryRow(
		`SELECT (SELECT COUNT(*) FROM items), revision FROM catalog_revision WHERE id=1`,
	).Scan(&count, &revision)
	return count, revision, err
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
