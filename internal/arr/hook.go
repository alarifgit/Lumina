// Package arr handles inbound Radarr/Sonarr webhooks (Tier-2 events).
// This is the native, best-fidelity door; the Emby/Jellyfin compat shim
// (internal/api/shim.go) is the zero-config door.
package arr

import (
	"encoding/json"
	"log"
	"net/http"

	"github.com/lumina-media/lumina/internal/scanner"
)

// Payload covers the shapes Radarr and Sonarr POST to a generic webhook.
// Only the fields Lumina needs are decoded.
type Payload struct {
	EventType string `json:"eventType"` // Grab, Download, Upgrade, Rename, Delete, Test
	MovieFile *struct {
		Path         string `json:"path"`
		RelativePath string `json:"relativePath"`
	} `json:"movieFile"`
	EpisodeFile *struct {
		Path         string `json:"path"`
		RelativePath string `json:"relativePath"`
	} `json:"episodeFile"`
	Series *struct {
		Path string `json:"path"`
	} `json:"series"`
	Movie *struct {
		Title string `json:"title"`
		Year  int    `json:"year"`
	} `json:"movie"`
}

// Handler returns an http.HandlerFunc for POST /hooks/arr.
// Paths are pushed to the scanner's Tier-2 queue; mapping from the *arr
// container's path conventions to Lumina's happens in scanner.RefreshPath
// via config.PathMappings — longest prefix wins, unmapped paths are logged.
func Handler(sc *scanner.Scanner) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var p Payload
		if err := json.NewDecoder(r.Body).Decode(&p); err != nil {
			http.Error(w, "bad payload", http.StatusBadRequest)
			return
		}
		log.Printf("arr hook: event=%s", p.EventType)

		switch p.EventType {
		case "Download", "Upgrade", "Rename":
			// Import complete — refresh exactly the imported file.
			switch {
			case p.MovieFile != nil && p.MovieFile.Path != "":
				sc.Notify(p.MovieFile.Path)
			case p.EpisodeFile != nil && p.EpisodeFile.Path != "":
				sc.Notify(p.EpisodeFile.Path)
			case p.Series != nil && p.Series.Path != "":
				sc.Notify(p.Series.Path) // directory → targeted rescan of that series
			}
		case "Grab", "Test":
			// Nothing on disk yet (Grab) or connectivity check (Test).
		case "Delete":
			// File deleted at the source — tombstone it. The item is only
			// marked missing once its last known path is gone.
			switch {
			case p.MovieFile != nil && p.MovieFile.Path != "":
				sc.Remove(p.MovieFile.Path)
			case p.EpisodeFile != nil && p.EpisodeFile.Path != "":
				sc.Remove(p.EpisodeFile.Path)
			}
		}
		w.WriteHeader(http.StatusAccepted)
	}
}
