"use client";

import { useState } from "react";
import {
  FolderSearch,
  Film,
  Tv,
  Clapperboard,
  Clock,
  Database,
  RefreshCw,
  Sparkles,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  ScanLine,
} from "lucide-react";
import { useStats, useScan, useBrowse, useMetadataSearch, useApplyMetadata } from "@/lib/queries";
import { useToast } from "@/hooks/use-toast";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import type { ScanResult } from "@/lib/types";
import { formatRuntime } from "@/lib/media-utils";

export function LibraryView() {
  const { data: stats, isLoading: statsLoading } = useStats();
  const scan = useScan();
  const metaSearch = useMetadataSearch();
  const applyMeta = useApplyMetadata();
  const list = useBrowse({ page: 1, pageSize: 100 });
  const { toast } = useToast();

  const [mediaDir, setMediaDir] = useState("");
  const [tmdbKey, setTmdbKey] = useState("");
  const [autoMatch, setAutoMatch] = useState(true);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [fetchingId, setFetchingId] = useState<string | null>(null);

  const dir = mediaDir || stats?.mediaDir || "/media";

  const onScan = async () => {
    setResult(null);
    try {
      const res = await scan.mutateAsync({
        mediaDir: dir,
        tmdbKey: tmdbKey || undefined,
        autoMatch,
      });
      setResult(res);
      toast({
        title: "Scan complete",
        description: `${res.added} added · ${res.updated} updated · ${res.scanned} scanned`,
      });
    } catch (e) {
      toast({ title: "Scan failed", description: (e as Error).message, variant: "destructive" });
    }
  };

  const onFetchMetadata = async (mediaId: string, title: string, type: "MOVIE" | "TV") => {
    setFetchingId(mediaId);
    try {
      const { results } = await metaSearch.mutateAsync({ title, type });
      if (!results.length) {
        toast({ title: "No matches", description: `TMDB found no match for “${title}”.` });
        return;
      }
      await applyMeta.mutateAsync({ mediaId, tmdbId: results[0].tmdbId, type });
      toast({
        title: "Metadata updated",
        description: `Pulled details for “${title}”.`,
      });
    } catch (e) {
      toast({
        title: "Couldn’t fetch metadata",
        description: (e as Error).message,
        variant: "destructive",
      });
    } finally {
      setFetchingId(null);
    }
  };

  const items = list.data?.items ?? [];

  return (
    <div className="px-4 pb-10 pt-20 sm:px-6 lg:px-8">
      <div className="mb-6">
        <h1 className="text-2xl font-black tracking-tight sm:text-3xl">Library</h1>
        <p className="mt-1 text-sm text-foreground/50">
          Point Lumina at your media, scan it in, and enrich it with metadata from TMDB.
        </p>
      </div>

      {/* stats */}
      <div className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <StatCard icon={Database} label="Titles" value={statsLoading ? "—" : String(stats?.mediaCount ?? 0)} />
        <StatCard icon={Film} label="Movies" value={statsLoading ? "—" : String(stats?.movieCount ?? 0)} />
        <StatCard icon={Tv} label="TV Shows" value={statsLoading ? "—" : String(stats?.tvCount ?? 0)} />
        <StatCard icon={Clapperboard} label="Episodes" value={statsLoading ? "—" : String(stats?.episodeCount ?? 0)} />
        <StatCard
          icon={Clock}
          label="Runtime"
          value={statsLoading ? "—" : `${(stats?.totalRuntimeHours ?? 0).toLocaleString()}h`}
        />
        <StatCard
          icon={ScanLine}
          label="Scans"
          value={statsLoading ? "—" : String(stats?.scanCount ?? 0)}
        />
      </div>

      {/* scan card */}
      <Card className="mb-8 p-5 sm:p-6">
        <div className="mb-4 flex items-center gap-2">
          <FolderSearch className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-semibold">Scan your media directory</h2>
        </div>
        <p className="mb-4 text-sm text-foreground/60">
          Lumina reads your mounted folder and detects movies and TV shows automatically.
          Add a TMDB API key to pull posters, overviews, ratings, and episode data from the web.
        </p>

        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-foreground/50">
              Media directory
            </label>
            <Input
              value={dir}
              onChange={(e) => setMediaDir(e.target.value)}
              placeholder="/media"
              className="font-mono text-sm"
            />
            <p className="mt-1 text-xs text-foreground/40">
              Mount your host folder here (e.g. Docker volume <code>-v /mnt/media:/media</code>).
            </p>
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-foreground/50">
              TMDB API key (optional)
            </label>
            <Input
              type="password"
              value={tmdbKey}
              onChange={(e) => setTmdbKey(e.target.value)}
              placeholder="Get one free at themoviedb.org/settings/api"
              className="font-mono text-sm"
            />
            <p className="mt-1 text-xs text-foreground/40">
              Used to fetch rich metadata & artwork from the web.
            </p>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-2 text-sm text-foreground/70">
            <Checkbox checked={autoMatch} onCheckedChange={(v) => setAutoMatch(!!v)} />
            Auto-match metadata during scan
          </label>
          <Button onClick={onScan} disabled={scan.isPending} className="ml-auto">
            {scan.isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Scanning…
              </>
            ) : (
              <>
                <RefreshCw className="mr-2 h-4 w-4" /> Scan Library
              </>
            )}
          </Button>
        </div>

        {result && (
          <div className="mt-5 rounded-lg border border-border/60 bg-foreground/5 p-4 text-sm">
            <div className="mb-2 flex items-center gap-2 font-semibold">
              <CheckCircle2 className="h-4 w-4 text-primary" />
              Scan finished in {(result.durationMs / 1000).toFixed(1)}s
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <ResultStat label="Scanned" value={result.scanned} />
              <ResultStat label="Added" value={result.added} />
              <ResultStat label="Updated" value={result.updated} />
              <ResultStat label="Skipped" value={result.skipped} />
            </div>
            {result.errors.length > 0 && (
              <div className="mt-3">
                <div className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-amber-500">
                  <AlertTriangle className="h-3.5 w-3.5" /> {result.errors.length} note(s)
                </div>
                <ul className="thin-scrollbar max-h-28 overflow-y-auto space-y-1 text-xs text-foreground/60">
                  {result.errors.slice(0, 20).map((e, i) => (
                    <li key={i} className="font-mono">
                      {e}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </Card>

      {/* media table */}
      <Card className="overflow-hidden p-0">
        <div className="flex items-center justify-between border-b border-border/60 p-5">
          <h2 className="text-lg font-semibold">All Media</h2>
          <Badge variant="secondary">{items.length} shown</Badge>
        </div>
        <div className="thin-scrollbar overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-border/60 text-left text-xs uppercase tracking-wide text-foreground/50">
              <tr>
                <th className="px-5 py-3 font-semibold">Title</th>
                <th className="px-3 py-3 font-semibold">Type</th>
                <th className="px-3 py-3 font-semibold">Year</th>
                <th className="px-3 py-3 font-semibold">Rating</th>
                <th className="px-3 py-3 font-semibold">Runtime</th>
                <th className="px-3 py-3 font-semibold">Metadata</th>
                <th className="px-5 py-3 text-right font-semibold">Action</th>
              </tr>
            </thead>
            <tbody>
              {list.isLoading ? (
                <tr>
                  <td colSpan={7} className="px-5 py-10 text-center text-foreground/50">
                    <Loader2 className="mx-auto h-5 w-5 animate-spin" />
                  </td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-5 py-10 text-center text-foreground/50">
                    No media yet — scan your directory above.
                  </td>
                </tr>
              ) : (
                items.map((m) => {
                  const hasMeta = !!m.overview || !!m.rating;
                  return (
                    <tr key={m.id} className="border-b border-border/40 last:border-0 hover:bg-foreground/5">
                      <td className="px-5 py-3 font-medium">{m.title}</td>
                      <td className="px-3 py-3 text-foreground/70">{m.type === "TV" ? "TV" : "Movie"}</td>
                      <td className="px-3 py-3 text-foreground/70">{m.year ?? "—"}</td>
                      <td className="px-3 py-3 text-foreground/70">{m.rating?.toFixed(1) ?? "—"}</td>
                      <td className="px-3 py-3 text-foreground/70">{m.runtime ? formatRuntime(m.runtime) : "—"}</td>
                      <td className="px-3 py-3">
                        {hasMeta ? (
                          <Badge variant="secondary" className="gap-1">
                            <CheckCircle2 className="h-3 w-3 text-primary" /> Enriched
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="gap-1 text-foreground/50">
                            <AlertTriangle className="h-3 w-3" /> Stub
                          </Badge>
                        )}
                      </td>
                      <td className="px-5 py-3 text-right">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={fetchingId === m.id}
                          onClick={() => onFetchMetadata(m.id, m.title, m.type)}
                        >
                          {fetchingId === m.id ? (
                            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Sparkles className="mr-1.5 h-3.5 w-3.5" />
                          )}
                          Fetch
                        </Button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Film;
  label: string;
  value: string;
}) {
  return (
    <Card className="p-4">
      <div className="mb-2 inline-flex h-9 w-9 items-center justify-center rounded-lg bg-primary/15 text-primary">
        <Icon className="h-5 w-5" />
      </div>
      <div className="text-2xl font-black tracking-tight">{value}</div>
      <div className="text-xs text-foreground/50">{label}</div>
    </Card>
  );
}

function ResultStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md bg-background/50 p-2">
      <div className="text-lg font-bold">{value}</div>
      <div className="text-xs text-foreground/50">{label}</div>
    </div>
  );
}
