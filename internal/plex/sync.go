// Import orchestration: fetch Plex library, match against Lumina items,
// preview or apply watch-state migration.
package plex

import (
	"context"
	"fmt"
	"log"
	"path/filepath"
	"strings"

	"github.com/lumina-media/lumina/internal/library"
	"github.com/lumina-media/lumina/internal/metadata"
)

type Direction string

const (
	Pull   Direction = "pull"    // Plex watched → mark Lumina watched
	Push   Direction = "push"    // Lumina watched → scrobble to Plex
	TwoWay Direction = "two-way" // both
)

type ImportItem struct {
	Type       string `json:"type"` // movie | episode
	Title      string `json:"title"`
	Subtitle   string `json:"subtitle,omitempty"` // year or SxxEyy
	PlexWatched   bool `json:"plexWatched"`
	LuminaWatched bool `json:"luminaWatched"`
	Match      string `json:"match"`  // matched | unmatched
	Method     string `json:"method"` // tmdb | title-year | episode-key | —
	Action     string `json:"action"` // mark-lumina | scrobble-plex | already-synced | skipped | unmatched
}

type ImportReport struct {
	Mode           string       `json:"mode"` // preview | apply
	ServerName     string       `json:"serverName"`
	Sections       int          `json:"sections"`
	Scanned        int          `json:"scanned"`
	Matched        int          `json:"matched"`
	Unmatched      int          `json:"unmatched"`
	AlreadySynced  int          `json:"alreadySynced"`
	MarkedLumina   int          `json:"markedLumina"`
	ScrobbledPlex  int          `json:"scrobbledPlex"`
	Errors         []string     `json:"errors"`
	Items          []ImportItem `json:"items"` // attention rows only, capped
	ItemsTruncated bool         `json:"itemsTruncated"`
}

const detailLimit = 200

