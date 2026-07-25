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
	"time"

	"github.com/lumina-media/lumina/internal/library"
)

type Worker struct {
	tmdb  *Client
	store library.Store
	queue chan library.Item
}

func NewWorker(tmdb *Client, store library.Store) *Worker {
	return &Worker{tmdb: tmdb, store: store, queue: make(chan library.Item, 512)}
}

// Available reports whether the worker can identify (TMDB key present).
func (w *Worker) Available() bool { return w != nil && w.tmdb.Available() }

// Enqueue schedules identification. Non-blocking; duplicates are cheap
// (SetMetadata is idempotent for the same TMDB result).
func (w *Worker) Enqueue(it library.Item) {
	if !w.tmdb.Available() {
		return
	}
	select {
	case w.queue <- it:
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
		case it := <-w.queue:
			<-rate.C
			func() {
				// Identification must never kill the server: a bad filename,
				// a TMDB oddity, or a parser bug is one item, not a crash loop.
				defer func() {
					if r := recover(); r != nil {
						log.Printf("metadata: identify %s (%s): panic: %v", it.ID, it.Title, r)
					}
				}()
				if err := w.identify(ctx, it); err != nil {
					log.Printf("metadata: identify %s (%s): %v", it.ID, it.Title, err)
				}
			}()
		}
	}
}

func (w *Worker) identify(ctx context.Context, it library.Item) error {
	if len(it.Paths) == 0 {
		return nil
	}
	base := strings.TrimSuffix(filepath.Base(it.Paths[0]), filepath.Ext(it.Paths[0]))
	parsed := ParseFilename(base)
	if parsed.Title == "" {
		return nil
	}

	var m *library.Metadata
	var err error
	if it.Kind == library.KindEpisode || parsed.Episode > 0 {
		m, err = w.tmdb.IdentifySeries(ctx, parsed.Title)
		// Episode items display as "Series Name S02E04 · The Last Dance".
		if m != nil && parsed.Episode > 0 {
			m.Title = episodeDisplayTitle(m.Title, parsed)
		}
	} else {
		m, err = w.tmdb.IdentifyMovie(ctx, parsed.Title, parsed.Year)
	}
	if err != nil || m == nil {
		return err
	}
	return w.store.SetMetadata(it.ID, *m)
}

func episodeLabel(p Parsed) string {
	return fmt.Sprintf("S%02dE%02d", p.Season, p.Episode)
}
