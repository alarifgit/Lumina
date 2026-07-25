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
