"use client";

import { useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Clapperboard,
  Clock,
  Cpu,
  Database,
  Film,
  FolderSearch,
  HardDrive,
  Loader2,
  Network,
  Plus,
  RefreshCw,
  ScanLine,
  Server,
  ShieldCheck,
  Sparkles,
  Trash2,
  Tv,
  Users,
  WandSparkles,
} from "lucide-react";
import {
  useApplyMetadata,
  useBrowse,
  useCreateSection,
  useDeleteSection,
  useMetadataSearch,
  usePlexSync,
  useSaveTmdbKey,
  useScan,
  useScanSection,
  useSections,
  useStats,
  useTestPlexConnection,
  useUpdateSection,
} from "@/lib/queries";
import { useToast } from "@/hooks/use-toast";
import { useMediaStore } from "@/store/media-store";
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
import type { LibrarySectionInfo, MediaType, PlexSyncDirection, PlexSyncResult, ScanResult } from "@/lib/types";
import { formatRuntime } from "@/lib/media-utils";
import { cn } from "@/lib/utils";

const SETTINGS_NAV = [
  { label: "Library Paths", icon: FolderSearch, href: "#library-paths" },
  { label: "Metadata Providers", icon: WandSparkles, href: "#metadata-providers" },
  { label: "Scanning & Indexing", icon: RefreshCw, href: "#scanning-and-indexing" },
  { label: "Plex Sync", icon: Server, href: "#plex-sync" },
  { label: "Playback & Transcoding", icon: Cpu, href: "#playback-and-transcoding" },
  { label: "Media Sources", icon: Database },
  { label: "Watch Folders", icon: ScanLine },
  { label: "Network Shares", icon: Network },
  { label: "Permissions", icon: ShieldCheck },
  { label: "Users & Access", icon: Users },
  { label: "Storage Health", icon: HardDrive },
];

