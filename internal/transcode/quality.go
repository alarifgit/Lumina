// The quality ladder: Plex-style bitrate rungs for transcoded playback.
//
// "original" is the existing behaviour — copy for h264 SDR sources, else
// a high-quality re-encode (qp/crf 22, unconstrained bitrate). Every other
// rung forces a re-encode at a capped bitrate and resolution, which is
// also why selecting a rung forces transcode even for direct-playable
// files (Plex behaves the same way).
package transcode

// Quality is one rung of the ladder.
type Quality struct {
	ID        string `json:"id"`        // "original" | "1080p" | "720p" | "480p"
	Label     string `json:"label"`     // UI label, e.g. "720p · 4 Mbps"
	MaxHeight int    `json:"maxHeight"` // 0 = no downscale
	VideoBps  int64  `json:"videoBps"`  // 0 = unconstrained (qp/crf quality mode)
	AudioBps  int64  `json:"audioBps"`  // audio bitrate cap
}

// Ladder lists every rung, highest first. Original is always first.
var Ladder = []Quality{
	{ID: "original", Label: "Original", MaxHeight: 0, VideoBps: 0, AudioBps: 192_000},
	{ID: "1080p", Label: "1080p · 8 Mbps", MaxHeight: 1080, VideoBps: 8_000_000, AudioBps: 192_000},
	{ID: "720p", Label: "720p · 4 Mbps", MaxHeight: 720, VideoBps: 4_000_000, AudioBps: 128_000},
	{ID: "480p", Label: "480p · 2 Mbps", MaxHeight: 480, VideoBps: 2_000_000, AudioBps: 96_000},
}

// ParseQuality resolves a query-param string to a rung. Unknown or empty
// means Original — a forged quality param can never produce nonsense args.
func ParseQuality(s string) Quality {
	for _, q := range Ladder {
		if q.ID == s {
			return q
		}
	}
	return Ladder[0]
}

// Constrained reports whether this rung forces a re-encode (resolution or
// bitrate cap) — i.e. video copy is off the table.
func (q Quality) Constrained() bool {
	return q.MaxHeight > 0 || q.VideoBps > 0
}
