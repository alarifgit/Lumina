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
  Plus,
  Trash2,
  Folder,
  HardDrive,
} from "lucide-react";
import {
  useStats,
  useScan,
  useBrowse,
  useMetadataSearch,
  useApplyMetadata,
  useSections,
  useCreateSection,
  useUpdateSection,
  useDeleteSection,
  useScanSection,
} from "@/lib/queries";
import { useToast } from "@/hooks/use-toast";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ScanResult, LibrarySectionInfo, MediaType } from "@/lib/types";
import { formatRuntime } from "@/lib/media-utils";
import { cn } from "@/lib/utils";

export function LibraryView() {
  const { data: stats, isLoading: statsLoading } = useStats();
  const { data: sections, isLoading: sectionsLoading } = useSections();
  const createSection = useCreateSection();
  const updateSection = useUpdateSection();
  const deleteSection = useDeleteSection();
  const scanSection = useScanSection();
  const scanAll = useScan();
  const metaSearch = useMetadataSearch();
  const applyMeta = useApplyMetadata();
  const list = useBrowse({ page: 1, pageSize: 100 });
  const { toast } = useToast();

  const [globalTmdbKey, setGlobalTmdbKey] = useState("");
  const [globalAutoMatch, setGlobalAutoMatch] = useState(true);
  const [allResult, setAllResult] = useState<ScanResult | null>(null);
  const [sectionResults, setSectionResults] = useState<Record<string, ScanResult>>({});
  const [fetchingId, setFetchingId] = useState<string | null>(null);

  // Add-section form state
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState("");
  const [newType, setNewType] = useState<MediaType>("MOVIE");
  const [newCategory, setNewCategory] = useState("default");
  const [newDir, setNewDir] = useState("");

  const onScanAll = async () => {
    setAllResult(null);
    try {
      const res = await scanAll.mutateAsync({
        tmdbKey: globalTmdbKey || undefined,
        autoMatch: globalAutoMatch,
      });
      setAllResult(res);
      toast({
        title: "Scan complete",
        description: `${res.added} added · ${res.updated} updated · ${res.scanned} scanned`,
      });
    } catch (e) {
      toast({ title: "Scan failed", description: (e as Error).message, variant: "destructive" });
    }
  };

  const onScanSection = async (s: LibrarySectionInfo) => {
    setSectionResults((p) => ({ ...p, [s.id]: { ...p[s.id], scanned: 0, added: 0, updated: 0, skipped: 0, errors: [], durationMs: 0, sectionId: s.id, sectionName: s.name } }));
    try {
      const res = await scanSection.mutateAsync({
        sectionId: s.id,
        tmdbKey: globalTmdbKey || undefined,
        autoMatch: globalAutoMatch,
      });
      setSectionResults((p) => ({ ...p, [s.id]: res }));
      toast({
        title: `${s.name} scanned`,
        description: `${res.added} added · ${res.updated} updated · ${res.scanned} scanned`,
      });
    } catch (e) {
      toast({ title: "Scan failed", description: (e as Error).message, variant: "destructive" });
    }
  };

  const onAddSection = async () => {
    if (!newName || !newDir) {
      toast({ title: "Missing fields", description: "Name and media directory are required." });
      return;
    }
    try {
      await createSection.mutateAsync({
        name: newName,
        type: newType,
        category: newCategory,
        mediaDir: newDir,
      });
      toast({ title: "Section added", description: `${newName} is ready to scan.` });
      setNewName("");
      setNewDir("");
      setNewType("MOVIE");
      setNewCategory("default");
      setShowAdd(false);
    } catch (e) {
      toast({ title: "Couldn't add section", description: (e as Error).message, variant: "destructive" });
    }
  };

  const onDeleteSection = async (s: LibrarySectionInfo) => {
    if (!confirm(`Delete section "${s.name}"? Its media will be kept but unlinked from this section.`)) return;
    try {
      await deleteSection.mutateAsync(s.id);
      toast({ title: "Section deleted", description: s.name });
    } catch (e) {
      toast({ title: "Couldn't delete", description: (e as Error).message, variant: "destructive" });
    }
  };

  const onFetchMetadata = async (mediaId: string, title: string, type: "MOVIE" | "TV") => {
    setFetchingId(mediaId);
    try {
      const { results } = await metaSearch.mutateAsync({ title, type });
      if (!results.length) {
        toast({ title: "No matches", description: `TMDB found no match for "${title}".` });
        return;
      }
      await applyMeta.mutateAsync({ mediaId, tmdbId: results[0].tmdbId, type });
      toast({ title: "Metadata updated", description: `Pulled details for "${title}".` });
    } catch (e) {
      toast({ title: "Couldn't fetch metadata", description: (e as Error).message, variant: "destructive" });
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
          Scan media in separate sections (TV, TV-Anime, Movies, Movies-Anime) with different mount points.
          Display stays unified — movies and anime movies appear together, same for TV.
        </p>
      </div>

      {/* stats */}
      <div className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <StatCard icon={Database} label="Titles" value={statsLoading ? "—" : String(stats?.mediaCount ?? 0)} />
        <StatCard icon={Film} label="Movies" value={statsLoading ? "—" : String(stats?.movieCount ?? 0)} />
        <StatCard icon={Tv} label="TV Shows" value={statsLoading ? "—" : String(stats?.tvCount ?? 0)} />
        <StatCard icon={Clapperboard} label="Episodes" value={statsLoading ? "—" : String(stats?.episodeCount ?? 0)} />
        <StatCard icon={Clock} label="Runtime" value={statsLoading ? "—" : `${(stats?.totalRuntimeHours ?? 0).toLocaleString()}h`} />
        <StatCard icon={ScanLine} label="Scans" value={statsLoading ? "—" : String(stats?.scanCount ?? 0)} />
      </div>

      {/* Sections */}
      <Card className="mb-8 p-5 sm:p-6">
        <div className="mb-4 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <FolderSearch className="h-5 w-5 text-primary" />
            <h2 className="text-lg font-semibold">Library Sections</h2>
          </div>
          <Button variant="outline" size="sm" onClick={() => setShowAdd((v) => !v)}>
            <Plus className="mr-1.5 h-4 w-4" /> Add Section
          </Button>
        </div>

        {showAdd && (
          <div className="mb-5 rounded-lg border border-border/60 bg-foreground/5 p-4">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-foreground/50">Name</label>
                <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. TV Shows (Anime)" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-foreground/50">Type</label>
                <Select value={newType} onValueChange={(v) => setNewType(v as MediaType)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="MOVIE">Movies</SelectItem>
                    <SelectItem value="TV">TV Shows</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-foreground/50">Category</label>
                <Select value={newCategory} onValueChange={setNewCategory}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="default">Default</SelectItem>
                    <SelectItem value="anime">Anime</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-foreground/50">Media directory</label>
                <Input value={newDir} onChange={(e) => setNewDir(e.target.value)} placeholder="/media/tv-anime" className="font-mono text-sm" />
              </div>
            </div>
            <div className="mt-3 flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setShowAdd(false)}>Cancel</Button>
              <Button size="sm" onClick={onAddSection} disabled={createSection.isPending}>
                {createSection.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Plus className="mr-1.5 h-4 w-4" />}
                Create
              </Button>
            </div>
          </div>
        )}

        {sectionsLoading ? (
          <div className="py-8 text-center text-foreground/50"><Loader2 className="mx-auto h-5 w-5 animate-spin" /></div>
        ) : sections && sections.length > 0 ? (
          <div className="space-y-3">
            {sections.map((s) => (
              <SectionCard
                key={s.id}
                section={s}
                scanning={scanSection.isPending && scanSection.variables?.sectionId === s.id}
                result={sectionResults[s.id]}
                onScan={() => onScanSection(s)}
                onDelete={() => onDeleteSection(s)}
                onUpdate={(mediaDir) => updateSection.mutate({ id: s.id, mediaDir })}
              />
            ))}
          </div>
        ) : (
          <div className="py-8 text-center text-sm text-foreground/50">
            No sections yet. Click “Add Section” to create your first scan root.
          </div>
        )}

        {/* global scan + TMDB key */}
        <div className="mt-5 border-t border-border/60 pt-5">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-foreground/50">TMDB API key (applies to all scans)</label>
              <Input
                type="password"
                value={globalTmdbKey}
                onChange={(e) => setGlobalTmdbKey(e.target.value)}
                placeholder="Get one free at themoviedb.org/settings/api"
                className="font-mono text-sm"
              />
            </div>
            <div className="flex items-end gap-3">
              <label className="flex items-center gap-2 text-sm text-foreground/70">
                <Checkbox checked={globalAutoMatch} onCheckedChange={(v) => setGlobalAutoMatch(!!v)} />
                Auto-match metadata
              </label>
              <Button onClick={onScanAll} disabled={scanAll.isPending} className="ml-auto">
                {scanAll.isPending ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Scanning…</> : <><RefreshCw className="mr-2 h-4 w-4" /> Scan All Sections</>}
              </Button>
            </div>
          </div>

          {allResult && (
            <div className="mt-4 rounded-lg border border-border/60 bg-foreground/5 p-4 text-sm">
              <div className="mb-2 flex items-center gap-2 font-semibold">
                <CheckCircle2 className="h-4 w-4 text-primary" />
                Scan finished in {(allResult.durationMs / 1000).toFixed(1)}s
              </div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <ResultStat label="Scanned" value={allResult.scanned} />
                <ResultStat label="Added" value={allResult.added} />
                <ResultStat label="Updated" value={allResult.updated} />
                <ResultStat label="Skipped" value={allResult.skipped} />
              </div>
              {allResult.errors.length > 0 && (
                <div className="mt-3">
                  <div className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-amber-500">
                    <AlertTriangle className="h-3.5 w-3.5" /> {allResult.errors.length} note(s)
                  </div>
                  <ul className="thin-scrollbar max-h-28 overflow-y-auto space-y-1 text-xs text-foreground/60">
                    {allResult.errors.slice(0, 20).map((e, i) => (
                      <li key={i} className="font-mono">{e}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
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
                <tr><td colSpan={7} className="px-5 py-10 text-center text-foreground/50"><Loader2 className="mx-auto h-5 w-5 animate-spin" /></td></tr>
              ) : items.length === 0 ? (
                <tr><td colSpan={7} className="px-5 py-10 text-center text-foreground/50">No media yet — scan a section above.</td></tr>
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
                          <Badge variant="secondary" className="gap-1"><CheckCircle2 className="h-3 w-3 text-primary" /> Enriched</Badge>
                        ) : (
                          <Badge variant="outline" className="gap-1 text-foreground/50"><AlertTriangle className="h-3 w-3" /> Stub</Badge>
                        )}
                      </td>
                      <td className="px-5 py-3 text-right">
                        <Button size="sm" variant="outline" disabled={fetchingId === m.id} onClick={() => onFetchMetadata(m.id, m.title, m.type)}>
                          {fetchingId === m.id ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Sparkles className="mr-1.5 h-3.5 w-3.5" />}
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

function SectionCard({
  section,
  scanning,
  result,
  onScan,
  onDelete,
  onUpdate,
}: {
  section: LibrarySectionInfo;
  scanning: boolean;
  result?: ScanResult;
  onScan: () => void;
  onDelete: () => void;
  onUpdate: (mediaDir: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [dir, setDir] = useState(section.mediaDir);

  const saveDir = () => {
    if (dir !== section.mediaDir) onUpdate(dir);
    setEditing(false);
  };

  return (
    <div className="rounded-lg border border-border/60 bg-foreground/3 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Folder className="h-4 w-4 text-primary" />
            <h3 className="font-semibold">{section.name}</h3>
            <Badge variant="secondary" className="text-[10px]">
              {section.type === "TV" ? "TV" : "Movies"}
            </Badge>
            {section.category === "anime" && (
              <Badge className="bg-primary/15 text-[10px] text-primary">Anime</Badge>
            )}
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-foreground/50">
            <span className="inline-flex items-center gap-1">
              <HardDrive className="h-3 w-3" />
              {editing ? (
                <span className="flex items-center gap-1">
                  <Input
                    value={dir}
                    onChange={(e) => setDir(e.target.value)}
                    className="h-6 w-48 font-mono text-xs"
                    onKeyDown={(e) => e.key === "Enter" && saveDir()}
                  />
                  <Button size="sm" variant="ghost" className="h-6 px-2" onClick={saveDir}>Save</Button>
                </span>
              ) : (
                <button
                  onClick={() => { setDir(section.mediaDir); setEditing(true); }}
                  className="font-mono hover:text-foreground"
                  title="Click to edit"
                >
                  {section.mediaDir}
                </button>
              )}
            </span>
            <span>{section.mediaCount} titles</span>
            <span>{section.scanCount} scans</span>
            {section.lastScan && <span>Last: {new Date(section.lastScan).toLocaleString()}</span>}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={onScan} disabled={scanning}>
            {scanning ? <><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> Scanning…</> : <><RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Scan</>}
          </Button>
          <Button size="sm" variant="ghost" onClick={onDelete} className="text-foreground/50 hover:text-destructive">
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>
      {result && (
        <div className="mt-3 rounded-md bg-background/50 p-2 text-xs">
          <div className="flex items-center gap-2 font-medium text-foreground/70">
            <CheckCircle2 className="h-3 w-3 text-primary" />
            {(result.durationMs / 1000).toFixed(1)}s · {result.scanned} scanned · {result.added} added · {result.updated} updated
          </div>
          {result.errors.length > 0 && (
            <div className="mt-1 text-amber-500/80">{result.errors.length} note(s)</div>
          )}
        </div>
      )}
    </div>
  );
}

function StatCard({ icon: Icon, label, value }: { icon: typeof Film; label: string; value: string }) {
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
