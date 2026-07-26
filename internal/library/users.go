// Users and the watch-state journal.
//
// The journal is APPEND-ONLY: every playhead report is a new row with a
// per-(user,item) monotonically increasing version. Resume position and
// the watched flag are DERIVED from the latest row, never stored as
// mutable state — this is what makes watch state effectively unbreakable
// (ARCHITECTURE.md §2, principle 1 + §5). Rows reference items by their
// internal ID, which is anchored to the content hash: rename the file,
// remount the share, and resume points still land exactly where they were.
package library

import (
	"database/sql"
	"fmt"
	"time"
)

type User struct {
	ID        string    `json:"id"`
	Name      string    `json:"name"`
	CreatedAt time.Time `json:"createdAt"`
}

// Playhead is the DERIVED current state for one (user, item) — computed
// from the journal's newest row, never stored.
type Playhead struct {
	ItemID      string    `json:"itemId"`
	PositionMs  int64     `json:"positionMs"`
	DurationMs  int64     `json:"durationMs"`
	Watched     bool      `json:"watched"`
	Version     int64     `json:"version"`
	UpdatedAt   time.Time `json:"updatedAt"`
}

// watchedThreshold: past this fraction, an item counts as watched and
// resume resets to the beginning.
const watchedThreshold = 0.92

const defaultUserName = "admin"

// ensureDefaultUser seeds the single-user default. Real multi-user +
// auth arrives in a later phase; the journal is already per-user.
func (s *sqliteStore) ensureDefaultUser() error {
	_, err := s.db.Exec(
		`INSERT OR IGNORE INTO users (name, created_at) VALUES (?, ?)`,
		defaultUserName, fmtTime(time.Now()))
	return err
}

