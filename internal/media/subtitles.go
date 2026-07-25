// Subtitle discovery and WebVTT delivery.
//
// Ported and distilled from the subtitle engine in lumina_badattempt
// (src/lib/subtitles.ts) — credit where due: the discovery heuristics
// (basename matching, nested Subs/Subtitles dirs, language/forced/SDH
// filename parsing) were the good parts of that codebase.
//
// Sources:
//   - sidecar files: Movie.srt, Movie.en.srt, Movie.eng.sdh.srt, …
//     next to the video or in a Subs/Subtitles subdirectory
//   - embedded TEXT streams (subrip/ass/ssa/webvtt/mov_text) extracted
//     with `ffmpeg -map 0:N -f webvtt pipe:1`
//
// Bitmap subtitles (PGS/VobSub) are excluded: they need burn-in, which
// is a Phase 7+ transcode-graph feature.
package media

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

var subtitleExts = map[string]bool{
	".vtt": true, ".srt": true, ".ass": true, ".ssa": true, ".sub": true,
}

var textSubtitleCodecs = map[string]bool{
	"subrip": true, "srt": true, "ass": true, "ssa": true,
	"webvtt": true, "mov_text": true, "text": true,
}

// Subtitle is one selectable track. IDs are stable within a probe:
// "sc-<n>" for sidecars (discovery order), "emb-<streamIndex>" for embedded.
type Subtitle struct {
	ID          string `json:"id"`
	Language    string `json:"language"`
	Label       string `json:"label"`
	Format      string `json:"format"` // vtt | srt | ass | codec name
	Source      string `json:"source"` // sidecar | embedded
	StreamIndex int    `json:"streamIndex"`
	Default     bool   `json:"default"`

	path string // sidecar file path — never serialized
}

var langRe = regexp.MustCompile(`(?i)[\._\s-](en|eng|english|ja|jpn|japanese|es|spa|spanish|fr|fre|french|de|ger|german|pt|por|portuguese|zh|chi|chinese|ko|kor|korean|it|ita|italian|ru|rus|russian|ar|ara|arabic|hi|hin|hindi)(?:[\._\s-]|$)`)

var langNames = map[string][2]string{
	"en": {"en", "English"}, "eng": {"en", "English"}, "english": {"en", "English"},
	"ja": {"ja", "Japanese"}, "jpn": {"ja", "Japanese"}, "japanese": {"ja", "Japanese"},
	"es": {"es", "Spanish"}, "spa": {"es", "Spanish"}, "spanish": {"es", "Spanish"},
	"fr": {"fr", "French"}, "fre": {"fr", "French"}, "french": {"fr", "French"},
	"de": {"de", "German"}, "ger": {"de", "German"}, "german": {"de", "German"},
	"pt": {"pt", "Portuguese"}, "por": {"pt", "Portuguese"}, "portuguese": {"pt", "Portuguese"},
	"zh": {"zh", "Chinese"}, "chi": {"zh", "Chinese"}, "chinese": {"zh", "Chinese"},
	"ko": {"ko", "Korean"}, "kor": {"ko", "Korean"}, "korean": {"ko", "Korean"},
	"it": {"it", "Italian"}, "ita": {"it", "Italian"}, "italian": {"it", "Italian"},
	"ru": {"ru", "Russian"}, "rus": {"ru", "Russian"}, "russian": {"ru", "Russian"},
	"ar": {"ar", "Arabic"}, "ara": {"ar", "Arabic"}, "arabic": {"ar", "Arabic"},
	"hi": {"hi", "Hindi"}, "hin": {"hi", "Hindi"}, "hindi": {"hi", "Hindi"},
}

func parseSubtitleLang(fileName string) (string, string) {
	base := strings.TrimSuffix(fileName, filepath.Ext(fileName))
	if m := langRe.FindStringSubmatch(base); m != nil {
		if pair, ok := langNames[strings.ToLower(m[1])]; ok {
			return pair[0], pair[1]
		}
	}
	return "und", "Unknown"
}

var forcedRe = regexp.MustCompile(`(?i)(?:^|[._ -])forced(?:[._ -]|$)`)
var sdhRe = regexp.MustCompile(`(?i)(?:^|[._ -])(sdh|cc)(?:[._ -]|$)`)

// DiscoverSubtitles finds every usable track for a video file: sidecars
// from the filesystem (no ffprobe needed) plus embedded text streams
// from an already-computed Info.
func DiscoverSubtitles(videoPath string, info *Info) []Subtitle {
	out := discoverSidecars(videoPath)
	if info != nil {
		for _, st := range info.Subtitles {
			if !textSubtitleCodecs[strings.ToLower(st.Codec)] {
				continue // bitmap (PGS/VobSub): needs burn-in, not a track
			}
			lang, label := st.Language, ""
			if lang == "" {
				lang, label = "und", "Unknown"
			} else if l, ok := langNames[strings.ToLower(lang)]; ok {
				lang, label = l[0], l[1]
			} else {
				label = strings.ToUpper(lang)
			}
			if st.Title != "" {
				label = st.Title
			}
			out = append(out, Subtitle{
				ID:          fmt.Sprintf("emb-%d", st.Index),
				Language:    lang,
				Label:       label,
				Format:      st.Codec,
				Source:      "embedded",
				StreamIndex: st.Index,
				Default:     st.Default,
			})
		}
	}
	return out
}

