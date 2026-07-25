package metadata

import "testing"

func TestParseFilenameMovieYear(t *testing.T) {
	p := ParseFilename("The.Matrix.1999.1080p.BluRay.x264-GROUP")
	if p.Title != "The Matrix" || p.Year != 1999 {
		t.Fatalf("got %+v", p)
	}
}

func TestParseFilenameEpisode(t *testing.T) {
	p := ParseFilename("Show.Name.S02E04.2160p.WEB-DL")
	if p.Title != "Show Name" || p.Season != 2 || p.Episode != 4 {
		t.Fatalf("got %+v", p)
	}
}

func TestParseFilenameNumericTitlesStayTitles(t *testing.T) {
	// "1917" is a title, not a year tag.
	if p := ParseFilename("1917.2160p.WEB-DL"); p.Title != "1917" || p.Year != 0 {
		t.Fatalf("1917: got %+v", p)
	}
	// "Blade Runner 2049" — implausible trailing year stays in the title.
	if p := ParseFilename("Blade.Runner.2049.1080p.BluRay"); p.Title != "Blade Runner 2049" || p.Year != 0 {
		t.Fatalf("2049: got %+v", p)
	}
}

func TestParseFilenameBracketedTrailingYear(t *testing.T) {
	// "2012 (2009)": the bracketed trailing year is the metadata year.
	p := ParseFilename("2012.(2009).1080p")
	if p.Title != "2012" || p.Year != 2009 {
		t.Fatalf("got %+v", p)
	}
}

func TestParseFilenameEpisodeDisplayName(t *testing.T) {
	p := ParseFilename("Show.Name.S02E04.The.Last.Dance.1080p.WEB-DL")
	if p.Title != "Show Name" || p.EpisodeTitle != "The Last Dance" {
		t.Fatalf("got %+v", p)
	}
}

func TestParseAbsoluteEpisode(t *testing.T) {
	cases := []struct {
		in   string
		want int
	}{
		{"[SubsPlease] Bleach - 362 (1080p) [ABCD1234]", 362},
		{"[Erai-raws] One Piece - 1100 (1080p)[Multiple Subtitle]", 1100},
		{"Show Name - 042", 42},
		{"Bleach - 17 v2", 17},
		// No dash-counter → no episode. Year-shaped numbers are excluded.
		{"Movie Name 2012 1080p", 0},
		{"Some Show - 2012", 0},
		{"Bleach S17E24 1080p", 0},
		{"Plain Title", 0},
	}
	for _, c := range cases {
		if got := ParseAbsoluteEpisode(c.in); got != c.want {
			t.Errorf("ParseAbsoluteEpisode(%q) = %d, want %d", c.in, got, c.want)
		}
	}
}

func TestSeasonFromDir(t *testing.T) {
	cases := map[string]int{
		"Season 3":       3,
		"season 03":      3,
		"Season 17":      17,
		"Bleach":         0,
		"Season of Mist": 0,
	}
	for dir, want := range cases {
		if got := SeasonFromDir(dir); got != want {
			t.Errorf("SeasonFromDir(%q) = %d, want %d", dir, got, want)
		}
	}
}
