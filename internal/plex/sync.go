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

// EpisodeLister flattens a series' TMDB episode order so Plex's SxxEyy can
// be converted to an ABSOLUTE position — the join for multi-season
// absolute-numbered libraries (Demon Slayer S03E06 = absolute 51, say).
// The metadata Worker satisfies it; passing nil disables the flatten
// fallback and those episodes simply stay unmatched.
type EpisodeLister interface {
	SeriesEpisodes(ctx context.Context, tmdbID int) ([]metadata.EpisodeInfo, error)
}

// Import runs the migration. apply=false → pure preview, zero writes.
// userID is the Lumina user who inherits the watch history (default usr-1).
func Import(ctx context.Context, c *Client, store library.Store, userID string, dir Direction, apply bool, eps EpisodeLister) (*ImportReport, error) {
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
	// Series-TMDB + SxxEyy: the strongest episode identity. Plex episode
	// guids are episode-level, but Lumina episodes carry the SERIES tmdb id,
	// so join through the show's own guid (resolved per section below).
	byTMDBEpisode := map[string]*library.Item{}
	// Absolute-numbered anime identities: title+abs (any Plex agent) and
	// series-TMDB+abs (season slot 0). See the indexing loop below.
	byAbsKey := map[string]*library.Item{}
	byTMDBAbs := map[string]*library.Item{}
	// Series (by TMDB id) that HAVE absolute-numbered files — the flatten
	// fallback only pays its TMDB round trip for these.
	absSeries := map[int]bool{}
	for i := range luminaItems {
		it := &luminaItems[i]
		if it.State == library.StateMissing {
			// Ghost rows (file vanished or moved) must not poison identity
			// keys for the ACTIVE copy of the same title — a reorganised
			// library leaves both, and a poisoned key is how a perfect
			// title+year hit still reported "unmatched". Missing items are
			// also unplayable, so watch-state writes would be meaningless.
			continue
		}
		if it.TMDBID > 0 {
			register(byTMDB, it.TMDBID, it)
		}
		if it.Kind == library.KindMovie {
			registerAmbiguous(byMovieKey, movieKey(it.Title, it.Year), it)
			if it.Year > 0 {
				// Yearless key powers the "title" fallback below: without
				// registering it, that fallback could never hit.
				registerAmbiguous(byMovieKey, movieKey(it.Title, 0), it)
			}
			if it.OrigTitle != "" {
				// Original-language title: a Plex library in another
				// language carries this instead of TMDB's English title.
				registerAmbiguous(byMovieKey, movieKey(it.OrigTitle, it.Year), it)
				if it.Year > 0 {
					registerAmbiguous(byMovieKey, movieKey(it.OrigTitle, 0), it)
				}
			}
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
			// The TMDB series title (and its original-language form) is the
			// name Plex shows when filenames use romaji/Japanese.
			if it.Title != "" && p.Episode > 0 {
				registerAmbiguous(byEpisodeKey, episodeKey(it.Title, p.Season, p.Episode), it)
			}
			if it.OrigTitle != "" && p.Episode > 0 {
				registerAmbiguous(byEpisodeKey, episodeKey(it.OrigTitle, p.Season, p.Episode), it)
			}
			if it.TMDBID > 0 && p.Episode > 0 {
				register(byTMDBEpisode, tmdbEpisodeKey(it.TMDBID, p.Season, p.Episode), it)
			}
			// The parent DIRECTORY follows Plex naming even when the file
			// doesn't: "S01E02.mkv" carries no title, release-group files
			// carry the wrong one. Index the folder-derived series too.
			dirTitle, _ := seriesFromDir(filepath.Dir(it.Paths[0]))
			if dirTitle != "" && p.Episode > 0 {
				registerAmbiguous(byEpisodeKey, episodeKey(dirTitle, p.Season, p.Episode), it)
			}
			// Absolute numbering (anime fansubs: "Hunter x Hunter - 02
			// (1080p)"): no SxxExx marker means no episodeKey at all — these
			// were the bulk of the unmatched list. Plex S01E0N on a
			// single-season show IS absolute N.
			if p.Episode == 0 {
				if abs := metadata.ParseAbsoluteEpisode(base); abs > 0 {
					title := p.Title
					if dirTitle != "" {
						title = dirTitle
					}
					if title != "" {
						registerAmbiguous(byAbsKey, absKey(title, abs), it)
					}
					// Same cross-language bridges for absolute numbering.
					if it.Title != "" && it.Title != title {
						registerAmbiguous(byAbsKey, absKey(it.Title, abs), it)
					}
					if it.OrigTitle != "" && it.OrigTitle != title {
						registerAmbiguous(byAbsKey, absKey(it.OrigTitle, abs), it)
					}
					if it.TMDBID > 0 {
						register(byTMDBAbs, tmdbEpisodeKey(it.TMDBID, 0, abs), it) // season 0 = absolute slot
						absSeries[it.TMDBID] = true
					}
				}
			}
		}
	}

	// absolutePosition flattens TMDB's season order (specials excluded) into
	// running absolute positions: S03E06 → 51. The answer for a whole series
	// is memoized per run — and so is a fetch failure, so one flaky TMDB
	// call doesn't retry for every episode of the same show.
	absIdxCache := map[int]map[[2]int]int{}
	absolutePosition := func(series, season, episode int) int {
		if m, done := absIdxCache[series]; done {
			return m[[2]int{season, episode}]
		}
		m := map[[2]int]int{}
		if eps != nil {
			if list, err := eps.SeriesEpisodes(ctx, series); err == nil {
				n := 0
				for _, ep := range list {
					if ep.Season < 1 {
						continue
					}
					n++
					m[[2]int{ep.Season, ep.Episode}] = n
				}
			}
		}
		absIdxCache[series] = m
		return m[[2]int{season, episode}]
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
		// Episodes inherit their SHOW's tmdb id: fetch the section's series
		// (type=2, one call) and join on grandparentRatingKey.
		if sec.Type == "show" {
			seriesTMDB := map[string]int{}
			if series, sErr := c.Items(ctx, sec, "2"); sErr == nil {
				for _, sr := range series {
					if sr.TMDBID > 0 {
						seriesTMDB[sr.RatingKey] = sr.TMDBID
					}
				}
			}
			for i := range plexItems {
				plexItems[i].SeriesTMDBID = seriesTMDB[plexItems[i].GrandparentKey]
			}
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
				// Strongest: the show's series-level tmdb id + exact SxxEyy.
				if pi.SeriesTMDBID > 0 {
					if it, ok := unambiguous(byTMDBEpisode, tmdbEpisodeKey(pi.SeriesTMDBID, pi.Season, pi.Episode)); ok {
						match = it
						row.Method = "tmdb-episode"
					}
				}
				if match == nil {
					if it, ok := unambiguous(byEpisodeKey, episodeKey(pi.Grandparent, pi.Season, pi.Episode)); ok {
						match = it
						row.Method = "episode-key"
					}
				}
				// Absolute-numbered anime: Plex S01E0N on a single-season
				// show is absolute N.
				if match == nil && pi.Season <= 1 && pi.Episode > 0 {
					if pi.SeriesTMDBID > 0 {
						if it, ok := unambiguous(byTMDBAbs, tmdbEpisodeKey(pi.SeriesTMDBID, 0, pi.Episode)); ok {
							match = it
							row.Method = "tmdb-absolute"
						}
					}
					if match == nil {
						if it, ok := unambiguous(byAbsKey, absKey(pi.Grandparent, pi.Episode)); ok {
							match = it
							row.Method = "absolute"
						}
					}
				}
				// Multi-season absolute (Demon Slayer S03E06 = absolute 51):
				// flatten TMDB's season order to convert Plex's SxxEyy into
				// an absolute position, then join through the absolute slot.
				// Only series with absolute-numbered files in Lumina reach
				// this — regular multi-season shows matched above already.
				if match == nil && pi.SeriesTMDBID > 0 && pi.Episode > 0 && absSeries[pi.SeriesTMDBID] {
					if abs := absolutePosition(pi.SeriesTMDBID, pi.Season, pi.Episode); abs > 0 {
						if it, ok := unambiguous(byTMDBAbs, tmdbEpisodeKey(pi.SeriesTMDBID, 0, abs)); ok {
							match = it
							row.Method = "tmdb-absolute-flatten"
						}
					}
				}
			default:
				if it, ok := unambiguous(byMovieKey, movieKey(pi.Title, pi.Year)); ok {
					match = it
					row.Method = "title-year"
				} else if it, ok := unambiguous(byMovieKey, movieKey(pi.Title, 0)); ok {
					match = it
					row.Method = "title"
				}
				// Plex and TMDB disagree on year by one often enough
				// (festival vs wide release) to be worth a guarded retry.
				if match == nil && pi.Year > 0 {
					for _, dy := range []int{-1, 1} {
						if it, ok := unambiguous(byMovieKey, movieKey(pi.Title, pi.Year+dy)); ok {
							match = it
							row.Method = "title-year±1"
							break
						}
					}
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

// tmdbEpisodeKey joins a series-level TMDB id with exact season/episode —
// the identity Plex and Lumina can agree on regardless of title language.
func tmdbEpisodeKey(tmdbID, season, episode int) string {
	return fmt.Sprintf("%d|%d|%d", tmdbID, season, episode)
}

// absKey joins a normalized series title with an ABSOLUTE episode number —
// the fansub/anime numbering where no season concept exists.
func absKey(series string, abs int) string {
	return fmt.Sprintf("%s|%d", Normalize(series), abs)
}

// seriesFromDir extracts the series title from a file's directory: the
// parent folder, or the grandparent when the parent is a "Season N" dir.
// Files directly in a library root register harmless junk keys (the root
// name) — Plex grandparents never match them, so they simply never hit.
func seriesFromDir(dir string) (string, int) {
	base := filepath.Base(dir)
	if metadata.SeasonFromDir(base) > 0 {
		base = filepath.Base(filepath.Dir(dir))
	}
	p := metadata.ParseFilename(base)
	return p.Title, p.Year
}
