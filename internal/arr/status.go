// Outbound *arr integration: Lumina polls Radarr/Sonarr for queue and
// calendar state, powering the "Downloads" panel in the web client.
// (Inbound — webhooks and the Emby/Jellyfin shim — lives in hook.go and
// internal/api/shim.go.)
package arr

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"sync"
	"time"

	"github.com/lumina-media/lumina/internal/config"
)

type InstanceStatus struct {
	Name      string         `json:"name"`
	URL       string         `json:"url"`
	Reachable bool           `json:"reachable"`
	Version   string         `json:"version,omitempty"`
	Queue     []QueueItem    `json:"queue"`
	Upcoming  []CalendarItem `json:"upcoming"`
	Error     string         `json:"error,omitempty"`
}

type QueueItem struct {
	Title    string `json:"title"`
	Status   string `json:"status"`
	SizeLeft int64  `json:"sizeLeft"`
	Size     int64  `json:"size"`
	TimeLeft string `json:"timeLeft,omitempty"`
}

type CalendarItem struct {
	Title     string `json:"title"`
	Subtitle  string `json:"subtitle,omitempty"` // e.g. "S02E04" or year
	AirDate   string `json:"airDate"`
	HasFile   bool   `json:"hasFile"`
}

// FetchStatuses queries every configured instance concurrently; each has
// an 8s budget so a dead *arr never stalls the API response.
func FetchStatuses(ctx context.Context, instances []config.ArrInstance) []InstanceStatus {
	out := make([]InstanceStatus, len(instances))
	var wg sync.WaitGroup
	for i, inst := range instances {
		wg.Add(1)
		go func(i int, inst config.ArrInstance) {
			defer wg.Done()
			ctx, cancel := context.WithTimeout(ctx, 8*time.Second)
			defer cancel()
			out[i] = fetchOne(ctx, inst)
		}(i, inst)
	}
	wg.Wait()
	return out
}

func fetchOne(ctx context.Context, inst config.ArrInstance) InstanceStatus {
	st := InstanceStatus{Name: inst.Name, URL: inst.URL}

	var sysStatus struct {
		Version string `json:"version"`
	}
	if err := getJSON(ctx, inst, "/api/v3/system/status", &sysStatus); err != nil {
		st.Error = err.Error()
		return st
	}
	st.Reachable = true
	st.Version = sysStatus.Version

	var queue struct {
		Records []struct {
			Title    string `json:"title"`
			Status   string `json:"status"`
			Size     int64  `json:"size"`
			SizeLeft int64  `json:"sizeleft"`
			TimeLeft string `json:"timeleft"`
		} `json:"records"`
	}
	if err := getJSON(ctx, inst, "/api/v3/queue?page=1&pageSize=15", &queue); err == nil {
		for _, r := range queue.Records {
			st.Queue = append(st.Queue, QueueItem{
				Title: r.Title, Status: r.Status,
				Size: r.Size, SizeLeft: r.SizeLeft, TimeLeft: r.TimeLeft,
			})
		}
	}

	start := time.Now().Format("2006-01-02")
	end := time.Now().AddDate(0, 0, 7).Format("2006-01-02")
	// Sonarr and Radarr share the calendar shape; episode fields simply
	// stay empty on Radarr.
	var cal []struct {
		Title        string `json:"title"`
		SeriesTitle  string `json:"seriesTitle"`
		SeasonNumber int    `json:"seasonNumber"`
		EpisodeNum   int    `json:"episodeNumber"`
		AirDate      string `json:"airDate"`
		AirDateUtc   string `json:"airDateUtc"`
		HasFile      bool   `json:"hasFile"`
		Year         int    `json:"year"`
	}
	if err := getJSON(ctx, inst,
		fmt.Sprintf("/api/v3/calendar?start=%s&end=%s", start, end), &cal); err == nil {
		for _, c := range cal {
			item := CalendarItem{AirDate: c.AirDate, HasFile: c.HasFile}
			switch {
			case c.SeriesTitle != "":
				item.Title = c.SeriesTitle
				item.Subtitle = fmt.Sprintf("S%02dE%02d", c.SeasonNumber, c.EpisodeNum)
			default:
				item.Title = c.Title
				if c.Year > 0 {
					item.Subtitle = fmt.Sprintf("%d", c.Year)
				}
			}
			if item.AirDate == "" && len(c.AirDateUtc) >= 10 {
				item.AirDate = c.AirDateUtc[:10]
			}
			st.Upcoming = append(st.Upcoming, item)
		}
	}
	return st
}

func getJSON(ctx context.Context, inst config.ArrInstance, path string, out any) error {
	req, err := http.NewRequestWithContext(ctx, "GET", inst.URL+path, nil)
	if err != nil {
		return err
	}
	req.Header.Set("X-Api-Key", inst.APIKey)
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode != 200 {
		return fmt.Errorf("%s → %d", path, res.StatusCode)
	}
	return json.NewDecoder(res.Body).Decode(out)
}
