// Package plex implements the Plex → Lumina watch-state importer.
//
// Matching strategy is distilled from lumina_badattempt's plex-sync.ts
// (the genuinely good part of that codebase):
//   - external IDs first (TMDB from Plex Guid values vs our tmdb_id)
//   - then canonical normalized title+year
//   - episodes: parent-show match (grandparentTitle) + exact SxxEyy
//   - ambiguity is reported, never guessed
// Plex watch = viewCount>0 or lastViewedAt. Apply appends a full-length
// playhead to Lumina's journal (derived state → watched), keyed by
// content-hash identity so renames afterwards don't matter.
package plex

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"
)

type Client struct {
	URL   string
	Token string
	hc    *http.Client
}

func NewClient(rawURL, token string) *Client {
	return &Client{
		URL:   strings.TrimRight(strings.TrimSpace(rawURL), "/"),
		Token: strings.TrimSpace(token),
		hc:    &http.Client{Timeout: 15 * time.Second},
	}
}

func (c *Client) Available() bool { return c != nil && c.URL != "" && c.Token != "" }

type Section struct {
	Key   string
	Title string
	Type  string // "movie" | "show"
}

type Item struct {
	Type           string // "movie" | "episode"
	RatingKey      string
	Title          string
	Grandparent    string // show title for episodes
	Year           int
	Season         int
	Episode        int
	DurationMs     int64
	Watched        bool
	TMDBID         int
}

// --- Plex API shapes (JSON; Plex honours Accept: application/json) -----------

type container struct {
	MediaContainer struct {
		FriendlyName string `json:"friendlyName"`
		Directory    []struct {
			Key   json.Number `json:"key"`
			Title string      `json:"title"`
			Type  string      `json:"type"`
		} `json:"Directory"`
		Metadata []struct {
			Type            string      `json:"type"`
			RatingKey       json.Number `json:"ratingKey"`
			Title           string      `json:"title"`
			GrandparentTitle string     `json:"grandparentTitle"`
			Year            json.Number `json:"year"`
			ParentIndex     json.Number `json:"parentIndex"`
			Index           json.Number `json:"index"`
			Duration        json.Number `json:"duration"`
			ViewCount       json.Number `json:"viewCount"`
			LastViewedAt    json.Number `json:"lastViewedAt"`
			Guid            string      `json:"guid"`
			GuidAlt         []struct {
				ID string `json:"id"`
			} `json:"Guid"`
		} `json:"Metadata"`
	} `json:"MediaContainer"`
}

func (c *Client) get(ctx context.Context, path string, q url.Values) (*container, error) {
	u := c.URL + path
	if q == nil {
		q = url.Values{}
	}
	q.Set("X-Plex-Token", c.Token)
	req, err := http.NewRequestWithContext(ctx, "GET", u+"?"+q.Encode(), nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("X-Plex-Product", "Lumina")
	req.Header.Set("X-Plex-Client-Identifier", "lumina-plex-import")
	res, err := c.hc.Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	if res.StatusCode != 200 {
		return nil, fmt.Errorf("plex %s → %d", path, res.StatusCode)
	}
	var out container
	if err := json.NewDecoder(res.Body).Decode(&out); err != nil {
		return nil, fmt.Errorf("plex %s: not JSON (server too old for JSON API?): %w", path, err)
	}
	return &out, nil
}

// ServerName answers /identity's friendlyName.
func (c *Client) ServerName(ctx context.Context) (string, error) {
	data, err := c.get(ctx, "/identity", nil)
	if err != nil {
		return "", err
	}
	return data.MediaContainer.FriendlyName, nil
}

// Sections lists movie/show libraries.
func (c *Client) Sections(ctx context.Context) ([]Section, error) {
	data, err := c.get(ctx, "/library/sections", nil)
	if err != nil {
		return nil, err
	}
	out := []Section{}
	for _, d := range data.MediaContainer.Directory {
		if d.Type == "movie" || d.Type == "show" {
			out = append(out, Section{Key: d.Key.String(), Title: d.Title, Type: d.Type})
		}
	}
	return out, nil
}

var tmdbGuidRe = regexp.MustCompile(`(?i)^tmdb://(.+)$`)

// Items fetches every movie (type=1) or every episode (type=4) in a section.
func (c *Client) Items(ctx context.Context, sec Section, itemType string) ([]Item, error) {
	data, err := c.get(ctx, "/library/sections/"+sec.Key+"/all",
		url.Values{"type": {itemType}, "includeGuids": {"1"}})
	if err != nil {
		return nil, err
	}
	out := []Item{}
	for _, m := range data.MediaContainer.Metadata {
		it := Item{
			Type:        m.Type,
			RatingKey:   m.RatingKey.String(),
			Title:       m.Title,
			Grandparent: m.GrandparentTitle,
		}
		it.Year, _ = strconv.Atoi(m.Year.String())
		it.Season, _ = strconv.Atoi(m.ParentIndex.String())
		it.Episode, _ = strconv.Atoi(m.Index.String())
		dur, _ := strconv.ParseInt(m.Duration.String(), 10, 64)
		it.DurationMs = dur
		vc, _ := strconv.Atoi(m.ViewCount.String())
		it.Watched = vc > 0 || m.LastViewedAt.String() != ""
		for _, g := range append([]string{m.Guid}, guids(m.GuidAlt)...) {
			if match := tmdbGuidRe.FindStringSubmatch(g); match != nil {
				it.TMDBID, _ = strconv.Atoi(match[1])
			}
		}
		out = append(out, it)
	}
	return out, nil
}

func guids(gs []struct{ ID string `json:"id"` }) []string {
	out := make([]string, 0, len(gs))
	for _, g := range gs {
		out = append(out, g.ID)
	}
	return out
}

// Scrobble marks a Plex item watched (push direction).
func (c *Client) Scrobble(ctx context.Context, ratingKey string) error {
	_, err := c.get(ctx, "/:/scrobble", url.Values{
		"key":        {ratingKey},
		"identifier": {"com.plexapp.plugins.library"},
	})
	return err
}

// --- identity normalization (ported from the bad attempt's normalize/keyFor) ---

var nonAlnumRe = regexp.MustCompile(`[^a-z0-9]+`)

func Normalize(s string) string {
	s = strings.ToLower(strings.ReplaceAll(s, "&", "and"))
	return strings.TrimSpace(nonAlnumRe.ReplaceAllString(s, " "))
}

func movieKey(title string, year int) string {
	if year > 0 {
		return fmt.Sprintf("%s|%d", Normalize(title), year)
	}
	return Normalize(title)
}

func episodeKey(series string, season, episode int) string {
	return fmt.Sprintf("%s|%d|%d", Normalize(series), season, episode)
}
