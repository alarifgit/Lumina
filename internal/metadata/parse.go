// Filename parsing: "The.Matrix.1999.1080p.BluRay.x264-GROUP.mkv" →
// ("The Matrix", 1999); "Show.Name.S02E04.2160p.WEB-DL.mkv" →
// ("Show Name", S02E04). Filename conventions are *arr/Plex-standard.
//
// Year handling is deliberately conservative (ported from the reference
// implementation's splitTrailingReleaseYear): only a TRAILING year is
// metadata, and only when it's a plausible release year. "1917" and
// "Blade Runner 2049" are titles, not year tags.
package metadata

import (
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

var (
	episodeRe = regexp.MustCompile(`(?i)\bs(\d{1,2})e(\d{1,2})\b`)
	// Release tags: everything from the first tag onward is dropped.
	tagRe = regexp.MustCompile(`(?i)\b(1080p|720p|2160p|4320p|480p|4k|8k|uhd|hdr10|hdr|dv|dolby|vision|atmos|bluray|blu-ray|bdrip|brrip|webrip|web-dl|webdl|web|hdrip|hdtv|dvdrip|remux|x264|x265|h264|h265|hevc|avc|xvid|divx|aac|ac3|eac3|dts|ddp5|dd\+|flac|mp3|truehd|dts-hd|ma|5\.1|7\.1|2\.0|10bit|8bit|proper|repack|rerip|extended|directors?|cut|unrated|theatrical|internal|limited|imax|edition|collection|complete|multi|dual|sub|subs|subbed|dubbed|ws|fs|ntsc|pal|amg|fgt)\b`)
	sepRe = regexp.MustCompile(`[\._]+`)
	// Trailing year, optionally bracketed: "Title (2009)" / "Title.2009".
	trailingYearRe = regexp.MustCompile(`^(.*?)\s*[\(\[]?\b((?:19|20)\d{2})\b[\)\]]?\s*$`)
	// Absolute episode numbering, fansub-style: "[Group] Show - 362 (1080p)
	// [ABCD1234]" / "Show - 042". Anime libraries number long-running shows
	// absolutely instead of SxxExx. TV context only — never apply to movies.
	absEpisodeRe = regexp.MustCompile(`[-–—]\s*(\d{1,4})(?:\s*v\d+)?\s*$`)
	// "Season 3" / "season 03" directory names.
	seasonDirRe = regexp.MustCompile(`(?i)\bseason\s*(\d{1,2})\b`)
	// Trailing checksum/crc bracket: "[ABCD1234]" / "(1080p)" leftovers.
	trailingBracketRe = regexp.MustCompile(`[\[\(][^\[\]\(\)]*[\]\)]\s*$`)
)

// Parsed is the identification hint extracted from a media filename.
type Parsed struct {
	Title        string
	Year         int
	Season       int // 0 = not an episode
	Episode      int
	EpisodeTitle string // display name after the SxxExx marker, if any
}

// ParseFilename extracts title/year/episode info from a media filename
// (without path or extension).
func ParseFilename(base string) Parsed {
	p := Parsed{}
	work := sepRe.ReplaceAllString(base, " ")

	if m := episodeRe.FindStringSubmatchIndex(work); m != nil {
		p.Season = atoi(work[m[2]:m[3]])
		p.Episode = atoi(work[m[4]:m[5]])
		// Episode display name: text after the marker, tags stripped
		// ("Show.S02E04.The.Last.Dance.1080p" → "The Last Dance").
		rest := work[m[1]:]
		if m2 := tagRe.FindStringIndex(rest); m2 != nil {
			rest = rest[:m2[0]]
		}
		rest = strings.Trim(strings.TrimSpace(strings.Join(strings.Fields(rest), " ")), "-–— ")
		if rest != "" && !episodeRe.MatchString(rest) {
			p.EpisodeTitle = rest
		}
		work = work[:m[0]]
	}
	if m := tagRe.FindStringIndex(work); m != nil {
		work = work[:m[0]]
	}
	work = strings.TrimSpace(strings.Join(strings.Fields(work), " "))

	// Only a trailing year counts, and only a plausible one. A bare-year
	// string ("1917") has an empty base → it stays the whole title.
	if m := trailingYearRe.FindStringSubmatch(work); m != nil {
		baseTitle := strings.TrimSpace(strings.TrimRight(m[1], ".-_ "))
		year := atoi(m[2])
		if baseTitle != "" && year >= 1888 && year <= time.Now().Year()+5 {
			p.Title = baseTitle
			p.Year = year
			return p
		}
	}
	p.Title = work
	return p
}

// HintFor derives identification hints from a file's position inside a
// library root — the Plex folder conventions the scanner and the manual
// re-identify endpoint both rely on:
//
//	/TV/Bleach/Season 17/file.mkv → series "Bleach", season 17
//	[Group] Show - 362.mkv        → absolute episode 362 (no SxxExx marker)
//
// isTV gates every hint: movies never get folder/absolute-episode treatment.
func HintFor(rootPath, fullPath string, isTV bool) IdentifyHint {
	h := IdentifyHint{}
	if !isTV {
		return h
	}
	if rel, err := filepath.Rel(rootPath, fullPath); err == nil {
		comps := strings.Split(rel, string(filepath.Separator))
		if len(comps) >= 2 {
			// "Countdown (2025)" → series "Countdown", year 2025: the folder
			// year is the disambiguator between same-titled shows (the 2025
			// thriller vs the 1982 game show), so keep it.
			parsed := ParseFilename(comps[0])
			h.Series = parsed.Title
			h.Year = parsed.Year
			if season := SeasonFromDir(comps[len(comps)-2]); season > 0 {
				h.Season = season
			}
		}
	}
	base := strings.TrimSuffix(filepath.Base(fullPath), filepath.Ext(fullPath))
	if !episodeMarkerRe.MatchString(base) {
		h.AbsEpisode = ParseAbsoluteEpisode(base)
	}
	return h
}

var episodeMarkerRe = regexp.MustCompile(`(?i)\bs\d{1,2}\s*e\d{1,4}\b`)

// ParseAbsoluteEpisode extracts an absolute episode number from fansub-style
// names ("[SubsPlease] Bleach - 362 (1080p) [ABCD1234]" → 362). Returns 0
// when there is no unambiguous trailing " - NNN" counter. TV libraries only:
// a dash-number at the end of a MOVIE name is far more likely part of the
// title, so callers must gate on library kind. Year-shaped numbers
// (1900–2099) are excluded — those are years, not episode counters.
func ParseAbsoluteEpisode(base string) int {
	work := sepRe.ReplaceAllString(base, " ")
	if m := tagRe.FindStringIndex(work); m != nil {
		work = work[:m[0]]
	}
	// A tag cut can leave the opening bracket behind ("- 362 ("), and
	// dashes/spaces around it — trim before matching the counter.
	work = strings.TrimRight(work, "([{ -–—._")
	work = strings.TrimSpace(work)
	// Drop trailing bracket groups: "[ABCD1234]", "(BD 1080p)" leftovers.
	for {
		next := strings.TrimSpace(trailingBracketRe.ReplaceAllString(work, ""))
		if next == work {
			break
		}
		work = next
	}
	m := absEpisodeRe.FindStringSubmatch(work)
	if m == nil {
		return 0
	}
	n := atoi(m[1])
	if n == 0 || (n >= 1900 && n <= 2099) {
		return 0
	}
	return n
}

// SeasonFromDir extracts a season number from a directory name
// ("Season 3" → 3, "Season 03" → 3). Returns 0 when absent.
func SeasonFromDir(dir string) int {
	if m := seasonDirRe.FindStringSubmatch(dir); m != nil {
		return atoi(m[1])
	}
	return 0
}

func atoi(s string) int {
	n := 0
	for _, r := range s {
		if r < '0' || r > '9' {
			return n
		}
		n = n*10 + int(r-'0')
	}
	return n
}