export function LibraryView({ mode = "library" }: { mode?: "library" | "settings" }) {
  const isSettings = mode === "settings";
  const { data: stats, isLoading: statsLoading } = useStats();
  const { data: sections, isLoading: sectionsLoading } = useSections();
  const createSection = useCreateSection();
  const updateSection = useUpdateSection();
  const deleteSection = useDeleteSection();
  const scanSection = useScanSection();
  const scanAll = useScan();
  const metaSearch = useMetadataSearch();
  const applyMeta = useApplyMetadata();
  const saveTmdbKey = useSaveTmdbKey();
  const testPlex = useTestPlexConnection();
  const plexSync = usePlexSync();
  const { toast } = useToast();
  const sectionFilter = useMediaStore((s) => s.librarySectionFilter);
  const setLibrarySectionFilter = useMediaStore((s) => s.setLibrarySectionFilter);

  const [globalTmdbKey, setGlobalTmdbKey] = useState("");
  const [globalAutoMatch, setGlobalAutoMatch] = useState(true);
  const [allResult, setAllResult] = useState<ScanResult | null>(null);
  const [sectionResults, setSectionResults] = useState<Record<string, ScanResult>>({});
  const [fetchingId, setFetchingId] = useState<string | null>(null);
  const [inventoryType, setInventoryType] = useState<MediaType | "ALL">("MOVIE");
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState("");
  const [newType, setNewType] = useState<MediaType>("MOVIE");
  const [newCategory, setNewCategory] = useState("default");
  const [newDir, setNewDir] = useState("");
  const [plexUrl, setPlexUrl] = useState("");
  const [plexToken, setPlexToken] = useState("");
  const [plexDirection, setPlexDirection] = useState<PlexSyncDirection>("pull");
  const [plexResult, setPlexResult] = useState<PlexSyncResult | null>(null);

  const effectiveType = sectionFilter ? sectionFilter.type : inventoryType;
  const list = useBrowse({
    type: effectiveType === "ALL" ? undefined : effectiveType,
    sectionId: sectionFilter?.id,
    page: 1,
    pageSize: 100,
    sort: "title",
    enabled: !isSettings,
  });

  const onSaveTmdbKey = async () => {
    try {
      await saveTmdbKey.mutateAsync(globalTmdbKey);
      toast({
        title: "TMDB key saved",
        description: globalTmdbKey
          ? "This key will be used for all scans and metadata fetches."
          : "TMDB key cleared. Scans will run without metadata matching.",
      });
    } catch (e) {
      toast({ title: "Couldn't save key", description: (e as Error).message, variant: "destructive" });
    }
  };

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
    setSectionResults((p) => ({
      ...p,
      [s.id]: { scanned: 0, added: 0, updated: 0, skipped: 0, errors: [], durationMs: 0, sectionId: s.id, sectionName: s.name },
    }));
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

  const plexPayload = () => ({
    url: plexUrl || undefined,
    token: plexToken || undefined,
    direction: plexDirection,
  });

  const onTestPlex = async () => {
    try {
      const result = await testPlex.mutateAsync({ url: plexUrl || undefined, token: plexToken || undefined });
      setPlexResult(result);
      toast({
        title: "Plex connected",
        description: `${result.serverName ?? "Plex"} · ${result.sections ?? 0} library section(s) found.`,
      });
    } catch (e) {
      toast({ title: "Couldn't reach Plex", description: (e as Error).message, variant: "destructive" });
    }
  };

  const onPreviewPlexSync = async () => {
    try {
      const result = await plexSync.mutateAsync({ ...plexPayload(), apply: false });
      setPlexResult(result);
      toast({
        title: "Plex sync preview ready",
        description: `${result.markedLuminaWatched} Lumina update(s) · ${result.markedPlexWatched} Plex update(s).`,
      });
    } catch (e) {
      toast({ title: "Plex preview failed", description: (e as Error).message, variant: "destructive" });
    }
  };

  const onApplyPlexSync = async () => {
    try {
      const result = await plexSync.mutateAsync({ ...plexPayload(), apply: true });
      setPlexResult(result);
      toast({
        title: "Plex sync applied",
        description: `${result.markedLuminaWatched} marked watched in Lumina · ${result.markedPlexWatched} marked watched in Plex.`,
      });
    } catch (e) {
      toast({ title: "Plex sync failed", description: (e as Error).message, variant: "destructive" });
    }
  };

  const items = list.data?.items ?? [];
  const totalItems = list.data?.total ?? 0;
  const inventoryLabel =
    effectiveType === "MOVIE" ? "movies" : effectiveType === "TV" ? "TV shows" : "titles";

  return (
    <div className="lumina-page px-4 pb-10 pt-20 sm:px-6 lg:px-8">
      <PageHero isSettings={isSettings} stats={stats} />

      {!isSettings && (
        <>
          <StatsGrid stats={stats} loading={statsLoading} />
          <LibrarySectionOverview
            sections={sections}
            loading={sectionsLoading}
            onManage={(s) => setLibrarySectionFilter({ id: s.id, name: s.name, type: s.type })}
          />
          <InventoryTable
            items={items}
            totalItems={totalItems}
            inventoryLabel={inventoryLabel}
            isLoading={list.isLoading}
            sectionFilter={sectionFilter}
            inventoryType={inventoryType}
            setInventoryType={setInventoryType}
            clearSection={() => setLibrarySectionFilter(null)}
            onFetchMetadata={onFetchMetadata}
            fetchingId={fetchingId}
          />
        </>
      )}

      {isSettings && (
        <div className="grid gap-5 lg:grid-cols-[280px_minmax(0,1fr)]">
          <SettingsSidebar />
          <div className="min-w-0 space-y-5">
            <TranscodingPanel stats={stats} loading={statsLoading} />
            <LibraryPathsPanel
              sections={sections}
              loading={sectionsLoading}
              showAdd={showAdd}
              setShowAdd={setShowAdd}
              newName={newName}
              setNewName={setNewName}
              newType={newType}
              setNewType={setNewType}
              newCategory={newCategory}
              setNewCategory={setNewCategory}
              newDir={newDir}
              setNewDir={setNewDir}
              createPending={createSection.isPending}
              onAddSection={onAddSection}
              onScanSection={onScanSection}
              onManage={(s) => setLibrarySectionFilter({ id: s.id, name: s.name, type: s.type })}
              onDelete={onDeleteSection}
              onUpdate={(id, mediaDir) => updateSection.mutate({ id, mediaDir })}
              scanPending={scanSection.isPending}
              scanningId={scanSection.variables?.sectionId ?? null}
              results={sectionResults}
            />
            <ScanningPanel
              tmdbKey={globalTmdbKey}
              setTmdbKey={setGlobalTmdbKey}
              autoMatch={globalAutoMatch}
              setAutoMatch={setGlobalAutoMatch}
              saved={!!stats?.tmdbKey}
              savePending={saveTmdbKey.isPending}
              scanPending={scanAll.isPending}
              onSave={onSaveTmdbKey}
              onScanAll={onScanAll}
              result={allResult}
            />
            <PlexSyncPanel
              plexUrl={plexUrl}
              setPlexUrl={setPlexUrl}
              plexToken={plexToken}
              setPlexToken={setPlexToken}
              direction={plexDirection}
              setDirection={setPlexDirection}
              result={plexResult}
              busy={testPlex.isPending || plexSync.isPending}
              onTest={onTestPlex}
              onPreview={onPreviewPlexSync}
              onApply={onApplyPlexSync}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function PageHero({ isSettings, stats }: { isSettings: boolean; stats?: { mediaCount?: number } }) {
  return (
    <section className="lumina-panel film-grain relative mb-7 overflow-hidden rounded-xl p-5 sm:p-8">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_84%_0%,rgba(238,209,132,0.14),transparent_27%),radial-gradient(circle_at_16%_100%,rgba(12,26,45,0.82),transparent_42%)]" />
      <div className="relative max-w-3xl">
        <p className="label-eyebrow mb-2 text-primary/90">
          {isSettings ? "Server control room" : "Media inventory"}
        </p>
        <h1 className="lumina-title text-5xl font-semibold leading-none sm:text-7xl">
          {isSettings ? "Settings" : "Library"}
        </h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-foreground/68 sm:text-base">
          {isSettings
            ? "Configure paths, sources, watch folders, network shares, permissions, metadata, scanning, playback, and storage health."
            : `${(stats?.mediaCount ?? 0).toLocaleString()} scanned titles, organized for discovery and metadata care without exposing raw admin controls.`}
        </p>
      </div>
    </section>
  );
}

function StatsGrid({ stats, loading }: { stats?: any; loading: boolean }) {
  return (
    <div className="mb-7 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      <StatCard icon={Database} label="Titles" value={loading ? "-" : String(stats?.mediaCount ?? 0)} />
      <StatCard icon={Film} label="Movies" value={loading ? "-" : String(stats?.movieCount ?? 0)} />
      <StatCard icon={Tv} label="TV Shows" value={loading ? "-" : String(stats?.tvCount ?? 0)} />
      <StatCard icon={Clapperboard} label="Episodes" value={loading ? "-" : String(stats?.episodeCount ?? 0)} />
      <StatCard icon={Clock} label="Runtime" value={loading ? "-" : `${(stats?.totalRuntimeHours ?? 0).toLocaleString()}h`} />
      <StatCard icon={ScanLine} label="Scans" value={loading ? "-" : String(stats?.scanCount ?? 0)} />
    </div>
  );
}

function SettingsSidebar() {
  return (
    <aside className="lumina-panel sticky top-20 h-fit rounded-xl p-3">
      <div className="px-2 pb-3 pt-1">
        <p className="label-eyebrow text-primary/90">Configuration</p>
      </div>
      <nav className="space-y-1" aria-label="Settings sections">
        {SETTINGS_NAV.map((item, index) => {
          const Icon = item.icon;
          const className = cn(
            "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-semibold transition-colors",
            item.href
              ? index === 0
                ? "bg-primary/12 text-primary ring-1 ring-primary/25"
                : "text-foreground/68 hover:bg-white/[0.055] hover:text-foreground"
              : "cursor-not-allowed text-foreground/34"
          );
          const content = (
            <>
              <Icon className="h-4 w-4" />
              <span className="min-w-0 flex-1">{item.label}</span>
              {!item.href && (
                <span className="rounded border border-white/10 px-1.5 py-0.5 text-[9px] uppercase tracking-[0.1em] text-foreground/35">
                  Later
                </span>
              )}
            </>
          );
          return item.href ? (
            <a key={item.label} href={item.href} className={className}>
              {content}
            </a>
          ) : (
            <div key={item.label} className={className} aria-disabled="true">
              {content}
            </div>
          );
        })}
      </nav>
    </aside>
  );
}

function TranscodingPanel({ stats, loading }: { stats?: any; loading: boolean }) {
  return (
    <Card id="playback-and-transcoding" className="p-5 sm:p-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-start gap-3">
          <div className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">
            <Cpu className="h-5 w-5" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="lumina-title text-2xl font-semibold">Playback & transcoding</h2>
              <Badge variant={stats?.transcodeHardware ? "default" : "secondary"}>
                {loading
                  ? "Checking"
                  : !stats?.transcodeAvailable
                    ? "Unavailable"
                    : stats?.transcodeHardware
                      ? "Hardware active"
                      : "CPU fallback"}
              </Badge>
            </div>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-foreground/58">
              {loading
                ? "Checking ffmpeg encoder support."
                : !stats?.transcodeAvailable
                  ? "Lumina cannot transcode yet because ffmpeg is not available. Direct-play files can still stream normally."
                  : stats?.transcodeHardware
                    ? `Lumina is using ${stats.transcodeEncoder} for H.264 transcodes.`
                    : `Lumina is using ${stats?.transcodeEncoder ?? "CPU transcoding"}. Direct play remains preferred when the browser can handle the file.`}
            </p>
            {!loading && stats?.transcodeReason && (
              <p className="mt-2 max-w-3xl rounded-lg border border-amber-500/18 bg-amber-500/8 px-3 py-2 text-xs leading-5 text-amber-200/78">
                {stats.transcodeReason}
              </p>
            )}
          </div>
        </div>
        <div className="rounded-lg border border-border/60 bg-background/45 px-4 py-3 text-sm">
          <div className="text-xs uppercase tracking-[0.12em] text-foreground/42">Active encoder</div>
          <div className="mt-1 font-mono text-foreground/86">
            {loading ? "detecting" : stats?.transcodeEncoderKey ?? "libx264"}
          </div>
        </div>
      </div>
    </Card>
  );
}

function LibraryPathsPanel({
  sections,
  loading,
  showAdd,
  setShowAdd,
  newName,
  setNewName,
  newType,
  setNewType,
  newCategory,
  setNewCategory,
  newDir,
  setNewDir,
  createPending,
  onAddSection,
  onScanSection,
  onManage,
  onDelete,
  onUpdate,
  scanPending,
  scanningId,
  results,
}: {
  sections?: LibrarySectionInfo[];
  loading: boolean;
  showAdd: boolean;
  setShowAdd: (show: boolean) => void;
  newName: string;
  setNewName: (value: string) => void;
  newType: MediaType;
  setNewType: (value: MediaType) => void;
  newCategory: string;
  setNewCategory: (value: string) => void;
  newDir: string;
  setNewDir: (value: string) => void;
  createPending: boolean;
  onAddSection: () => void;
  onScanSection: (section: LibrarySectionInfo) => void;
  onManage: (section: LibrarySectionInfo) => void;
  onDelete: (section: LibrarySectionInfo) => void;
  onUpdate: (id: string, mediaDir: string) => void;
  scanPending: boolean;
  scanningId: string | null;
  results: Record<string, ScanResult>;
}) {
  return (
    <Card id="library-paths" className="overflow-hidden p-0">
      <div className="flex flex-col gap-3 border-b border-border/60 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="label-eyebrow mb-1 text-primary/90">Library Paths</p>
          <h2 className="lumina-title text-3xl font-semibold">Media access roots</h2>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setShowAdd(!showAdd)}>
            <Plus className="h-4 w-4" /> Add Library
          </Button>
        </div>
      </div>

      {showAdd && (
        <div className="border-b border-border/60 bg-white/[0.035] p-5">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Name">
              <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Movies" />
            </Field>
            <Field label="Type">
              <Select value={newType} onValueChange={(v) => setNewType(v as MediaType)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="MOVIE">Movies</SelectItem>
                  <SelectItem value="TV">TV Shows</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="Source group">
              <Select value={newCategory} onValueChange={setNewCategory}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="default">Default</SelectItem>
                  <SelectItem value="anime">Anime</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="Path">
              <Input value={newDir} onChange={(e) => setNewDir(e.target.value)} placeholder="/mnt/Media/Movies" className="font-mono text-sm" />
            </Field>
          </div>
          <div className="mt-3 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setShowAdd(false)}>Cancel</Button>
            <Button onClick={onAddSection} disabled={createPending}>
              {createPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              Create
            </Button>
          </div>
        </div>
      )}

      <div className="thin-scrollbar overflow-x-auto">
        <table className="w-full min-w-[780px] text-sm">
          <thead className="border-b border-border/60 text-left text-xs uppercase tracking-[0.12em] text-foreground/48">
            <tr>
              <th className="px-5 py-3 font-semibold">Name</th>
              <th className="px-3 py-3 font-semibold">Type</th>
              <th className="px-3 py-3 font-semibold">Path</th>
              <th className="px-3 py-3 font-semibold">Status</th>
              <th className="px-3 py-3 font-semibold">Items</th>
              <th className="px-5 py-3 text-right font-semibold">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className="px-5 py-10 text-center text-foreground/50"><Loader2 className="mx-auto h-5 w-5 animate-spin" /></td></tr>
            ) : sections?.length ? (
              sections.map((section) => (
                <LibraryPathRow
                  key={section.id}
                  section={section}
                  scanning={scanPending && scanningId === section.id}
                  result={results[section.id]}
                  onScan={() => onScanSection(section)}
                  onManage={() => onManage(section)}
                  onDelete={() => onDelete(section)}
                  onUpdate={(mediaDir) => onUpdate(section.id, mediaDir)}
                />
              ))
            ) : (
              <tr><td colSpan={6} className="px-5 py-10 text-center text-foreground/50">No library paths yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function ScanningPanel({
  tmdbKey,
  setTmdbKey,
  autoMatch,
  setAutoMatch,
  saved,
  savePending,
  scanPending,
  onSave,
  onScanAll,
  result,
}: {
  tmdbKey: string;
  setTmdbKey: (value: string) => void;
  autoMatch: boolean;
  setAutoMatch: (value: boolean) => void;
  saved: boolean;
  savePending: boolean;
  scanPending: boolean;
  onSave: () => void;
  onScanAll: () => void;
  result: ScanResult | null;
}) {
  return (
    <Card id="metadata-providers" className="p-5 sm:p-6">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="label-eyebrow mb-1 text-primary/90">Metadata Providers</p>
          <h2 className="lumina-title text-3xl font-semibold">TMDB matching</h2>
          <p className="mt-1 text-sm text-foreground/56">
            Save a global key, then scan libraries to match new titles and refresh matched titles
            that are missing posters, backdrops, ratings, or overview text.
          </p>
        </div>
        <Button onClick={onScanAll} disabled={scanPending}>
          {scanPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          Scan & refresh all
        </Button>
      </div>
      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_280px]" id="scanning-and-indexing">
        <Field label="TMDB API key">
          <div className="flex gap-2">
            <Input
              type="password"
              value={tmdbKey}
              onChange={(e) => setTmdbKey(e.target.value)}
              placeholder="Get one free at themoviedb.org/settings/api"
              className="font-mono text-sm"
            />
            <Button variant="outline" onClick={onSave} disabled={savePending}>
              {savePending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Save
            </Button>
          </div>
          {saved && (
            <span className="mt-2 inline-flex items-center gap-1 text-xs text-primary">
              <CheckCircle2 className="h-3 w-3" /> Saved for all scans
            </span>
          )}
        </Field>
        <label className="flex items-center gap-3 rounded-xl border border-border/60 bg-white/[0.035] p-4 text-sm text-foreground/72">
          <Checkbox checked={autoMatch} onCheckedChange={(v) => setAutoMatch(!!v)} />
          Match new titles and refresh incomplete matches during scans
        </label>
      </div>
      {result && (
        <div className="mt-4 rounded-xl border border-border/60 bg-background/45 p-4 text-sm">
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
            <p className="mt-3 text-xs text-amber-200/78">{result.errors.length} scan note(s) recorded.</p>
          )}
        </div>
      )}
    </Card>
  );
}

function PlexSyncPanel({
  plexUrl,
  setPlexUrl,
  plexToken,
  setPlexToken,
  direction,
  setDirection,
  result,
  busy,
  onTest,
  onPreview,
  onApply,
}: {
  plexUrl: string;
  setPlexUrl: (value: string) => void;
  plexToken: string;
  setPlexToken: (value: string) => void;
  direction: PlexSyncDirection;
  setDirection: (value: PlexSyncDirection) => void;
  result: PlexSyncResult | null;
  busy: boolean;
  onTest: () => void;
  onPreview: () => void;
  onApply: () => void;
}) {
  const pendingChanges = (result?.markedLuminaWatched ?? 0) + (result?.markedPlexWatched ?? 0);
  return (
    <Card id="plex-sync" className="p-5 sm:p-6">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="label-eyebrow mb-1 text-primary/90">Plex Sync</p>
          <h2 className="lumina-title text-3xl font-semibold">Watched history import</h2>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-foreground/56">
            Preview watched-state changes from Plex before applying them. Two-way mode is additive:
            it can mark items watched on either side, but it never marks anything unwatched.
          </p>
        </div>
        <Badge variant="secondary">Preview first</Badge>
      </div>

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_220px]">
        <Field label="Plex server URL">
          <Input
            value={plexUrl}
            onChange={(e) => setPlexUrl(e.target.value)}
            placeholder="http://192.168.1.10:32400"
            className="font-mono text-sm"
          />
          <p className="mt-1 text-xs text-foreground/42">Leave blank to use PLEX_URL or LUMINA_PLEX_URL.</p>
        </Field>
        <Field label="Plex token">
          <Input
            type="password"
            value={plexToken}
            onChange={(e) => setPlexToken(e.target.value)}
            placeholder="Token from your Plex server"
            className="font-mono text-sm"
          />
          <p className="mt-1 text-xs text-foreground/42">Leave blank to use PLEX_TOKEN or LUMINA_PLEX_TOKEN.</p>
        </Field>
        <Field label="Direction">
          <Select value={direction} onValueChange={(v) => setDirection(v as PlexSyncDirection)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="pull">Plex to Lumina</SelectItem>
              <SelectItem value="two-way">Two-way watched</SelectItem>
              <SelectItem value="push">Lumina to Plex</SelectItem>
            </SelectContent>
          </Select>
        </Field>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <Button variant="outline" onClick={onTest} disabled={busy}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Server className="h-4 w-4" />}
          Test
        </Button>
        <Button variant="outline" onClick={onPreview} disabled={busy}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ScanLine className="h-4 w-4" />}
          Preview
        </Button>
        <Button onClick={onApply} disabled={busy || !result || result.mode === "test" || pendingChanges === 0}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
          Apply watched sync
        </Button>
      </div>

      {result && (
        <div className="mt-5 rounded-xl border border-border/60 bg-background/45 p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="font-semibold">
                {result.serverName ?? "Plex"} {result.mode === "test" ? "connection" : "sync report"}
              </div>
              <div className="mt-1 text-xs text-foreground/48">
                {result.scanned.toLocaleString()} Plex item(s) scanned · {result.matched.toLocaleString()} matched · {result.unmatched.toLocaleString()} unmatched
              </div>
            </div>
            <Badge variant={pendingChanges > 0 ? "default" : "secondary"}>
              {pendingChanges.toLocaleString()} change(s)
            </Badge>
          </div>

          <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
            <ResultStat label="Lumina" value={result.markedLuminaWatched} />
            <ResultStat label="Plex" value={result.markedPlexWatched} />
            <ResultStat label="Synced" value={result.alreadySynced} />
            <ResultStat label="Skipped" value={result.skipped} />
            <ResultStat label="Unmatched" value={result.unmatched} />
          </div>

          {result.errors.length > 0 && (
            <p className="mt-3 rounded-lg border border-amber-500/18 bg-amber-500/8 px-3 py-2 text-xs leading-5 text-amber-200/78">
              {result.errors.length} Plex note(s): {result.errors.slice(0, 2).join(" · ")}
            </p>
          )}

          {result.items.length > 0 && (
            <div className="thin-scrollbar mt-4 max-h-72 overflow-auto rounded-lg border border-border/50">
              <table className="w-full min-w-[720px] text-sm">
                <thead className="border-b border-border/50 text-left text-xs uppercase tracking-[0.12em] text-foreground/45">
                  <tr>
                    <th className="px-3 py-2 font-semibold">Title</th>
                    <th className="px-3 py-2 font-semibold">Item</th>
                    <th className="px-3 py-2 font-semibold">Plex</th>
                    <th className="px-3 py-2 font-semibold">Lumina</th>
                    <th className="px-3 py-2 font-semibold">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {result.items.map((item, index) => (
                    <tr key={`${item.plexRatingKey ?? item.title}-${index}`} className="border-b border-border/35 last:border-0">
                      <td className="px-3 py-2 font-medium">{item.title}</td>
                      <td className="px-3 py-2 text-foreground/62">
                        {item.type === "TV" && item.seasonNumber != null && item.episodeNumber != null
                          ? `S${item.seasonNumber} E${item.episodeNumber}`
                          : item.year ?? "Movie"}
                      </td>
                      <td className="px-3 py-2 text-foreground/62">{item.plexWatched ? "Watched" : "Unwatched"}</td>
                      <td className="px-3 py-2 text-foreground/62">
                        {item.luminaWatched == null ? "No match" : item.luminaWatched ? "Watched" : "Unwatched"}
                      </td>
                      <td className="px-3 py-2">
                        <Badge variant={item.action === "unmatched" ? "outline" : item.action === "already-synced" ? "secondary" : "default"}>
                          {item.action === "mark-lumina-watched"
                            ? "Mark Lumina"
                            : item.action === "mark-plex-watched"
                              ? "Mark Plex"
                              : item.action === "already-synced"
                                ? "Synced"
                                : item.action === "unmatched"
                                  ? "Unmatched"
                                  : "Skip"}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

function LibrarySectionOverview({
  sections,
  loading,
  onManage,
}: {
  sections?: LibrarySectionInfo[];
  loading: boolean;
  onManage: (section: LibrarySectionInfo) => void;
}) {
  return (
    <section className="mb-7">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="lumina-title text-2xl font-semibold sm:text-3xl">Library sections</h2>
      </div>
      {loading ? (
        <div className="lumina-panel rounded-xl p-8 text-center text-foreground/50"><Loader2 className="mx-auto h-5 w-5 animate-spin" /></div>
      ) : sections?.length ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {sections.map((s) => (
            <button key={s.id} onClick={() => onManage(s)} className="lumina-panel rounded-xl p-4 text-left transition-all hover:-translate-y-0.5 hover:border-primary/40">
              <div className="mb-4 flex items-center justify-between gap-2">
                <div className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-primary/12 text-primary">
                  {s.type === "TV" ? <Tv className="h-5 w-5" /> : <Film className="h-5 w-5" />}
                </div>
                <Badge variant="secondary">{s.category === "anime" ? "Anime" : s.type === "TV" ? "TV" : "Movies"}</Badge>
              </div>
              <div className="text-lg font-semibold">{s.name}</div>
              <div className="mt-1 text-sm text-foreground/54">{s.mediaCount.toLocaleString()} titles</div>
              <div className="mt-3 text-xs text-foreground/42">{s.lastScan ? `Last scan ${new Date(s.lastScan).toLocaleDateString()}` : "Not scanned yet"}</div>
            </button>
          ))}
        </div>
      ) : (
        <div className="lumina-panel rounded-xl p-8 text-center text-sm text-foreground/54">Add library paths in Settings to begin building this overview.</div>
      )}
    </section>
  );
}

function InventoryTable({
  items,
  totalItems,
  inventoryLabel,
  isLoading,
  sectionFilter,
  inventoryType,
  setInventoryType,
  clearSection,
  onFetchMetadata,
  fetchingId,
}: {
  items: any[];
  totalItems: number;
  inventoryLabel: string;
  isLoading: boolean;
  sectionFilter: { id: string; name: string; type: MediaType } | null;
  inventoryType: MediaType | "ALL";
  setInventoryType: (value: MediaType | "ALL") => void;
  clearSection: () => void;
  onFetchMetadata: (mediaId: string, title: string, type: "MOVIE" | "TV") => void;
  fetchingId: string | null;
}) {
  return (
    <Card className="overflow-hidden p-0">
      <div className="flex flex-col gap-4 border-b border-border/60 p-5 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h2 className="lumina-title text-2xl font-semibold">Media inventory</h2>
          <p className="mt-1 text-sm text-foreground/50">
            {sectionFilter
              ? `${sectionFilter.name}: ${totalItems.toLocaleString()} ${inventoryLabel} found. Showing ${items.length.toLocaleString()}.`
              : `${totalItems.toLocaleString()} ${inventoryLabel} found. Showing ${items.length.toLocaleString()}.`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {sectionFilter && <Button variant="outline" onClick={clearSection}>All Library</Button>}
          {!sectionFilter && (["MOVIE", "TV", "ALL"] as const).map((type) => (
            <Button
              key={type}
              variant={inventoryType === type ? "default" : "outline"}
              onClick={() => setInventoryType(type)}
            >
              {type === "MOVIE" ? "Movies" : type === "TV" ? "TV Shows" : "All"}
            </Button>
          ))}
          <Badge variant="secondary">{items.length} shown</Badge>
        </div>
      </div>
      <div className="thin-scrollbar max-h-[68vh] overflow-auto">
        <table className="w-full min-w-[760px] text-sm">
          <thead className="border-b border-border/60 text-left text-xs uppercase tracking-[0.12em] text-foreground/50">
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
            {isLoading ? (
              <tr><td colSpan={7} className="px-5 py-10 text-center text-foreground/50"><Loader2 className="mx-auto h-5 w-5 animate-spin" /></td></tr>
            ) : items.length === 0 ? (
              <tr><td colSpan={7} className="px-5 py-10 text-center text-foreground/50">No media yet. Add and scan folders from Settings.</td></tr>
            ) : (
              items.map((m) => {
                const hasMeta = !!m.overview || !!m.rating;
                return (
                  <tr key={m.id} className="border-b border-border/40 last:border-0 hover:bg-foreground/5">
                    <td className="px-5 py-3 font-medium">{m.title}</td>
                    <td className="px-3 py-3 text-foreground/70">{m.type === "TV" ? "TV" : "Movie"}</td>
                    <td className="px-3 py-3 text-foreground/70">{m.year ?? "-"}</td>
                    <td className="px-3 py-3 text-foreground/70">{m.rating?.toFixed(1) ?? "-"}</td>
                    <td className="px-3 py-3 text-foreground/70">{m.runtime ? formatRuntime(m.runtime) : "-"}</td>
                    <td className="px-3 py-3">
                      {hasMeta ? (
                        <Badge variant="secondary" className="gap-1"><CheckCircle2 className="h-3 w-3 text-primary" /> Enriched</Badge>
                      ) : (
                        <Badge variant="outline" className="gap-1 text-foreground/50"><AlertTriangle className="h-3 w-3" /> Stub</Badge>
                      )}
                    </td>
                    <td className="px-5 py-3 text-right">
                      <Button variant="outline" disabled={fetchingId === m.id} onClick={() => onFetchMetadata(m.id, m.title, m.type)}>
                        {fetchingId === m.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
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
  );
}

function LibraryPathRow({
  section,
  scanning,
  result,
  onScan,
  onManage,
  onDelete,
  onUpdate,
}: {
  section: LibrarySectionInfo;
  scanning: boolean;
  result?: ScanResult;
  onScan: () => void;
  onManage: () => void;
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
    <tr className="border-b border-border/40 last:border-0 align-top hover:bg-foreground/5">
      <td className="px-5 py-3 font-semibold">{section.name}</td>
      <td className="px-3 py-3"><Badge variant="secondary">{section.type === "TV" ? "TV Shows" : "Movies"}</Badge></td>
      <td className="px-3 py-3">
        {editing ? (
          <div className="flex min-w-80 gap-2">
            <Input value={dir} onChange={(e) => setDir(e.target.value)} onKeyDown={(e) => e.key === "Enter" && saveDir()} className="h-8 font-mono text-xs" />
            <Button variant="outline" onClick={saveDir}>Save</Button>
          </div>
        ) : (
          <button onClick={() => { setDir(section.mediaDir); setEditing(true); }} className="max-w-[360px] truncate font-mono text-xs text-foreground/62 hover:text-foreground" title="Click to edit">
            {section.mediaDir}
          </button>
        )}
      </td>
      <td className="px-3 py-3">
        <span className="inline-flex items-center gap-1.5 text-xs text-[var(--success)]">
          <CheckCircle2 className="h-3.5 w-3.5" /> Active
        </span>
        {result && <div className="mt-1 text-[11px] text-foreground/46">{result.added} added · {result.updated} updated</div>}
      </td>
      <td className="px-3 py-3 text-foreground/70 tabular-nums">{section.mediaCount.toLocaleString()}</td>
      <td className="px-5 py-3">
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onManage}>Manage</Button>
          <Button onClick={onScan} disabled={scanning}>
            {scanning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            Scan
          </Button>
          <Button variant="ghost" onClick={onDelete} className="text-foreground/50 hover:text-destructive">
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </td>
    </tr>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold uppercase tracking-[0.12em] text-foreground/50">{label}</span>
      {children}
    </label>
  );
}

function StatCard({ icon: Icon, label, value }: { icon: typeof Film; label: string; value: string }) {
  return (
    <Card className="p-4">
      <div className="mb-2 inline-flex h-9 w-9 items-center justify-center rounded-full bg-primary/15 text-primary">
        <Icon className="h-5 w-5" />
      </div>
      <div className="text-2xl font-black tabular-nums">{value}</div>
      <div className="text-xs text-foreground/50">{label}</div>
    </Card>
  );
}

function ResultStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg bg-background/50 p-2">
      <div className="text-lg font-bold tabular-nums">{value}</div>
      <div className="text-xs text-foreground/50">{label}</div>
    </div>
  );
}
