// Package config loads Lumina's runtime configuration from a JSON file
// plus environment variable overrides.
package config

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// LibraryRoot is a filesystem path Lumina treats as a media library.
// Lumina never speaks SMB/NFS itself — mounting is the host's job,
// bind mounts are Docker's job. A root is just a path.
type LibraryRoot struct {
	Name string `json:"name"`
	Path string `json:"path"`
	Kind string `json:"kind"` // "movies" | "tv"
}

// PathMapping rewrites paths reported by external tools (Radarr/Sonarr)
// into paths as seen by this Lumina process. Longest-prefix match wins.
type PathMapping struct {
	From string `json:"from"` // e.g. "/data/movies" (as the *arr container sees it)
	To   string `json:"to"`   // e.g. "/media/movies" (as Lumina sees it)
}

type ArrInstance struct {
	Name   string `json:"name"` // "sonarr" | "radarr" | free-form label
	URL    string `json:"url"`  // e.g. "http://sonarr:8989"
	APIKey string `json:"apiKey"`
}

type Config struct {
	DataDir      string        `json:"dataDir"`
	HTTPAddr     string        `json:"httpAddr"`    // e.g. ":8096"
	FFmpegPath   string        `json:"ffmpegPath"`  // default "ffmpeg"
	FFprobePath  string        `json:"ffprobePath"` // default "ffprobe"
	Libraries    []LibraryRoot `json:"libraries"`
	PathMappings []PathMapping `json:"pathMappings"`
	Arr          []ArrInstance `json:"arr"`
	// ShimAPIKey, when set, is required on Emby/Jellyfin shim calls
	// (as ?api_key= or X-Emby-Token). Empty = accept anything (dev default).
	ShimAPIKey string `json:"shimApiKey"`
	// TMDB metadata provider (Phase 6). No key = procedural posters only.
	TMDB TMDBConfig `json:"tmdb"`
	// Plex source server for watch-state migration import.
	Plex PlexConfig `json:"plex"`
	// SweepIntervalMinutes is the Tier-3 mtime sweep cadence for roots
	// where inotify is unavailable (network mounts).
	SweepIntervalMinutes int `json:"sweepIntervalMinutes"`
}

type PlexConfig struct {
	URL   string `json:"url"`
	Token string `json:"token"`
	// SyncIntervalMinutes is the periodic watch-state pull cadence.
	// 0 = the 30-minute default; negative disables the loop.
	SyncIntervalMinutes int `json:"syncIntervalMinutes"`
}

type TMDBConfig struct {
	APIKey   string `json:"apiKey"`
	Language string `json:"language"` // e.g. "en-US"
}

func Default() Config {
	return Config{
		DataDir:              "./data",
		HTTPAddr:             ":8096",
		FFmpegPath:           "ffmpeg",
		FFprobePath:          "ffprobe",
		SweepIntervalMinutes: 10,
	}
}

// Load reads path if it exists, then applies env overrides.
// Missing file is not an error — defaults plus env are used.
func Load(path string) (Config, error) {
	cfg := Default()
	data, err := os.ReadFile(path)
	if err == nil {
		if err := json.Unmarshal(data, &cfg); err != nil {
			return cfg, fmt.Errorf("parse %s: %w", path, err)
		}
	} else if !os.IsNotExist(err) {
		return cfg, fmt.Errorf("read %s: %w", path, err)
	}

	if v := os.Getenv("LUMINA_DATA_DIR"); v != "" {
		cfg.DataDir = v
	}
	if v := os.Getenv("LUMINA_HTTP_ADDR"); v != "" {
		cfg.HTTPAddr = v
	}
	if v := os.Getenv("LUMINA_FFMPEG"); v != "" {
		cfg.FFmpegPath = v
	}
	if v := os.Getenv("LUMINA_FFPROBE"); v != "" {
		cfg.FFprobePath = v
	}
	if v := os.Getenv("LUMINA_TMDB_KEY"); v != "" {
		cfg.TMDB.APIKey = v
	} else if v := os.Getenv("TMDB_API_KEY"); v != "" {
		// Common in community docker stacks — accept it too.
		cfg.TMDB.APIKey = v
	}
	if v := os.Getenv("LUMINA_PLEX_URL"); v != "" {
		cfg.Plex.URL = v
	} else if v := os.Getenv("PLEX_URL"); v != "" {
		cfg.Plex.URL = v
	}
	if v := os.Getenv("LUMINA_PLEX_TOKEN"); v != "" {
		cfg.Plex.Token = v
	} else if v := os.Getenv("PLEX_TOKEN"); v != "" {
		cfg.Plex.Token = v
	}
	abs, err := filepath.Abs(cfg.DataDir)
	for i := range cfg.Libraries {
		cfg.Libraries[i].Name = strings.TrimSpace(cfg.Libraries[i].Name)
		cfg.Libraries[i].Kind = strings.TrimSpace(cfg.Libraries[i].Kind)
		if path := strings.TrimSpace(cfg.Libraries[i].Path); path != "" {
			cfg.Libraries[i].Path = filepath.Clean(path)
		}
	}
	for i := range cfg.PathMappings {
		if from := strings.TrimSpace(cfg.PathMappings[i].From); from != "" {
			cfg.PathMappings[i].From = filepath.Clean(from)
		}
		if to := strings.TrimSpace(cfg.PathMappings[i].To); to != "" {
			cfg.PathMappings[i].To = filepath.Clean(to)
		}
	}
	if err == nil {
		cfg.DataDir = abs
	}
	return cfg, nil
}

// MapPath rewrites an externally-reported path to Lumina's view of it.
// Returns the input unchanged when no mapping matches.
func (c Config) MapPath(external string) string {
	best := ""
	out := external
	for _, m := range c.PathMappings {
		if len(m.From) >= len(best) && hasPathPrefix(external, m.From) {
			best = m.From
			out = m.To + external[len(m.From):]
		}
	}
	return out
}

func hasPathPrefix(p, prefix string) bool {
	if len(p) < len(prefix) {
		return false
	}
	if p[:len(prefix)] != prefix {
		return false
	}
	// match on segment boundary: "/data" matches "/data/x" and "/data", not "/database"
	return len(p) == len(prefix) || p[len(prefix)] == '/'
}
