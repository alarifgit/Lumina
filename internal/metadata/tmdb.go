// Package metadata identifies library items against TMDB and enriches
// them with real titles, years, overviews, genres and artwork.
//
// Design (ARCHITECTURE.md §6): providers are pluggable behind an
// interface; TMDB is the first. The engine never blocks the scanner —
// identification happens in a rate-limited background worker, and items
// render with procedural posters until real artwork arrives.
package metadata

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/lumina-media/lumina/internal/library"
)

const (
	apiBase     = "https://api.themoviedb.org/3"
	posterURL   = "https://image.tmdb.org/t/p/w500"
	backdropURL = "https://image.tmdb.org/t/p/w780"
	stillURL    = "https://image.tmdb.org/t/p/w300"
)

// Client talks to TMDB. Available() is false without an API key —
// the whole engine degrades gracefully to procedural posters.
type Client struct {
	Key      string
	Language string // e.g. "en-US"
	hc       *http.Client
}

func NewClient(key, language string) *Client {
	if language == "" {
		language = "en-US"
	}
	return &Client{Key: key, Language: language, hc: &http.Client{Timeout: 10 * time.Second}}
}

func (c *Client) Available() bool { return c != nil && c.Key != "" }

// matchCandidate is one TMDB search hit evaluated by the auto-matcher.
type matchCandidate struct {
	id         int
	title      string
	origTitle  string
	year       int
	popularity float64
}

// normalizeMatchTitle folds a title to its comparison form: NFKD, accents
// stripped, "&" → "and", non-alphanumeric → spaces, collapsed. Two titles
// are "the same" iff these forms are equal — search rank is NOT identity.
func normalizeMatchTitle(s string) string {
	s = strings.ToLower(strings.TrimSpace(s))
	s = strings.ReplaceAll(s, "&", " and ")
	var b strings.Builder
	lastSpace := true
	for _, r := range s {
		switch {
		case r >= 'a' && r <= 'z' || r >= '0' && r <= '9':
			b.WriteRune(r)
			lastSpace = false
		case r > 127:
			// Fold common accented Latin to ASCII bases; drop other marks.
			if base, ok := accentFold[r]; ok {
				b.WriteRune(base)
				lastSpace = false
			} else if !lastSpace {
				b.WriteByte(' ')
				lastSpace = true
			}
		default:
			if !lastSpace {
				b.WriteByte(' ')
				lastSpace = true
			}
		}
	}
	return strings.TrimSpace(b.String())
}

var accentFold = map[rune]rune{
	'à': 'a', 'á': 'a', 'â': 'a', 'ã': 'a', 'ä': 'a', 'å': 'a', 'æ': 'a',
	'ç': 'c',
	'è': 'e', 'é': 'e', 'ê': 'e', 'ë': 'e',
	'ì': 'i', 'í': 'i', 'î': 'i', 'ï': 'i',
	'ñ': 'n',
	'ò': 'o', 'ó': 'o', 'ô': 'o', 'õ': 'o', 'ö': 'o', 'ø': 'o',
	'ù': 'u', 'ú': 'u', 'û': 'u', 'ü': 'u',
	'ý': 'y', 'ÿ': 'y',
	'ß': 's',
}

// decideAutoMatch is intentionally conservative (ported from the reference
// implementation's decideTmdbAutoMatch): only an EXACT normalized title
// (or original title) may auto-match; when a source year is known the
// candidate year must equal it; ambiguity means "leave it for the human"
// (the fix-match UI), not "guess harder".
func decideAutoMatch(sourceTitle string, sourceYear int, cands []matchCandidate) *matchCandidate {
	src := normalizeMatchTitle(sourceTitle)
	if src == "" || len(cands) == 0 {
		return nil
	}
	seen := map[int]bool{}
	var exact []matchCandidate
	for _, c := range cands {
		if seen[c.id] {
			continue
		}
		seen[c.id] = true
		if normalizeMatchTitle(c.title) == src ||
			(c.origTitle != "" && normalizeMatchTitle(c.origTitle) == src) {
			exact = append(exact, c)
		}
	}
	if len(exact) == 0 {
		return nil
	}
	eligible := exact
	if sourceYear > 0 {
		eligible = nil
		for _, c := range exact {
			if c.year == sourceYear {
				eligible = append(eligible, c)
			}
		}
	}
	if len(eligible) != 1 {
		return nil // year-mismatch or ambiguous → manual fix-match
	}
	return &eligible[0]
}

