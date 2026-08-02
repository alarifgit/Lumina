package library

import (
	"database/sql"
	"fmt"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

// ReconcileLibraries makes mutable library configuration safe for durable
// item identity. It runs before root scans: registered same-path renames are
// applied in place, known identity-shadow rows are consolidated with their
// user state, and ownership from removed roots is retired. A sampled hash is
// never enough to merge two live files; the only sample-prefix repairs here
// are pathless historical predecessors with unambiguous provenance.
func (s *sqliteStore) ReconcileLibraries(roots []LibraryRoot) (LibraryReconcileResult, error) {
	result := LibraryReconcileResult{}
	roots = normalizeLibraryRoots(roots)
	tx, err := s.db.Begin()
	if err != nil {
		return result, err
	}
	defer tx.Rollback()

	registered, err := registeredRootsTx(tx)
	if err != nil {
		return result, err
	}
	for _, root := range roots {
		previous, ok := registered[root.Path]
		if !ok || previous.Name == root.Name {
			continue
		}
		renamed, merged, err := renameLibraryTx(tx, previous.Name, root.Name)
		if err != nil {
			return result, fmt.Errorf("rename library %q to %q: %w", previous.Name, root.Name, err)
		}
		result.Renamed += renamed
		result.Merged += merged
	}

	merged, err := repairIdentityShadowsTx(tx, rootNames(roots))
	if err != nil {
		return result, err
	}
	result.Merged += merged

	renamed, merged, err := rehomeConfiguredPathsTx(tx, roots)
	if err != nil {
		return result, err
	}
	result.Renamed += renamed
	result.Merged += merged

	// First deployment of the registry has no old path/name mapping. Recover
	// matched, pathless predecessors only when exactly one active item in a
	// configured library has the same historic sample and provider identity.
	merged, err = repairRetiredShadowsTx(tx, rootNames(roots))
	if err != nil {
		return result, err
	}
	result.Merged += merged

	retired, err := retireRemovedLibrariesTx(tx, rootNames(roots))
	if err != nil {
		return result, err
	}
	result.Retired += retired

	if _, err := tx.Exec(`DELETE FROM library_roots`); err != nil {
		return result, err
	}
	now := fmtTime(time.Now())
	for _, root := range roots {
		if _, err := tx.Exec(
			`INSERT INTO library_roots (path, name, kind, updated_at) VALUES (?, ?, ?, ?)`,
			root.Path, root.Name, root.Kind, now,
		); err != nil {
			return result, err
		}
	}
	if err := tx.Commit(); err != nil {
		return result, err
	}
	return result, nil
}

func normalizeLibraryRoots(roots []LibraryRoot) []LibraryRoot {
	out := make([]LibraryRoot, 0, len(roots))
	for _, root := range roots {
		root.Name = strings.TrimSpace(root.Name)
		root.Path = filepath.Clean(strings.TrimSpace(root.Path))
		root.Kind = strings.TrimSpace(root.Kind)
		if root.Name == "" || root.Path == "." {
			continue
		}
		out = append(out, root)
	}
	sort.Slice(out, func(i, j int) bool { return len(out[i].Path) > len(out[j].Path) })
	return out
}

func rootNames(roots []LibraryRoot) map[string]bool {
	out := make(map[string]bool, len(roots))
	for _, root := range roots {
		out[root.Name] = true
	}
	return out
}

func registeredRootsTx(tx *sql.Tx) (map[string]LibraryRoot, error) {
	rows, err := tx.Query(`SELECT name, path, kind FROM library_roots`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]LibraryRoot{}
	for rows.Next() {
		var root LibraryRoot
		if err := rows.Scan(&root.Name, &root.Path, &root.Kind); err != nil {
			return nil, err
		}
		out[filepath.Clean(root.Path)] = root
	}
	return out, rows.Err()
}

type reconcileItem struct {
	ID      int64
	Hash    string
	Library string
	Kind    string
	Title   string
	Year    int
	State   string
	TMDBID  int
	Paths   []string
}

func reconcileItemsTx(tx *sql.Tx) ([]reconcileItem, error) {
	rows, err := tx.Query(
		`SELECT i.id, i.hash, i.library, i.kind, i.title, i.year, i.state, i.tmdb_id,
		        COALESCE(ip.path, '')
		 FROM items i LEFT JOIN item_paths ip ON ip.item_id=i.id
		 ORDER BY i.id, ip.path`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []reconcileItem{}
	index := map[int64]int{}
	for rows.Next() {
		var item reconcileItem
		var path string
		if err := rows.Scan(&item.ID, &item.Hash, &item.Library, &item.Kind,
			&item.Title, &item.Year, &item.State, &item.TMDBID, &path); err != nil {
			return nil, err
		}
		at, ok := index[item.ID]
		if !ok {
			at = len(out)
			index[item.ID] = at
			out = append(out, item)
		}
		if path != "" {
			out[at].Paths = append(out[at].Paths, path)
		}
	}
	return out, rows.Err()
}

func renameLibraryTx(tx *sql.Tx, oldName, newName string) (renamed, merged int, err error) {
	items, err := reconcileItemsTx(tx)
	if err != nil {
		return 0, 0, err
	}
	for _, source := range items {
		if source.Library != oldName {
			continue
		}
		destination, ok, err := uniqueDestinationTx(tx, source, newName, true)
		if err != nil {
			return renamed, merged, err
		}
		if destination.ID < 0 {
			continue
		}
		if ok {
			if err := mergeItemReferencesTx(tx, source.ID, destination.ID); err != nil {
				return renamed, merged, err
			}
			merged++
			continue
		}
		if _, err := tx.Exec(`UPDATE items SET library=?, updated_at=? WHERE id=?`,
			newName, fmtTime(time.Now()), source.ID); err != nil {
			return renamed, merged, err
		}
		renamed++
	}
	return renamed, merged, nil
}

func repairIdentityShadowsTx(tx *sql.Tx, activeNames map[string]bool) (int, error) {
	items, err := reconcileItemsTx(tx)
	if err != nil {
		return 0, err
	}
	merged := 0
	for _, source := range items {
		if !activeNames[source.Library] || source.State != string(StateMissing) || len(source.Paths) != 0 || strings.Contains(source.Hash, ":") {
			continue
		}
		candidates := []reconcileItem{}
		for _, candidate := range items {
			if candidate.ID == source.ID || candidate.Library != source.Library || candidate.State != string(StateActive) || len(candidate.Paths) == 0 {
				continue
			}
			if strings.HasPrefix(candidate.Hash, source.Hash+":") && candidate.Kind == source.Kind {
				candidates = append(candidates, candidate)
			}
		}
		if len(candidates) != 1 {
			continue
		}
		if err := mergeItemReferencesTx(tx, source.ID, candidates[0].ID); err != nil {
			return merged, err
		}
		merged++
	}
	return merged, nil
}

func repairRetiredShadowsTx(tx *sql.Tx, activeNames map[string]bool) (int, error) {
	items, err := reconcileItemsTx(tx)
	if err != nil {
		return 0, err
	}
	merged := 0
	for _, source := range items {
		if activeNames[source.Library] || source.State != string(StateMissing) || len(source.Paths) != 0 || source.TMDBID <= 0 {
			continue
		}
		sample := sampleIdentity(source.Hash)
		candidates := []reconcileItem{}
		for _, candidate := range items {
			if !activeNames[candidate.Library] || candidate.State != string(StateActive) || len(candidate.Paths) == 0 {
				continue
			}
			if candidate.Kind == source.Kind && candidate.TMDBID == source.TMDBID && sampleIdentity(candidate.Hash) == sample {
				candidates = append(candidates, candidate)
			}
		}
		if len(candidates) != 1 {
			continue
		}
		if err := mergeItemReferencesTx(tx, source.ID, candidates[0].ID); err != nil {
			return merged, err
		}
		merged++
	}
	return merged, nil
}

func sampleIdentity(identity string) string {
	if at := strings.IndexByte(identity, ':'); at >= 0 {
		return identity[:at]
	}
	return identity
}

func rehomeConfiguredPathsTx(tx *sql.Tx, roots []LibraryRoot) (renamed, merged int, err error) {
	items, err := reconcileItemsTx(tx)
	if err != nil {
		return 0, 0, err
	}
	for _, source := range items {
		targetName := ""
		ambiguous := false
		for _, path := range source.Paths {
			root, ok := rootForPath(roots, path)
			if !ok {
				continue
			}
			if targetName != "" && targetName != root.Name {
				ambiguous = true
				break
			}
			targetName = root.Name
		}
		if ambiguous || targetName == "" || targetName == source.Library {
			continue
		}
		destination, ok, err := uniqueDestinationTx(tx, source, targetName, false)
		if err != nil {
			return renamed, merged, err
		}
		if destination.ID < 0 {
			continue
		}
		if ok {
			if err := mergeItemReferencesTx(tx, source.ID, destination.ID); err != nil {
				return renamed, merged, err
			}
			merged++
			continue
		}
		if _, err := tx.Exec(`UPDATE items SET library=?, updated_at=? WHERE id=?`,
			targetName, fmtTime(time.Now()), source.ID); err != nil {
			return renamed, merged, err
		}
		renamed++
	}
	return renamed, merged, nil
}

func rootForPath(roots []LibraryRoot, path string) (LibraryRoot, bool) {
	path = filepath.Clean(path)
	for _, root := range roots {
		if path == root.Path || strings.HasPrefix(path, root.Path+string(filepath.Separator)) {
			return root, true
		}
	}
	return LibraryRoot{}, false
}

func uniqueDestinationTx(tx *sql.Tx, source reconcileItem, libraryName string, allowVerifiedSuccessor bool) (reconcileItem, bool, error) {
	items, err := reconcileItemsTx(tx)
	if err != nil {
		return reconcileItem{}, false, err
	}
	exact := []reconcileItem{}
	verified := []reconcileItem{}
	blocked := false
	for _, candidate := range items {
		if candidate.ID == source.ID || candidate.Library != libraryName || candidate.Kind != source.Kind {
			continue
		}
		if candidate.Hash == source.Hash {
			// Equal sampled identities are not proof when both records still
			// own live paths. Leave them separate for the scanner to full-hash.
			if len(source.Paths) > 0 && len(candidate.Paths) > 0 && !strings.Contains(source.Hash, ":") {
				blocked = true
				continue
			}
			exact = append(exact, candidate)
			continue
		}
		if allowVerifiedSuccessor && sampleIdentity(candidate.Hash) == sampleIdentity(source.Hash) && strings.Contains(candidate.Hash, ":") {
			if source.TMDBID == 0 || candidate.TMDBID == 0 || source.TMDBID == candidate.TMDBID {
				verified = append(verified, candidate)
			}
		}
	}
	if blocked {
		return reconcileItem{ID: -1}, false, nil
	}
	if len(exact) == 1 {
		return exact[0], true, nil
	}
	if len(exact) == 0 && len(verified) == 1 {
		return verified[0], true, nil
	}
	return reconcileItem{}, false, nil
}

func mergeItemReferencesTx(tx *sql.Tx, sourceID, destinationID int64) error {
	if sourceID == destinationID {
		return nil
	}
	// Preserve the richer source metadata only where the live destination is
	// still empty; its active title/artwork otherwise remain authoritative.
	if _, err := tx.Exec(
		`UPDATE items AS dst SET
		   tmdb_id=CASE WHEN dst.tmdb_id=0 THEN src.tmdb_id ELSE dst.tmdb_id END,
		   orig_title=CASE WHEN dst.orig_title='' THEN src.orig_title ELSE dst.orig_title END,
		   overview=CASE WHEN dst.overview='' THEN src.overview ELSE dst.overview END,
		   poster_url=CASE WHEN dst.poster_url='' THEN src.poster_url ELSE dst.poster_url END,
		   backdrop_url=CASE WHEN dst.backdrop_url='' THEN src.backdrop_url ELSE dst.backdrop_url END,
		   genres=CASE WHEN dst.genres='[]' OR dst.genres='' THEN src.genres ELSE dst.genres END,
		   added_at=MIN(dst.added_at, src.added_at),
		   updated_at=?
		 FROM items AS src WHERE dst.id=? AND src.id=?`,
		fmtTime(time.Now()), destinationID, sourceID,
	); err != nil {
		return err
	}
	if _, err := tx.Exec(
		`INSERT OR IGNORE INTO mylist (user_id, item_id, added_at)
		 SELECT user_id, ?, added_at FROM mylist WHERE item_id=?`,
		destinationID, sourceID,
	); err != nil {
		return err
	}
	if _, err := tx.Exec(`DELETE FROM mylist WHERE item_id=?`, sourceID); err != nil {
		return err
	}
	if _, err := tx.Exec(`UPDATE playheads SET item_id=? WHERE item_id=?`, destinationID, sourceID); err != nil {
		return err
	}
	if _, err := tx.Exec(
		`WITH ranked AS (
		   SELECT id, ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY created_at, id) AS v
		   FROM playheads WHERE item_id=?
		 )
		 UPDATE playheads SET version=(SELECT v FROM ranked WHERE ranked.id=playheads.id)
		 WHERE item_id=?`, destinationID, destinationID,
	); err != nil {
		return err
	}
	if _, err := tx.Exec(`UPDATE OR IGNORE item_paths SET item_id=? WHERE item_id=?`, destinationID, sourceID); err != nil {
		return err
	}
	if _, err := tx.Exec(`DELETE FROM item_paths WHERE item_id=?`, sourceID); err != nil {
		return err
	}
	if _, err := tx.Exec(
		`UPDATE file_states
		 SET hash=(SELECT hash FROM items WHERE id=?), full_verified=0
		 WHERE path IN (SELECT path FROM item_paths WHERE item_id=?)`,
		destinationID, destinationID,
	); err != nil {
		return err
	}
	if _, err := tx.Exec(`DELETE FROM items WHERE id=?`, sourceID); err != nil {
		return err
	}
	return nil
}

func retireRemovedLibrariesTx(tx *sql.Tx, activeNames map[string]bool) (int, error) {
	items, err := reconcileItemsTx(tx)
	if err != nil {
		return 0, err
	}
	retired := 0
	now := fmtTime(time.Now())
	for _, item := range items {
		if activeNames[item.Library] {
			continue
		}
		for _, path := range item.Paths {
			if _, err := tx.Exec(`DELETE FROM file_states WHERE path=?`, path); err != nil {
				return retired, err
			}
		}
		if _, err := tx.Exec(`DELETE FROM item_paths WHERE item_id=?`, item.ID); err != nil {
			return retired, err
		}
		if item.State != string(StateMissing) || len(item.Paths) > 0 {
			if _, err := tx.Exec(
				`UPDATE items SET state=?, missing_at=COALESCE(missing_at, ?), updated_at=? WHERE id=?`,
				string(StateMissing), now, now, item.ID,
			); err != nil {
				return retired, err
			}
			retired++
		}
	}
	return retired, nil
}
