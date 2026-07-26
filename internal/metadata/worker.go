// Rate-limited background identification worker. The scanner enqueues
// newly-indexed items; the worker parses the filename, queries TMDB
// (max ~4 req/s), and writes results through Store.SetMetadata.
// Without an API key the worker idles — items keep procedural posters.
package metadata

import (
	"context"
	"fmt"
	"log"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/lumina-media/lumina/internal/library"
)

// IdentifyHint carries folder-structure knowledge from the scanner that a
// bare filename cannot express: the series folder's cleaned title, the
// "Season N" directory's number, an absolute episode number for
// fansub-style anime files with no SxxExx marker, and the folder's release
// year — the disambiguator between same-titled series.
type IdentifyHint struct {
	Series     string
	Season     int
	AbsEpisode int
	Year       int
}

type identifyReq struct {
	it   library.Item
	hint IdentifyHint
}

type Worker struct {
	tmdb  *Client
	store library.Store
	queue chan identifyReq

	mu          sync.Mutex
	seriesCache map[int]seriesCacheEntry
}

// seriesCacheEntry memoizes FetchSeriesEpisodes (1 + N TMDB requests per
// series) for a day — episode lists change slowly, series pages are
// visited often.
type seriesCacheEntry struct {
	eps []EpisodeInfo
	at  time.Time
}

const seriesCacheTTL = 24 * time.Hour

func NewWorker(tmdb *Client, store library.Store) *Worker {
	return &Worker{
		tmdb:        tmdb,
		store:       store,
		queue:       make(chan identifyReq, 512),
		seriesCache: map[int]seriesCacheEntry{},
	}
}

// Available reports whether the worker can identify (TMDB key present).
func (w *Worker) Available() bool { return w != nil && w.tmdb.Available() }

// Enqueue schedules identification. Non-blocking; duplicates are cheap
// (SetMetadata is idempotent for the same TMDB result).
func (w *Worker) Enqueue(it library.Item) {
	w.EnqueueHint(it, IdentifyHint{})
}

// EnqueueHint schedules identification with scanner-supplied folder hints.
func (w *Worker) EnqueueHint(it library.Item, hint IdentifyHint) {
	if !w.tmdb.Available() {
		return
	}
	select {
	case w.queue <- identifyReq{it: it, hint: hint}:
	default:
		log.Printf("metadata: queue full, dropped %s", it.ID)
	}
}

// Search exposes TMDB title search to the manual-match UI.
func (w *Worker) Search(ctx context.Context, kind, query string) ([]SearchResult, error) {
	if !w.Available() {
		return nil, fmt.Errorf("no TMDB API key configured")
	}
	return w.tmdb.Search(ctx, kind, query)
}

// SeriesEpisodes returns TMDB per-episode metadata for a series, memoized
// for 24h. The series page merges these onto scanned files by (season,
// episode) — real episode names, overviews, and stills.
func (w *Worker) SeriesEpisodes(ctx context.Context, tmdbID int) ([]EpisodeInfo, error) {
	if !w.Available() {
		return nil, fmt.Errorf("no TMDB API key configured")
	}
	w.mu.Lock()
	if e, ok := w.seriesCache[tmdbID]; ok && time.Since(e.at) < seriesCacheTTL {
		w.mu.Unlock()
		return e.eps, nil
	}
	w.mu.Unlock()
	eps, err := w.tmdb.FetchSeriesEpisodes(ctx, tmdbID)
	if err != nil {
		return nil, err
	}
	w.mu.Lock()
	w.seriesCache[tmdbID] = seriesCacheEntry{eps: eps, at: time.Now()}
	w.mu.Unlock()
	return eps, nil
}

// ApplyMatch sets metadata for an EXPLICIT TMDB id, synchronously — the
// admin just told us exactly what this item is, so we fetch and write
// immediately rather than queueing behind identification work.
func (w *Worker) ApplyMatch(ctx context.Context, it library.Item, tmdbID int) error {
	if !w.Available() {
		return fmt.Errorf("no TMDB API key configured")
	}
	kind := "movies"
	if it.Kind == library.KindEpisode {
		kind = "tv"
	}
	m, err := w.tmdb.FetchByID(ctx, kind, tmdbID)
	if err != nil {
		return err
	}
	if m == nil {
		return fmt.Errorf("tmdb id %d not found", tmdbID)
	}
	// Episode items keep the "Series S02E04" display convention.
	if it.Kind == library.KindEpisode && len(it.Paths) > 0 {
		base := strings.TrimSuffix(filepath.Base(it.Paths[0]), filepath.Ext(it.Paths[0]))
		if parsed := ParseFilename(base); parsed.Episode > 0 {
			m.Title = episodeDisplayTitle(m.Title, parsed)
		}
	}
	return w.store.SetMetadata(it.ID, *m)
}