// searchCandidates queries TMDB and returns up to 10 match candidates.
func (c *Client) searchCandidates(ctx context.Context, kind, query string, year int) ([]matchCandidate, error) {
	endpoint := "/search/movie"
	if kind == "tv" {
		endpoint = "/search/tv"
	}
	q := url.Values{"query": {query}, "include_adult": {"false"}, "language": {c.Language}}
	if year > 0 {
		q.Set("year", fmt.Sprint(year))
	}
	var res struct {
		Results []struct {
			ID          int     `json:"id"`
			Title       string  `json:"title"`
			Name        string  `json:"name"`
			OrigTitle   string  `json:"original_title"`
			OrigName    string  `json:"original_name"`
			Release     string  `json:"release_date"`
			FirstAir    string  `json:"first_air_date"`
			Popularity  float64 `json:"popularity"`
		} `json:"results"`
	}
	if err := c.get(ctx, endpoint, q, &res); err != nil {
		return nil, err
	}
	out := make([]matchCandidate, 0, 10)
	for i, r := range res.Results {
		if i >= 10 {
			break
		}
		cand := matchCandidate{id: r.ID, popularity: r.Popularity}
		date := r.Release
		if kind == "tv" {
			cand.title, cand.origTitle = r.Name, r.OrigName
			date = r.FirstAir
		} else {
			cand.title, cand.origTitle = r.Title, r.OrigTitle
		}
		if len(date) >= 4 {
			fmt.Sscanf(date[:4], "%d", &cand.year)
		}
		out = append(out, cand)
	}
	return out, nil
}
// IdentifyMovie matches a parsed title (+year hint) against TMDB with the
// conservative auto-matcher: exact normalized title, exact year when known,
// no guessing on ambiguity — unmatched items wait for the fix-match UI.
func (c *Client) IdentifyMovie(ctx context.Context, title string, year int) (*library.Metadata, error) {
	cands, err := c.searchCandidates(ctx, "movies", title, year)
	if err != nil {
		return nil, err
	}
	pick := decideAutoMatch(title, year, cands)
	if pick == nil && year > 0 {
		// Release years differ by one across regions surprisingly often:
		// retry without TMDB's year bias, keeping OUR year check.
		cands, err = c.searchCandidates(ctx, "movies", title, 0)
		if err != nil {
			return nil, err
		}
		pick = decideAutoMatch(title, year, cands)
	}
	if pick == nil {
		return nil, nil // no confident match — not an error
	}
	return c.FetchByID(ctx, "movies", pick.id)
}

// IdentifySeries matches a series title. Exact normalized titles win; when
// nothing matches exactly, the top search hit is accepted — series searches
// routinely cross naming schemes (romaji vs English anime titles, "The
// Office" UK/US), and episodes all share the one series identity, so a
// rank-1 mistake is cheap to fix once. Episodes inherit the series artwork
// and genres; per-episode titles arrive in a later phase.
func (c *Client) IdentifySeries(ctx context.Context, title string) (*library.Metadata, error) {
	cands, err := c.searchCandidates(ctx, "tv", title, 0)
	if err != nil {
		return nil, err
	}
	if len(cands) == 0 {
		return nil, nil
	}
	pick := decideAutoMatch(title, 0, cands)
	if pick == nil {
		pick = &cands[0]
	}
	return c.FetchByID(ctx, "tv", pick.id)
}

// SearchResult is one candidate in the manual "fix match" picker.
type SearchResult struct {
	TMDBID    int    `json:"tmdbId"`
	Title     string `json:"title"`
	Year      int    `json:"year,omitempty"`
	PosterURL string `json:"posterUrl,omitempty"`
	Overview  string `json:"overview,omitempty"`
}

// Search queries TMDB by title for the manual-match UI. kind is
// "movies" or "tv". Returns at most 8 candidates, TMDB-ordered.
func (c *Client) Search(ctx context.Context, kind, query string) ([]SearchResult, error) {
	endpoint := "/search/movie"
	if kind == "tv" {
		endpoint = "/search/tv"
	}
	q := url.Values{"query": {query}, "include_adult": {"false"}, "language": {c.Language}}
	var res struct {
		Results []struct {
			ID       int    `json:"id"`
			Title    string `json:"title"`
			Name     string `json:"name"`
			Release  string `json:"release_date"`
			FirstAir string `json:"first_air_date"`
			Poster   string `json:"poster_path"`
			Overview string `json:"overview"`
		} `json:"results"`
	}
	if err := c.get(ctx, endpoint, q, &res); err != nil {
		return nil, err
	}
	out := make([]SearchResult, 0, 8)
	for i, r := range res.Results {
		if i >= 8 {
			break
		}
		sr := SearchResult{TMDBID: r.ID, Overview: r.Overview}
		date := r.Release
		if kind == "tv" {
			sr.Title = r.Name
			date = r.FirstAir
		} else {
			sr.Title = r.Title
		}
		if len(date) >= 4 {
			fmt.Sscanf(date[:4], "%d", &sr.Year)
		}
		if r.Poster != "" {
			sr.PosterURL = posterURL + r.Poster
		}
		out = append(out, sr)
	}
	return out, nil
}