func (s *sqliteStore) ListUsers() ([]User, error) {
	rows, err := s.db.Query(`SELECT id, name, created_at FROM users ORDER BY id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []User{}
	for rows.Next() {
		var u User
		var id int64
		var created string
		if err := rows.Scan(&id, &u.Name, &created); err != nil {
			continue
		}
		u.ID = fmt.Sprintf("usr-%d", id)
		u.CreatedAt = parseTime(created)
		out = append(out, u)
	}
	return out, rows.Err()
}

// CreateUser adds a user and returns it.
func (s *sqliteStore) CreateUser(name string) (*User, error) {
	res, err := s.db.Exec(
		`INSERT INTO users (name, created_at) VALUES (?, ?)`,
		name, fmtTime(time.Now()))
	if err != nil {
		return nil, err
	}
	id, _ := res.LastInsertId()
	return &User{ID: fmt.Sprintf("usr-%d", id), Name: name, CreatedAt: time.Now()}, nil
}

// RecordPlayhead appends one journal row. The version is assigned
// server-side (single-writer SQLite makes this race-free) so out-of-order
// or replayed client reports can't corrupt the derived state.
func (s *sqliteStore) RecordPlayhead(userID, itemID string, positionMs, durationMs int64) error {
	_, err := s.db.Exec(
		`INSERT INTO playheads (user_id, item_id, position_ms, duration_ms, version, created_at)
		 SELECT ?, ?, ?, ?,
		        COALESCE(MAX(version), 0) + 1,
		        ?
		 FROM playheads WHERE user_id=? AND item_id=?`,
		numericUserID(userID), numericID(itemID), positionMs, durationMs,
		fmtTime(time.Now()), numericUserID(userID), numericID(itemID))
	return err
}

// Playheads derives the latest state per item for a user — one map,
// exactly what the web client needs to render progress bars.
func (s *sqliteStore) Playheads(userID string) (map[string]Playhead, error) {
	rows, err := s.db.Query(
		`SELECT p.item_id, p.position_ms, p.duration_ms, p.version, p.created_at
		 FROM playheads p
		 JOIN (
		     SELECT item_id, MAX(version) AS v
		     FROM playheads WHERE user_id=?
		     GROUP BY item_id
		 ) latest ON latest.item_id = p.item_id AND latest.v = p.version
		 WHERE p.user_id=?`, numericUserID(userID), numericUserID(userID))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]Playhead{}
	for rows.Next() {
		var itemID, pos, dur, ver int64
		var created string
		if err := rows.Scan(&itemID, &pos, &dur, &ver, &created); err != nil {
			continue
		}
		ph := Playhead{
			ItemID:     fmt.Sprintf("itm-%d", itemID),
			PositionMs: pos,
			DurationMs: dur,
			Version:    ver,
			UpdatedAt:  parseTime(created),
		}
		ph.Watched = dur > 0 && float64(pos)/float64(dur) >= watchedThreshold
		out[ph.ItemID] = ph
	}
	return out, rows.Err()
}

// Playhead derives one (user, item) state, or nil if never played.
func (s *sqliteStore) Playhead(userID, itemID string) (*Playhead, error) {
	row := s.db.QueryRow(
		`SELECT position_ms, duration_ms, version, created_at
		 FROM playheads WHERE user_id=? AND item_id=?
		 ORDER BY version DESC LIMIT 1`,
		numericUserID(userID), numericID(itemID))
	var ph Playhead
	var created string
	if err := row.Scan(&ph.PositionMs, &ph.DurationMs, &ph.Version, &created); err != nil {
		if err == sql.ErrNoRows {
			return nil, nil
		}
		return nil, err
	}
	ph.ItemID = itemID
	ph.UpdatedAt = parseTime(created)
	ph.Watched = ph.DurationMs > 0 &&
		float64(ph.PositionMs)/float64(ph.DurationMs) >= watchedThreshold
	return &ph, nil
}

// PlayheadReport is one user's latest journal row for one item, with the
// report time attached — the "who is watching what right now" view.
type PlayheadReport struct {
	UserID     string    `json:"userId"`
	ItemID     string    `json:"itemId"`
	PositionMs int64     `json:"positionMs"`
	DurationMs int64     `json:"durationMs"`
	ReportedAt time.Time `json:"reportedAt"`
}

// RecentPlayheads returns the LATEST report per (user, item) among rows
// written since the cutoff. A client reports every ~10s during playback,
// so a 2-minute window is exactly "currently watching".
func (s *sqliteStore) RecentPlayheads(since time.Time) ([]PlayheadReport, error) {
	rows, err := s.db.Query(
		`SELECT p.user_id, p.item_id, p.position_ms, p.duration_ms, p.created_at
		 FROM playheads p
		 JOIN (
		     SELECT user_id, item_id, MAX(version) AS v
		     FROM playheads GROUP BY user_id, item_id
		 ) latest ON latest.user_id = p.user_id AND latest.item_id = p.item_id
		          AND latest.v = p.version
		 WHERE p.created_at >= ?
		 ORDER BY p.created_at DESC`, fmtTime(since))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []PlayheadReport{}
	for rows.Next() {
		var uid, iid, pos, dur int64
		var created string
		if err := rows.Scan(&uid, &iid, &pos, &dur, &created); err != nil {
			continue
		}
		out = append(out, PlayheadReport{
			UserID:     fmt.Sprintf("usr-%d", uid),
			ItemID:     fmt.Sprintf("itm-%d", iid),
			PositionMs: pos,
			DurationMs: dur,
			ReportedAt: parseTime(created),
		})
	}
	return out, rows.Err()
}

func numericUserID(id string) int64 {
	var n int64
	fmt.Sscanf(id, "usr-%d", &n)
	return n
}

// ToggleMyList flips one (user, item) bookmark and returns the NEW state.
func (s *sqliteStore) ToggleMyList(userID, itemID string) (bool, error) {
	res, err := s.db.Exec(
		`DELETE FROM mylist WHERE user_id=? AND item_id=?`,
		numericUserID(userID), numericID(itemID))
	if err != nil {
		return false, err
	}
	if n, _ := res.RowsAffected(); n > 0 {
		return false, nil // was present → now removed
	}
	if _, err := s.db.Exec(
		`INSERT INTO mylist (user_id, item_id, added_at) VALUES (?, ?, ?)`,
		numericUserID(userID), numericID(itemID), fmtTime(time.Now())); err != nil {
		return false, err
	}
	return true, nil
}

// MyListIDs returns the bookmarked item-ID set for one user.
func (s *sqliteStore) MyListIDs(userID string) (map[string]bool, error) {
	rows, err := s.db.Query(
		`SELECT item_id FROM mylist WHERE user_id=?`, numericUserID(userID))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]bool{}
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			continue
		}
		out[fmt.Sprintf("itm-%d", id)] = true
	}
	return out, rows.Err()
}
