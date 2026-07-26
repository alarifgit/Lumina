// Package media wraps ffprobe: the source of truth for what a file
// actually contains. The web client uses this to choose direct play vs
// transcode; the transcode layer uses it to build the FFmpeg graph
// (HDR detection, stream mapping).
package media

import (
	"context"
	"encoding/json"
	"fmt"
	"os/exec"
	"time"
)

type Info struct {
	Container  string   `json:"container"` // e.g. "matroska,webm" → normalized via IsContainer()
	DurationS  float64  `json:"durationS"`
	SizeBytes  int64    `json:"sizeBytes"`
	Video      *Stream  `json:"video,omitempty"`
	Audio      []Stream `json:"audio"`
	Subtitles  []Stream `json:"subtitles"`
	HDR        bool     `json:"hdr"` // bt2020 / PQ / HLG detected
}

type Stream struct {
	Index     int    `json:"index"`
	Codec     string `json:"codec"`     // h264, hevc, vp9, av1, aac, ac3, ...
	Profile   string `json:"profile,omitempty"`
	Width     int    `json:"width,omitempty"`
	Height    int    `json:"height,omitempty"`
	Bitrate   int64  `json:"bitrate,omitempty"`
	Channels  int    `json:"channels,omitempty"`
	Language  string `json:"language,omitempty"`
	ColorPrim string `json:"colorPrimaries,omitempty"`
	ColorXfer string `json:"colorTransfer,omitempty"`
	Title     string `json:"title,omitempty"`
	Default   bool   `json:"default"`
}

// ffprobe's JSON shape (only fields Lumina uses).
type probeOutput struct {
	Format struct {
		FormatName string `json:"format_name"`
		Duration   string `json:"duration"`
		Size       string `json:"size"`
	} `json:"format"`
	Streams []struct {
		Index         int    `json:"index"`
		CodecName     string `json:"codec_name"`
		CodecType     string `json:"codec_type"`
		Profile       string `json:"profile"`
		Width         int    `json:"width"`
		Height        int    `json:"height"`
		Channels      int    `json:"channels"`
		BitRate       string `json:"bit_rate"`
		ColorPrim     string `json:"color_primaries"`
		ColorXfer     string `json:"color_transfer"`
		Disposition   struct {
			Default int `json:"default"`
		} `json:"disposition"`
		Tags struct {
			Language string `json:"language"`
			Title    string `json:"title"`
		} `json:"tags"`
	} `json:"streams"`
}

// Probe runs ffprobe on path. 30s budget: network mounts can stall.
// probesize/analyzeduration are capped small: we only need container and
// stream HEADERS (codec, profile, color tags), not decoded frames — the
// defaults (5s of analysis) turned every uncached probe into a 7-second
// SMB crawl.
func Probe(ctx context.Context, ffprobePath, path string) (*Info, error) {
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, ffprobePath,
		"-v", "error", "-print_format", "json",
		"-probesize", "2M", "-analyzeduration", "1M",
		"-show_format", "-show_streams", path)
	out, err := cmd.Output()
	if err != nil {
		return nil, fmt.Errorf("ffprobe %s: %w", path, err)
	}
	var po probeOutput
	if err := json.Unmarshal(out, &po); err != nil {
		return nil, fmt.Errorf("parse ffprobe output: %w", err)
	}

	info := &Info{Container: po.Format.FormatName}
	fmt.Sscanf(po.Format.Duration, "%f", &info.DurationS)
	fmt.Sscanf(po.Format.Size, "%d", &info.SizeBytes)

	for _, s := range po.Streams {
		st := Stream{
			Index:     s.Index,
			Codec:     s.CodecName,
			Profile:   s.Profile,
			Width:     s.Width,
			Height:    s.Height,
			Channels:  s.Channels,
			Language:  s.Tags.Language,
			Title:     s.Tags.Title,
			ColorPrim: s.ColorPrim,
			ColorXfer: s.ColorXfer,
			Default:   s.Disposition.Default == 1,
		}
		fmt.Sscanf(s.BitRate, "%d", &st.Bitrate)
		switch s.CodecType {
		case "video":
			if info.Video == nil {
				v := st
				info.Video = &v
			}
		case "audio":
			info.Audio = append(info.Audio, st)
		case "subtitle":
			info.Subtitles = append(info.Subtitles, st)
		}
	}

	// HDR heuristic: bt2020 primaries or PQ/HLG transfer on the video stream.
	if v := info.Video; v != nil {
		if v.ColorPrim == "bt2020" || v.ColorXfer == "smpte2084" || v.ColorXfer == "arib-std-b67" {
			info.HDR = true
		}
	}
	return info, nil
}

// IsContainer reports whether ffprobe's (possibly comma-joined) format
// list contains one of the given names, e.g. IsContainer("mp4", "mov").
func (i *Info) IsContainer(names ...string) bool {
	for _, have := range splitComma(i.Container) {
		for _, want := range names {
			if have == want {
				return true
			}
		}
	}
	return false
}

func splitComma(s string) []string {
	out := []string{}
	cur := ""
	for _, r := range s {
		if r == ',' {
			out = append(out, cur)
			cur = ""
		} else {
			cur += string(r)
		}
	}
	if cur != "" {
		out = append(out, cur)
	}
	return out
}