// FetchByID loads metadata for an EXPLICIT TMDB id — the "fix match"
// path, where the human has told us exactly what this file is.
// kind is "movies" or "tv".
func (c *Client) FetchByID(ctx context.Context, kind string, id int) (*library.Metadata, error) {
	var det struct {
		ID        int    `json:"id"`
		Title     string `json:"title"`
		Name      string `json:"name"`
		Release   string `json:"release_date"`
		FirstAir  string `json:"first_air_date"`
		Overview  string `json:"overview"`
		Poster    string `json:"poster_path"`
		Backdrop  string `json:"backdrop_path"`
		Genres    []struct {
			Name string `json:"name"`
		} `json:"genres"`
	}
	endpoint := fmt.Sprintf("/movie/%d", id)
	if kind == "tv" {
		endpoint = fmt.Sprintf("/tv/%d", id)
	}
	if err := c.get(ctx, endpoint, url.Values{"language": {c.Language}}, &det); err != nil {
		return nil, err
	}
	m := &library.Metadata{TMDBID: det.ID, Overview: det.Overview}
	date := det.Release
	if kind == "tv" {
		m.Title = det.Name
		date = det.FirstAir
	} else {
		m.Title = det.Title
	}
	if len(date) >= 4 {
		fmt.Sscanf(date[:4], "%d", &m.Year)
	}
	if det.Poster != "" {
		m.PosterURL = posterURL + det.Poster
	}
	if det.Backdrop != "" {
		m.BackdropURL = backdropURL + det.Backdrop
	}
	for _, g := range det.Genres {
		m.Genres = append(m.Genres, g.Name)
	}
	return m, nil
}

// EpisodeInfo is one TMDB episode's display metadata — the series page
// merges these onto scanned files by (season, episode).
type EpisodeInfo struct {
	Season   int    `json:"season"`
	Episode  int    `json:"episode"`
	Name     string `json:"name"`
	Overview string `json:"overview,omitempty"`
	StillURL string `json:"stillUrl,omitempty"`
	AirDate  string `json:"airDate,omitempty"`
}

// FetchSeriesEpisodes walks every season of a series and returns per-episode
// titles, overviews, stills and air dates. Costs 1 + len(seasons) requests —
// callers should cache (the worker keeps a 24h in-memory cache).
func (c *Client) FetchSeriesEpisodes(ctx context.Context, id int) ([]EpisodeInfo, error) {
	var show struct {
		Seasons []struct {
			Number int `json:"season_number"`
			Count  int `json:"episode_count"`
		} `json:"seasons"`
	}
	if err := c.get(ctx, fmt.Sprintf("/tv/%d", id), url.Values{"language": {c.Language}}, &show); err != nil {
		return nil, err
	}
	out := []EpisodeInfo{}
	for _, sn := range show.Seasons {
		if sn.Count == 0 {
			continue
		}
		var season struct {
			Episodes []struct {
				Number   int    `json:"episode_number"`
				Name     string `json:"name"`
				Overview string `json:"overview"`
				Still    string `json:"still_path"`
				AirDate  string `json:"air_date"`
			} `json:"episodes"`
		}
		if err := c.get(ctx, fmt.Sprintf("/tv/%d/season/%d", id, sn.Number),
			url.Values{"language": {c.Language}}, &season); err != nil {
			return nil, err
		}
		for _, ep := range season.Episodes {
			info := EpisodeInfo{
				Season: sn.Number, Episode: ep.Number,
				Name: ep.Name, Overview: ep.Overview, AirDate: ep.AirDate,
			}
			if ep.Still != "" {
				info.StillURL = stillURL + ep.Still
			}
			out = append(out, info)
		}
	}
	return out, nil
}

func (c *Client) get(ctx context.Context, path string, q url.Values, out any) error {
	q.Set("api_key", c.Key)
	req, err := http.NewRequestWithContext(ctx, "GET", apiBase+path+"?"+q.Encode(), nil)
	if err != nil {
		return err
	}
	res, err := c.hc.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode == 429 {
		return fmt.Errorf("tmdb rate limited") // worker backs off on error
	}
	if res.StatusCode != 200 {
		return fmt.Errorf("tmdb %s → %d", path, res.StatusCode)
	}
	return json.NewDecoder(res.Body).Decode(out)
}