// episodeDisplayTitle renders "Series Name S02E04 · The Last Dance" —
// the filename's own episode name rides along when present.
func episodeDisplayTitle(series string, p Parsed) string {
	t := series + " " + episodeLabel(p)
	if p.EpisodeTitle != "" {
		t += " · " + p.EpisodeTitle
	}
	return t
}

// Run processes the queue with a 250ms gap between TMDB calls.
// Blocks until ctx is cancelled.
func (w *Worker) Run(ctx context.Context) {
	if !w.tmdb.Available() {
		log.Printf("metadata: no TMDB API key configured — procedural posters only")
		return
	}
	rate := time.NewTicker(250 * time.Millisecond)
	defer rate.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case req := <-w.queue:
			<-rate.C
			func() {
				// Identification must never kill the server: a bad filename,
				// a TMDB oddity, or a parser bug is one item, not a crash loop.
				defer func() {
					if r := recover(); r != nil {
						log.Printf("metadata: identify %s (%s): panic: %v", req.it.ID, req.it.Title, r)
					}
				}()
				if err := w.identify(ctx, req.it, req.hint); err != nil {
					log.Printf("metadata: identify %s (%s): %v", req.it.ID, req.it.Title, err)
				}
			}()
		}
	}
}

func (w *Worker) identify(ctx context.Context, it library.Item, hint IdentifyHint) error {
	if len(it.Paths) == 0 {
		return nil
	}
	base := strings.TrimSuffix(filepath.Base(it.Paths[0]), filepath.Ext(it.Paths[0]))
	parsed := ParseFilename(base)

	if it.Kind == library.KindEpisode || parsed.Episode > 0 || hint.AbsEpisode > 0 {
		// The series folder outranks the filename prefix as the search title
		// — folders follow Plex conventions, filenames follow release-group
		// whims. Absolute-numbered anime gets its episode number here.
		if parsed.Episode == 0 && hint.AbsEpisode > 0 {
			parsed.Episode = hint.AbsEpisode
			parsed.Season = hint.Season // 0 unless a "Season N" dir said otherwise
		}
		if parsed.Season == 0 && hint.Season > 0 {
			parsed.Season = hint.Season
		}
		title := parsed.Title
		if hint.Series != "" {
			title = hint.Series
		}
		if title == "" {
			return nil
		}
		m, err := w.tmdb.IdentifySeries(ctx, title, hint.Year)
		if err != nil {
			return err
		}
		if m == nil {
			// Folder annotations like "(Korean)" defeat the exact-title
			// matcher and can zero out TMDB's own search — retry bare.
			if stripped := StripParenGroups(title); stripped != "" && stripped != title {
				m, err = w.tmdb.IdentifySeries(ctx, stripped, hint.Year)
				if err != nil {
					return err
				}
			}
		}
		if m == nil {
			return nil
		}
		// Episode items display as "Series Name S02E04 · The Last Dance"
		// (or "Series Name E362" for absolute numbering).
		if parsed.Episode > 0 {
			m.Title = episodeDisplayTitle(m.Title, parsed)
		}
		return w.store.SetMetadata(it.ID, *m)
	}

	if parsed.Title == "" {
		return nil
	}
	m, err := w.tmdb.IdentifyMovie(ctx, parsed.Title, parsed.Year)
	if err != nil {
		return err
	}
	if m == nil {
		if stripped := StripParenGroups(parsed.Title); stripped != "" && stripped != parsed.Title {
			m, err = w.tmdb.IdentifyMovie(ctx, stripped, parsed.Year)
			if err != nil {
				return err
			}
		}
	}
	if m == nil {
		return nil
	}
	return w.store.SetMetadata(it.ID, *m)
}

func episodeLabel(p Parsed) string {
	if p.Season > 0 {
		return fmt.Sprintf("S%02dE%02d", p.Season, p.Episode)
	}
	return fmt.Sprintf("E%02d", p.Episode)
}
