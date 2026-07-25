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