// Import runs the migration. apply=false → pure preview, zero writes.
// userID is the Lumina user who inherits the watch history (default usr-1).
func Import(ctx context.Context, c *Client, store library.Store, userID string, dir Direction, apply bool) (*ImportReport, error) {
	if userID == "" {
		userID = "usr-1"
	}
	report := &ImportReport{Errors: []string{}, Items: []ImportItem{}}
	if apply {
		report.Mode = "apply"
	} else {
		report.Mode = "preview"
	}

	name, err := c.ServerName(ctx)
	if err == nil {
		report.ServerName = name
	}
	sections, err := c.Sections(ctx)
	if err != nil {
		return nil, fmt.Errorf("list plex sections: %w", err)
	}
	report.Sections = len(sections)

	// Build Lumina identity maps.
	luminaItems := store.List("")
	byTMDB := map[int]*library.Item{}
	byMovieKey := map[string]*library.Item{}
	byEpisodeKey := map[string]*library.Item{}
	for i := range luminaItems {
		it := &luminaItems[i]
		if it.TMDBID > 0 {
			register(byTMDB, it.TMDBID, it)
		}
		if it.Kind == library.KindMovie {
			registerAmbiguous(byMovieKey, movieKey(it.Title, it.Year), it)
			// Also index the filename-derived key (pre-metadata items).
			if len(it.Paths) > 0 {
				base := strings.TrimSuffix(filepath.Base(it.Paths[0]), filepath.Ext(it.Paths[0]))
				p := metadata.ParseFilename(base)
				if p.Title != "" {
					registerAmbiguous(byMovieKey, movieKey(p.Title, p.Year), it)
				}
			}
		} else if len(it.Paths) > 0 {
			base := strings.TrimSuffix(filepath.Base(it.Paths[0]), filepath.Ext(it.Paths[0]))
			p := metadata.ParseFilename(base)
			if p.Title != "" && p.Episode > 0 {
				registerAmbiguous(byEpisodeKey, episodeKey(p.Title, p.Season, p.Episode), it)
			}
		}
	}

	// Lumina watch state for the target user (push direction + already-synced).
	playheads, err := store.Playheads(userID)
	if err != nil {
		return nil, err
	}

	scrobbleQueue := []string{}
	for _, sec := range sections {
		itemType := "1"
		if sec.Type == "show" {
			itemType = "4"
		}
		plexItems, err := c.Items(ctx, sec, itemType)
		if err != nil {
			report.Errors = append(report.Errors, fmt.Sprintf("%s: %v", sec.Title, err))
			continue
		}
		for _, pi := range plexItems {
			report.Scanned++
			row := ImportItem{
				Type:         pi.Type,
				Title:        pi.Title,
				PlexWatched:  pi.Watched,
			}
			if pi.Type == "episode" {
				row.Title = pi.Grandparent
				if row.Title == "" {
					row.Title = pi.Title
				}
				row.Subtitle = fmt.Sprintf("S%02dE%02d", pi.Season, pi.Episode)
			} else if pi.Year > 0 {
				row.Subtitle = fmt.Sprint(pi.Year)
			}

			var match *library.Item
			switch {
			case pi.TMDBID > 0 && byTMDB[pi.TMDBID] != nil:
				match = byTMDB[pi.TMDBID]
				row.Method = "tmdb"
			case pi.Type == "episode":
				if it, ok := unambiguous(byEpisodeKey, episodeKey(pi.Grandparent, pi.Season, pi.Episode)); ok {
					match = it
					row.Method = "episode-key"
				}
			default:
				if it, ok := unambiguous(byMovieKey, movieKey(pi.Title, pi.Year)); ok {
					match = it
					row.Method = "title-year"
				} else if it, ok := unambiguous(byMovieKey, movieKey(pi.Title, 0)); ok {
					match = it
					row.Method = "title"
				}
			}

			if match == nil {
				row.Match = "unmatched"
				row.Action = "unmatched"
				report.Unmatched++
				addDetail(report, row)
				continue
			}
			row.Match = "matched"
			report.Matched++

			ph, played := playheads[match.ID]
			row.LuminaWatched = played && ph.Watched
			switch {
			case pi.Watched && row.LuminaWatched:
				row.Action = "already-synced"
				report.AlreadySynced++
			case pi.Watched && (dir == Pull || dir == TwoWay):
				row.Action = "mark-lumina"
				if apply {
					// Full-length playhead → derived state = watched.
					dur := pi.DurationMs
					if dur <= 0 {
						dur = 1
					}
					if err := store.RecordPlayhead(userID, match.ID, dur, dur); err != nil {
						report.Errors = append(report.Errors, fmt.Sprintf("%s: %v", row.Title, err))
						continue
					}
				}
				report.MarkedLumina++
				addDetail(report, row)
			case !pi.Watched && row.LuminaWatched && (dir == Push || dir == TwoWay):
				row.Action = "scrobble-plex"
				if apply {
					scrobbleQueue = append(scrobbleQueue, pi.RatingKey)
				}
				report.ScrobbledPlex++
				addDetail(report, row)
			default:
				row.Action = "skipped"
			}
		}
	}

	// Scrobbles happen after the match pass, batched.
	for _, key := range scrobbleQueue {
		if err := c.Scrobble(ctx, key); err != nil {
			log.Printf("plex: scrobble %s: %v", key, err)
			report.Errors = append(report.Errors, fmt.Sprintf("scrobble %s: %v", key, err))
		}
	}
	return report, nil
}

func addDetail(r *ImportReport, row ImportItem) {
	if len(r.Items) >= detailLimit {
		r.ItemsTruncated = true
		return
	}
	r.Items = append(r.Items, row)
}

// register stores identity maps where duplicates POISON the key (nil):
// an ambiguous match must be reported, never guessed (bad attempt rule).
func register[K comparable](m map[K]*library.Item, key K, it *library.Item) {
	if existing, seen := m[key]; seen && existing != it {
		m[key] = nil
		return
	}
	m[key] = it
}

func registerAmbiguous(m map[string]*library.Item, key string, it *library.Item) {
	if key == "" || strings.HasPrefix(key, "|") {
		return
	}
	register(m, key, it)
}

func unambiguous(m map[string]*library.Item, key string) (*library.Item, bool) {
	it, ok := m[key]
	return it, ok && it != nil
}
