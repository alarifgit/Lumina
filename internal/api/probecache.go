// ffprobe results, cached on disk by content hash.
//
// Every playback start used to pay a live ffprobe over SMB — 6-12s on the
// reference host — once for /info and AGAIN for /subtitles (two separate
// probes of the same file!). The probe answer is a pure function of the
// file's bytes, and items are already hash-identified, so: probe once,
// serve forever. Replace the file and the hash changes, so stale probe
// data can never be served (same invariant as the subtitle VTT cache).
package api

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"

	"github.com/lumina-media/lumina/internal/library"
	"github.com/lumina-media/lumina/internal/media"
)

func (s *Server) probeCachePath(it *library.Item) string {
	hashKey := it.Hash
	if len(hashKey) > 16 {
		hashKey = hashKey[:16]
	}
	if hashKey == "" {
		hashKey = it.ID
	}
	return filepath.Join(s.cfg.DataDir, "probe", hashKey+".json")
}

// probeCached returns the media.Info for an item's playable path, from
// the disk cache when present and via a live ffprobe otherwise.
func (s *Server) probeCached(ctx context.Context, it *library.Item, path string) (*media.Info, error) {
	cachePath := s.probeCachePath(it)
	if raw, err := os.ReadFile(cachePath); err == nil && len(raw) > 0 {
		var info media.Info
		if json.Unmarshal(raw, &info) == nil && info.Video != nil {
			return &info, nil
		}
	}
	info, err := media.Probe(ctx, s.cfg.FFprobePath, path)
	if err != nil {
		return nil, err
	}
	if raw, mErr := json.Marshal(info); mErr == nil {
		if os.MkdirAll(filepath.Dir(cachePath), 0o755) == nil {
			_ = os.WriteFile(cachePath, raw, 0o644) // best-effort
		}
	}
	return info, nil
}