// discoverSidecars finds subtitle files sharing the video's basename,
// in the video's directory and any Subs/Subtitles subdirectory.
func discoverSidecars(videoPath string) []Subtitle {
	dir := filepath.Dir(videoPath)
	base := strings.TrimSuffix(filepath.Base(videoPath), filepath.Ext(videoPath))
	out := []Subtitle{}
	seen := map[string]bool{}
	n := 0

	scan := func(d string) {
		entries, err := os.ReadDir(d)
		if err != nil {
			return
		}
		for _, e := range entries {
			if e.IsDir() {
				continue
			}
			ext := strings.ToLower(filepath.Ext(e.Name()))
			if !subtitleExts[ext] {
				continue
			}
			entryBase := strings.TrimSuffix(e.Name(), ext)
			if entryBase != base &&
				!strings.HasPrefix(entryBase, base+".") &&
				!strings.HasPrefix(entryBase, base+"_") &&
				!strings.HasPrefix(entryBase, base+"-") {
				continue
			}
			full := filepath.Join(d, e.Name())
			if seen[full] {
				continue
			}
			seen[full] = true
			lang, label := parseSubtitleLang(e.Name())
			switch {
			case forcedRe.MatchString(entryBase):
				label += " (Forced)"
			case sdhRe.MatchString(entryBase):
				label += " (SDH)"
			}
			out = append(out, Subtitle{
				ID:          fmt.Sprintf("sc-%d", n),
				Language:    lang,
				Label:       label,
				Format:      strings.TrimPrefix(ext, "."),
				Source:      "sidecar",
				StreamIndex: -1,
				Default:     forcedRe.MatchString(entryBase),
				path:        full,
			})
			n++
		}
	}

	scan(dir)
	if entries, err := os.ReadDir(dir); err == nil {
		for _, e := range entries {
			if e.IsDir() && (strings.EqualFold(e.Name(), "subs") || strings.EqualFold(e.Name(), "subtitles")) {
				scan(filepath.Join(dir, e.Name()))
			}
		}
	}
	return out
}

// LookupSidecar re-runs sidecar discovery and returns the path for a
// "sc-N" ID. Discovery is cheap (readdir) — no cache needed.
func LookupSidecar(videoPath, id string) (string, bool) {
	for _, s := range discoverSidecars(videoPath) {
		if s.ID == id {
			return s.path, true
		}
	}
	return "", false
}

var srtTimestampRe = regexp.MustCompile(`(\d{2}:\d{2}:\d{2}),(\d{3})`)

// SRTToVTT converts SubRip content to WebVTT: header + comma→dot in
// timestamps. (Direct port of the bad attempt's srtToVtt.)
func SRTToVTT(srt string) string {
	withHeader := "WEBVTT\n\n" + strings.ReplaceAll(srt, "\r", "")
	return srtTimestampRe.ReplaceAllString(withHeader, "$1.$2")
}

// SidecarVTT reads a sidecar file and returns WebVTT content.
// ASS/SSA/SUB go through ffmpeg for conversion.
func SidecarVTT(ctx context.Context, ffmpeg, path string) (string, error) {
	ext := strings.ToLower(filepath.Ext(path))
	switch ext {
	case ".vtt":
		data, err := os.ReadFile(path)
		return string(data), err
	case ".srt":
		data, err := os.ReadFile(path)
		if err != nil {
			return "", err
		}
		return SRTToVTT(string(data)), nil
	default:
		return extractVTT(ctx, ffmpeg, path, -1)
	}
}

// EmbeddedVTT extracts an embedded subtitle stream as WebVTT.
func EmbeddedVTT(ctx context.Context, ffmpeg, videoPath string, streamIndex int) (string, error) {
	return extractVTT(ctx, ffmpeg, videoPath, streamIndex)
}

func extractVTT(ctx context.Context, ffmpeg, input string, streamIndex int) (string, error) {
	ctx, cancel := context.WithTimeout(ctx, 60*time.Second)
	defer cancel()
	args := []string{"-v", "error", "-i", input}
	if streamIndex >= 0 {
		args = append(args, "-map", fmt.Sprintf("0:%d", streamIndex))
	}
	args = append(args, "-f", "webvtt", "pipe:1")
	out, err := exec.CommandContext(ctx, ffmpeg, args...).Output()
	if err != nil {
		return "", fmt.Errorf("ffmpeg subtitle extract: %w", err)
	}
	s := string(out)
	if !strings.HasPrefix(s, "WEBVTT") {
		s = "WEBVTT\n\n" + s
	}
	return s, nil
}
