"use client";

import { useCallback, useState } from "react";
import { Loader2, Search, WandSparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { toast } from "@/hooks/use-toast";
import { useApplyMetadata, useMetadataSearch } from "@/lib/queries";
import { splitTrailingReleaseYear } from "@/lib/title-parser";
import type { MediaSummary } from "@/lib/types";

type MatchResult = {
  tmdbId: number;
  title: string;
  year: number | null;
  overview: string | null;
  posterUrl: string | null;
};

interface Props {
  media: MediaSummary;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function MediaMatchDialog({ media, open, onOpenChange }: Props) {
  const parsed = splitTrailingReleaseYear(media.title, media.year ?? undefined);
  const [query, setQuery] = useState(parsed.title);
  const [year, setYear] = useState(parsed.year ? String(parsed.year) : "");
  const [results, setResults] = useState<MatchResult[]>([]);
  const { mutateAsync: searchMetadata, isPending: searchPending } = useMetadataSearch();
  const { mutateAsync: applyMetadata, isPending: applyPending } = useApplyMetadata();

  const runSearch = useCallback(
    async (searchTitle: string, searchYear: string) => {
      if (!searchTitle.trim()) return;
      try {
        const response = await searchMetadata({
          title: searchTitle.trim(),
          type: media.type,
          year: searchYear ? Number(searchYear) : undefined,
        });
        setResults(response.results);
      } catch (error) {
        setResults([]);
        toast({
          title: "Metadata search failed",
          description: (error as Error).message,
          variant: "destructive",
        });
      }
    },
    [media.type, searchMetadata]
  );

  const applyMatch = async (tmdbId: number) => {
    try {
      await applyMetadata({ mediaId: media.id, tmdbId, type: media.type });
      toast({
        title: "Match updated",
        description: `${media.title} was matched and refreshed from TMDB.`,
      });
      onOpenChange(false);
    } catch (error) {
      toast({
        title: "Couldn't apply match",
        description: (error as Error).message,
        variant: "destructive",
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[86vh] overflow-hidden border-white/14 bg-[#1b303b]/96 p-0 text-foreground shadow-[0_24px_90px_rgba(7,23,32,0.58)] backdrop-blur-2xl sm:max-w-3xl"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") event.stopPropagation();
        }}
        onOpenAutoFocus={() => {
          void runSearch(parsed.title, parsed.year ? String(parsed.year) : "");
        }}
      >
        <DialogHeader className="border-b border-[var(--line-soft)] px-5 py-4">
          <DialogTitle className="flex items-center gap-2 text-xl">
            <WandSparkles className="h-5 w-5 text-primary" />
            Fix match
          </DialogTitle>
          <DialogDescription>
            Search TMDB and choose the title that belongs to {media.title}.
          </DialogDescription>
        </DialogHeader>

        <div className="border-b border-[var(--line-soft)] px-5 py-4">
          <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_110px_auto]">
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Title"
              aria-label="TMDB title"
            />
            <Input
              type="number"
              min={1888}
              max={new Date().getFullYear() + 5}
              value={year}
              onChange={(event) => setYear(event.target.value)}
              placeholder="Year"
              aria-label="Release year"
            />
            <Button
              type="button"
              variant="outline"
              onClick={() => runSearch(query, year)}
              disabled={searchPending || !query.trim()}
            >
              {searchPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Search className="h-4 w-4" />
              )}
              Search
            </Button>
          </div>
        </div>

        <div className="thin-scrollbar max-h-[58vh] overflow-y-auto px-5 py-4">
          {searchPending && results.length === 0 ? (
            <div className="flex items-center justify-center gap-2 py-12 text-sm text-foreground/55">
              <Loader2 className="h-4 w-4 animate-spin" /> Searching TMDB...
            </div>
          ) : results.length === 0 ? (
            <div className="rounded-lg border border-[var(--line-soft)] bg-white/[0.035] p-5 text-sm text-foreground/58">
              No matches found. Adjust the title or year and search again.
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {results.map((result) => (
                <button
                  key={result.tmdbId}
                  type="button"
                  onClick={() => applyMatch(result.tmdbId)}
                  disabled={applyPending || searchPending}
                  className="grid min-h-32 grid-cols-[72px_minmax(0,1fr)] gap-3 rounded-lg border border-[var(--line-soft)] bg-white/[0.035] p-3 text-left transition-colors hover:border-primary/45 hover:bg-primary/[0.07] disabled:opacity-55"
                >
                  {result.posterUrl ? (
                    <img
                      src={result.posterUrl}
                      alt=""
                      className="aspect-[2/3] w-[72px] rounded-md object-cover"
                    />
                  ) : (
                    <div className="grid aspect-[2/3] w-[72px] place-items-center rounded-md bg-white/[0.055] text-[10px] text-foreground/40">
                      No art
                    </div>
                  )}
                  <span className="min-w-0">
                    <span className="block font-semibold text-foreground">{result.title}</span>
                    <span className="mt-0.5 block text-xs text-foreground/48">
                      {result.year ?? "Year unknown"} - TMDB {result.tmdbId}
                    </span>
                    {result.overview && (
                      <span className="mt-2 line-clamp-3 block text-xs leading-5 text-foreground/58">
                        {result.overview}
                      </span>
                    )}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
