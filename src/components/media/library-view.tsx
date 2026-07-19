"use client";

import { useDeferredValue, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Clapperboard,
  Clock,
  Cpu,
  Database,
  Film,
  FolderSearch,
  Library,
  Loader2,
  Plus,
  RefreshCw,
  ScanLine,
  Search,
  Server,
  Sparkles,
  Trash2,
  Tv,
  WandSparkles,
  X,
} from "lucide-react";
import {
  useApplyMetadata,
  useBrowseInfinite,
  useCreateSection,
  useDeleteSection,
  useLibraryConfig,
  useMetadataSearch,
  usePlexSync,
  useSaveLibraryConfig,
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
import { splitTrailingReleaseYear } from "@/lib/title-parser";
import { cn } from "@/lib/utils";

const SETTINGS_NAV = [
  { label: "Media inventory", icon: Library, route: "library" as const, href: null },
  { label: "Library paths", icon: FolderSearch, route: null, href: "#library-paths" },
  { label: "Metadata & scanning", icon: WandSparkles, route: null, href: "#metadata-providers" },
  { label: "Plex sync", icon: Server, route: null, href: "#plex-sync" },
  { label: "Playback & transcoding", icon: Cpu, route: null, href: "#playback-and-transcoding" },
];

type MetadataResult = {
  tmdbId: number;
  title: string;
  year: number | null;
  overview: string | null;
  posterUrl: string | null;
  type: string;
};

type MatchTarget = {
  id: string;
  title: string;
  type: "MOVIE" | "TV";
  year?: number | null;
};

type PlexPreviewPayload = {
  url?: string;
  token?: string;
  direction: PlexSyncDirection;
  sectionId: string | null;
};

export function LibraryView({ mode = "library" }: { mode?: "library" | "settings" }) {
  const isSettings = mode === "settings";
  const { data: stats, isLoading: statsLoading } = useStats();
  const { data: config } = useLibraryConfig();
  const { data: sections, isLoading: sectionsLoading } = useSections();
  const createSection = useCreateSection();
  const updateSection = useUpdateSection();
  const deleteSection = useDeleteSection();
  const scanSection = useScanSection();
  const scanAll = useScan();
  const metaSearch = useMetadataSearch();
  const applyMeta = useApplyMetadata();
  const saveLibraryConfig = useSaveLibraryConfig();
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
  const [inventorySearch, setInventorySearch] = useState("");
  const [inventoryAvailability, setInventoryAvailability] = useState<"available" | "unavailable" | "all">("all");
  const [inventoryMetadata, setInventoryMetadata] = useState<"matched" | "unmatched" | "all">("all");
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState("");
  const [newType, setNewType] = useState<MediaType>("MOVIE");
  const [newCategory, setNewCategory] = useState("default");
  const [newDir, setNewDir] = useState("");
  const [plexUrl, setPlexUrl] = useState("");
  const [plexToken, setPlexToken] = useState("");
  const [plexDirection, setPlexDirection] = useState<PlexSyncDirection>("pull");
  const [plexSectionId, setPlexSectionId] = useState<string>("all");
  const [plexResult, setPlexResult] = useState<PlexSyncResult | null>(null);
  const [plexPreviewPayload, setPlexPreviewPayload] = useState<PlexPreviewPayload | null>(null);
  const [plexReportVersion, setPlexReportVersion] = useState(0);
  const [tmdbEdited, setTmdbEdited] = useState(false);
  const [plexUrlEdited, setPlexUrlEdited] = useState(false);
  const [plexDirectionEdited, setPlexDirectionEdited] = useState(false);
  const [matchTarget, setMatchTarget] = useState<MatchTarget | null>(null);
  const [matchQuery, setMatchQuery] = useState("");
  const [matchResults, setMatchResults] = useState<MetadataResult[]>([]);
  const [matchingId, setMatchingId] = useState<string | null>(null);

  const effectiveTmdbKey = tmdbEdited ? globalTmdbKey : "";
  const effectivePlexUrl = plexUrlEdited ? plexUrl : config?.plexUrl ?? "";
  const effectivePlexDirection = plexDirectionEdited
    ? plexDirection
    : config?.plexSyncDirection ?? "pull";

  const effectiveType = sectionFilter ? sectionFilter.type : inventoryType;
  const deferredInventorySearch = useDeferredValue(inventorySearch.trim());

  const list = useBrowseInfinite({
    type: effectiveType === "ALL" ? undefined : effectiveType,
    sectionId: sectionFilter?.id,
    pageSize: 100,
    sort: "title",
    q: deferredInventorySearch || undefined,
    availability: inventoryAvailability,
    metadata: inventoryMetadata,
    enabled: !isSettings,
  });

  const onSaveTmdbKey = async () => {
    if (!tmdbEdited) {
      toast({ title: "No key entered", description: "Enter a replacement key before saving. The stored key remains active." });
      return;
    }
    try {
      await saveLibraryConfig.mutateAsync({ tmdbKey: effectiveTmdbKey });
      setGlobalTmdbKey("");
      setTmdbEdited(false);
      toast({
        title: "TMDB key saved",
        description: effectiveTmdbKey
          ? "This key will be used for all scans and metadata fetches."
          : "TMDB key cleared. Scans will run without metadata matching.",
      });
    } catch (e) {
      toast({ title: "Couldn't save key", description: (e as Error).message, variant: "destructive" });
    }
  };

  const onSavePlexSettings = async () => {
    try {
      await saveLibraryConfig.mutateAsync({
        plexUrl: effectivePlexUrl,
        plexToken: plexToken || undefined,
        plexSyncDirection: effectivePlexDirection,
      });
      setPlexToken("");
      toast({
        title: "Plex settings saved",
        description: "Lumina will use these settings for watched history sync.",
      });
    } catch (e) {
      toast({ title: "Couldn't save Plex settings", description: (e as Error).message, variant: "destructive" });
    }
  };

  const onScanAll = async () => {
    setAllResult(null);
    toast({
      title: "Library scan queued",
      description: "The scan will continue on the server if you leave this view.",
    });
    try {
      const res = await scanAll.mutateAsync({
        tmdbKey: effectiveTmdbKey || undefined,
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
    setSectionResults((previous) => {
      const next = { ...previous };
      delete next[s.id];
      return next;
    });
    toast({
      title: `${s.name} scan queued`,
      description: "The scan will continue on the server if you leave this view.",
    });
    try {
      const res = await scanSection.mutateAsync({
        sectionId: s.id,
        tmdbKey: effectiveTmdbKey || undefined,
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

  const onOpenManualMatch = async (media: MatchTarget) => {
    const parsed = splitTrailingReleaseYear(media.title, media.year ?? undefined);
    setMatchTarget(media);
    setMatchQuery(parsed.title);
    setMatchResults([]);
    try {
      const { results } = await metaSearch.mutateAsync({
        title: parsed.title,
        type: media.type,
        year: parsed.year,
      });
      setMatchResults(results);
    } catch (e) {
      toast({ title: "Metadata search failed", description: (e as Error).message, variant: "destructive" });
    }
  };

  const onSearchManualMatch = async () => {
    if (!matchTarget || !matchQuery.trim()) return;
    const parsed = splitTrailingReleaseYear(matchQuery, matchTarget.year ?? undefined);
    try {
      const { results } = await metaSearch.mutateAsync({
        title: parsed.title,
        type: matchTarget.type,
        year: parsed.year,
      });
      setMatchResults(results);
    } catch (e) {
      toast({ title: "Metadata search failed", description: (e as Error).message, variant: "destructive" });
    }
  };

  const onApplyManualMatch = async (tmdbId: number) => {
    if (!matchTarget) return;
    setMatchingId(matchTarget.id);
    try {
      await applyMeta.mutateAsync({ mediaId: matchTarget.id, tmdbId, type: matchTarget.type });
      toast({ title: "Metadata match applied", description: `"${matchTarget.title}" was matched and refreshed.` });
      setMatchTarget(null);
      setMatchResults([]);
      setMatchQuery("");
    } catch (e) {
      toast({ title: "Couldn't apply match", description: (e as Error).message, variant: "destructive" });
    } finally {
      setMatchingId(null);
    }
  };

  const plexPayload = () => ({
    url: effectivePlexUrl || undefined,
    token: plexToken || undefined,
    direction: effectivePlexDirection,
    sectionId: plexSectionId === "all" ? null : plexSectionId,
  });

  const invalidatePlexPreview = () => {
    setPlexPreviewPayload(null);
    setPlexResult((current) => current?.mode === "preview" ? null : current);
  };

  const onTestPlex = async () => {
    setPlexPreviewPayload(null);
    try {
      const result = await testPlex.mutateAsync({ url: effectivePlexUrl || undefined, token: plexToken || undefined });
      setPlexResult(result);
      setPlexReportVersion((version) => version + 1);
      toast({
        title: "Plex connected",
        description: `${result.serverName ?? "Plex"} · ${result.sections ?? 0} library section(s) found.`,
      });
    } catch (e) {
      toast({ title: "Couldn't reach Plex", description: (e as Error).message, variant: "destructive" });
    }
  };

  const onPreviewPlexSync = async () => {
    const payload = plexPayload();
    setPlexPreviewPayload(null);
    setPlexResult(null);
    try {
      const result = await plexSync.mutateAsync({ ...payload, apply: false });
      setPlexResult(result);
      setPlexPreviewPayload(payload);
      setPlexReportVersion((version) => version + 1);
      toast({
        title: "Plex sync preview ready",
        description: `${result.markedLuminaWatched} Lumina update(s) · ${result.markedPlexWatched} Plex update(s).`,
      });
    } catch (e) {
      toast({ title: "Plex preview failed", description: (e as Error).message, variant: "destructive" });
    }
  };

  const onApplyPlexSync = async () => {
    if (!plexPreviewPayload || plexResult?.mode !== "preview") {
      toast({
        title: "Preview required",
        description: "Run a fresh preview for the current Plex settings before applying watched changes.",
      });
      return;
    }
    try {
      const result = await plexSync.mutateAsync({ ...plexPreviewPayload, apply: true });
      setPlexResult(result);
      setPlexPreviewPayload(null);
      setPlexReportVersion((version) => version + 1);
      toast({
        title: "Plex sync applied",
        description: `${result.markedLuminaWatched} marked watched in Lumina · ${result.markedPlexWatched} marked watched in Plex.`,
      });
    } catch (e) {
      toast({ title: "Plex sync failed", description: (e as Error).message, variant: "destructive" });
    }
  };

  const items = list.data?.pages.flatMap((page) => page.items) ?? [];
  const totalItems = list.data?.pages[0]?.total ?? 0;
  const inventoryLabel =
    effectiveType === "MOVIE" ? "movies" : effectiveType === "TV" ? "TV shows" : "titles";

  return (
    <div className="lumina-page px-4 pb-10 pt-20 sm:px-6 lg:px-8 min-[2200px]:pt-24">
      <PageHero isSettings={isSettings} stats={stats} statsLoading={statsLoading} />

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
            inventorySearch={inventorySearch}
            setInventorySearch={setInventorySearch}
            availability={inventoryAvailability}
            setAvailability={setInventoryAvailability}
            metadata={inventoryMetadata}
            setMetadata={setInventoryMetadata}
            clearSection={() => setLibrarySectionFilter(null)}
            onFetchMetadata={onFetchMetadata}
            onOpenManualMatch={onOpenManualMatch}
            matchTarget={matchTarget}
            matchQuery={matchQuery}
            setMatchQuery={setMatchQuery}
            matchResults={matchResults}
            searchPending={metaSearch.isPending}
            matchingId={matchingId}
            onSearchMatch={onSearchManualMatch}
            onApplyMatch={onApplyManualMatch}
            onCloseMatch={() => setMatchTarget(null)}
            fetchingId={fetchingId}
            hasMore={!!list.hasNextPage}
            onLoadMore={() => list.fetchNextPage()}
            loadingMore={list.isFetchingNextPage}
          />
        </>
      )}

      {isSettings && (
        <div className="grid items-start gap-5 lg:grid-cols-[280px_minmax(0,1fr)]">
          <SettingsSidebar />
          <div className="min-w-0 space-y-5">
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
              tmdbKey={effectiveTmdbKey}
              setTmdbKey={(value) => {
                setTmdbEdited(true);
                setGlobalTmdbKey(value);
              }}
              autoMatch={globalAutoMatch}
              setAutoMatch={setGlobalAutoMatch}
              saved={!!config?.tmdbKeyConfigured || !!stats?.tmdbKeyConfigured}
              savePending={saveLibraryConfig.isPending}
              scanPending={scanAll.isPending}
              onSave={onSaveTmdbKey}
              onScanAll={onScanAll}
              result={allResult}
            />
            <PlexSyncPanel
              key={plexReportVersion}
              plexUrl={effectivePlexUrl}
              setPlexUrl={(value) => {
                invalidatePlexPreview();
                setPlexUrlEdited(true);
                setPlexUrl(value);
              }}
              plexToken={plexToken}
              setPlexToken={(value) => {
                invalidatePlexPreview();
                setPlexToken(value);
              }}
              direction={effectivePlexDirection}
              setDirection={(value) => {
                invalidatePlexPreview();
                setPlexDirectionEdited(true);
                setPlexDirection(value);
              }}
              sectionId={plexSectionId}
              setSectionId={(value) => {
                invalidatePlexPreview();
                setPlexSectionId(value);
              }}
              sections={sections ?? []}
              result={plexResult}
              tokenSaved={!!config?.plexTokenSaved}
              busy={testPlex.isPending || plexSync.isPending}
              savePending={saveLibraryConfig.isPending}
              onSave={onSavePlexSettings}
              onTest={onTestPlex}
              onPreview={onPreviewPlexSync}
              onApply={onApplyPlexSync}
              applyReady={!!plexPreviewPayload && plexResult?.mode === "preview"}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function PageHero({ isSettings, stats, statsLoading }: { isSettings: boolean; stats?: any; statsLoading: boolean }) {
  return (
    <section className="lumina-panel relative mb-7 overflow-hidden rounded-lg p-5 sm:p-8">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_84%_0%,rgba(232,241,244,0.13),transparent_30%),linear-gradient(120deg,rgba(39,65,77,0.42),transparent_58%)]" />
      <div className="relative grid items-end gap-6 lg:grid-cols-[minmax(0,1fr)_auto]">
        <div className="max-w-3xl">
          <p className="label-eyebrow mb-2 text-primary/90">
          {isSettings ? "Server control room" : "Media inventory"}
        </p>
        <h1 className="lumina-title text-5xl font-semibold leading-none sm:text-7xl">
          {isSettings ? "Settings" : "Library"}
        </h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-foreground/68 sm:text-base">
          {isSettings
            ? "Configure libraries, metadata, scanning, Plex sync, playback, and transcoding."
            : `${(stats?.mediaCount ?? 0).toLocaleString()} scanned titles, organized for discovery and metadata care without exposing raw admin controls.`}
          </p>
        </div>
        {isSettings && (
          <div id="playback-and-transcoding" className="flex max-w-md items-center gap-3 rounded-lg border border-white/12 bg-[var(--lumina-ink)]/38 px-4 py-3 backdrop-blur-xl">
            <div className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/12 text-primary"><Cpu className="h-4 w-4" /></div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold">Playback & transcoding</span>
                <Badge variant={stats?.transcodeHardware ? "default" : "secondary"} className="text-[10px]">
                  {statsLoading ? "Checking" : !stats?.transcodeAvailable ? "Unavailable" : stats?.transcodeHardware ? "Hardware" : "CPU"}
                </Badge>
              </div>
              <p className="mt-1 truncate font-mono text-[11px] text-foreground/52">{statsLoading ? "detecting encoder" : stats?.transcodeEncoderKey ?? "direct play / libx264"}</p>
            </div>
          </div>
        )}
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
  const setRoute = useMediaStore((s) => s.setRoute);

  return (
    <aside className="lumina-panel h-fit self-start rounded-lg p-3">
      <div className="px-2 pb-3 pt-1">
        <p className="label-eyebrow text-primary/90">Configuration</p>
      </div>
      <nav className="space-y-1" aria-label="Settings sections">
        {SETTINGS_NAV.map((item) => {
          const Icon = item.icon;
          const className = cn(
            "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-semibold text-foreground/68 transition-colors hover:bg-white/[0.055] hover:text-foreground"
          );
          const content = (
            <>
              <Icon className="h-4 w-4" />
              <span className="min-w-0 flex-1">{item.label}</span>
            </>
          );
          return item.route ? (
            <button key={item.label} type="button" className={className} onClick={() => setRoute(item.route)}>
              {content}
            </button>
          ) : (
            <a key={item.label} href={item.href} className={className}>
              {content}
            </a>
          );
        })}
      </nav>
    </aside>
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
              placeholder={saved ? "Saved key active — enter a replacement" : "Get one free at themoviedb.org/settings/api"}
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
        <label className="flex items-center gap-3 rounded-lg border border-border/60 bg-white/[0.055] p-4 text-sm text-foreground/72">
          <Checkbox checked={autoMatch} onCheckedChange={(v) => setAutoMatch(!!v)} />
          Match new titles and refresh incomplete matches during scans
        </label>
      </div>
      {result && (
        <div className="mt-4 rounded-lg border border-border/60 bg-[var(--lumina-ink)]/28 p-4 text-sm">
          <div className="mb-2 flex items-center gap-2 font-semibold">
            {result.complete ? <CheckCircle2 className="h-4 w-4 text-primary" /> : <AlertTriangle className="h-4 w-4 text-amber-300" />}
            {result.complete ? "Scan finished" : "Incomplete scan — availability unchanged"} in {(result.durationMs / 1000).toFixed(1)}s
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
          <ScanManifestView result={result} />
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
  sectionId,
  setSectionId,
  sections,
  result,
  tokenSaved,
  busy,
  savePending,
  onSave,
  onTest,
  onPreview,
  onApply,
  applyReady,
}: {
  plexUrl: string;
  setPlexUrl: (value: string) => void;
  plexToken: string;
  setPlexToken: (value: string) => void;
  direction: PlexSyncDirection;
  setDirection: (value: PlexSyncDirection) => void;
  sectionId: string;
  setSectionId: (value: string) => void;
  sections: LibrarySectionInfo[];
  result: PlexSyncResult | null;
  tokenSaved: boolean;
  busy: boolean;
  savePending: boolean;
  onSave: () => void;
  onTest: () => void;
  onPreview: () => void;
  onApply: () => void;
  applyReady: boolean;
}) {
  const pendingChanges = (result?.markedLuminaWatched ?? 0) + (result?.markedPlexWatched ?? 0);
  const attentionTotal = result?.attentionTotal ?? (result?.unmatched ?? 0) + pendingChanges;
  const detailReturned = result?.detailReturned ?? result?.items.length ?? 0;
  const [itemFilter, setItemFilter] = useState<"attention" | "changes" | "unmatched">("attention");
  const visibleItems = (result?.items ?? []).filter((item) => {
    if (itemFilter === "unmatched") return item.action === "unmatched";
    if (itemFilter === "changes") return item.action === "mark-lumina-watched" || item.action === "mark-plex-watched";
    return item.action === "unmatched" || item.action === "mark-lumina-watched" || item.action === "mark-plex-watched";
  });
  const selectedTotal = itemFilter === "changes"
    ? pendingChanges
    : itemFilter === "unmatched"
      ? result?.unmatched ?? 0
      : attentionTotal;
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

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_210px_230px]">
        <Field label="Plex server URL">
          <Input
            value={plexUrl}
            onChange={(e) => setPlexUrl(e.target.value)}
            disabled={busy}
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
            disabled={busy}
            placeholder={tokenSaved ? "Saved token active" : "Token from your Plex server"}
            className="font-mono text-sm"
          />
          <p className="mt-1 text-xs text-foreground/42">
            {tokenSaved
              ? "Leave blank to keep the saved token."
              : "Leave blank to use PLEX_TOKEN or LUMINA_PLEX_TOKEN."}
          </p>
        </Field>
        <Field label="Direction">
          <Select value={direction} onValueChange={(v) => setDirection(v as PlexSyncDirection)} disabled={busy}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="pull">Plex to Lumina</SelectItem>
              <SelectItem value="two-way">Two-way watched</SelectItem>
              <SelectItem value="push">Lumina to Plex</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <Field label="Scope">
          <Select value={sectionId} onValueChange={setSectionId} disabled={busy}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Lumina libraries</SelectItem>
              {sections.map((section) => (
                <SelectItem key={section.id} value={section.id}>
                  {section.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="mt-1 text-xs text-foreground/42">Limits Lumina matching and updates to this library.</p>
        </Field>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <Button variant="outline" onClick={onSave} disabled={savePending || busy}>
          {savePending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
          Save settings
        </Button>
        <Button variant="outline" onClick={onTest} disabled={busy}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Server className="h-4 w-4" />}
          Test
        </Button>
        <Button variant="outline" onClick={onPreview} disabled={busy}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ScanLine className="h-4 w-4" />}
          Preview
        </Button>
        <Button onClick={onApply} disabled={busy || !applyReady || pendingChanges === 0}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
          Apply watched sync
        </Button>
      </div>

      {result && (
        <div className="mt-5 rounded-lg border border-border/60 bg-[var(--lumina-ink)]/28 p-4">
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
            <>
              <div className="mt-4 flex flex-wrap items-center gap-2">
                {([
                  ["attention", "Needs attention", attentionTotal],
                  ["changes", "Changes", pendingChanges],
                  ["unmatched", "Unmatched", result.unmatched],
                ] as const).map(([value, label, count]) => (
                  <Button
                    key={value}
                    variant={itemFilter === value ? "default" : "outline"}
                    onClick={() => setItemFilter(value)}
                    className="h-8 px-3 text-xs"
                  >
                    {label} · {count.toLocaleString()}
                  </Button>
                ))}
                {(result.alreadySynced > 0 || result.skipped > 0) && (
                  <span className="text-xs text-foreground/42">
                    {(result.alreadySynced + result.skipped).toLocaleString()} synced or no-change rows omitted
                  </span>
                )}
              </div>
              {result.detailTruncated && (
                <p className="mt-2 text-xs text-amber-200/72">
                  Showing {detailReturned.toLocaleString()} of {attentionTotal.toLocaleString()} attention rows. Changes are retained before unmatched detail.
                </p>
              )}
              <div className="thin-scrollbar mt-3 max-h-72 overflow-auto rounded-lg border border-border/50">
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
                  {visibleItems.map((item, index) => (
                    <tr key={`${item.plexRatingKey ?? item.title}-${index}`} className="border-b border-border/35 last:border-0">
                      <td className="px-3 py-2 font-medium">
                        <div>{item.title}</div>
                        {item.reason && (
                          <div
                            className="mt-1 max-w-[360px] text-[11px] font-normal leading-4 text-foreground/44"
                            title={item.reason}
                          >
                            {item.reason}
                          </div>
                        )}
                      </td>
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
                  {visibleItems.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-3 py-8 text-center text-foreground/46">
                        {selectedTotal > 0 && result.detailTruncated
                          ? `${selectedTotal.toLocaleString()} row(s) match this filter, but their detail falls outside the bounded preview. Changes are retained first.`
                          : "Nothing in this preview matches the selected filter."}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
              </div>
            </>
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
        <div className="lumina-panel rounded-lg p-8 text-center text-foreground/50"><Loader2 className="mx-auto h-5 w-5 animate-spin" /></div>
      ) : sections?.length ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {sections.map((s) => (
            <button key={s.id} onClick={() => onManage(s)} className="lumina-panel rounded-lg p-4 text-left transition-all hover:-translate-y-0.5 hover:border-white/28">
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
        <div className="lumina-panel rounded-lg p-8 text-center text-sm text-foreground/54">Add library paths in Settings to begin building this overview.</div>
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
  inventorySearch,
  setInventorySearch,
  availability,
  setAvailability,
  metadata,
  setMetadata,
  clearSection,
  onFetchMetadata,
  onOpenManualMatch,
  matchTarget,
  matchQuery,
  setMatchQuery,
  matchResults,
  searchPending,
  matchingId,
  onSearchMatch,
  onApplyMatch,
  onCloseMatch,
  fetchingId,
  hasMore,
  onLoadMore,
  loadingMore,
}: {
  items: any[];
  totalItems: number;
  inventoryLabel: string;
  isLoading: boolean;
  sectionFilter: { id: string; name: string; type: MediaType } | null;
  inventoryType: MediaType | "ALL";
  setInventoryType: (value: MediaType | "ALL") => void;
  inventorySearch: string;
  setInventorySearch: (value: string) => void;
  availability: "available" | "unavailable" | "all";
  setAvailability: (value: "available" | "unavailable" | "all") => void;
  metadata: "matched" | "unmatched" | "all";
  setMetadata: (value: "matched" | "unmatched" | "all") => void;
  clearSection: () => void;
  onFetchMetadata: (mediaId: string, title: string, type: "MOVIE" | "TV") => void;
  onOpenManualMatch: (media: MatchTarget) => void;
  matchTarget: MatchTarget | null;
  matchQuery: string;
  setMatchQuery: (value: string) => void;
  matchResults: MetadataResult[];
  searchPending: boolean;
  matchingId: string | null;
  onSearchMatch: () => void;
  onApplyMatch: (tmdbId: number) => void;
  onCloseMatch: () => void;
  fetchingId: string | null;
  hasMore: boolean;
  onLoadMore: () => void;
  loadingMore: boolean;
}) {
  const foundLabel = totalItems === 1
    ? inventoryLabel === "movies"
      ? "movie"
      : inventoryLabel === "TV shows"
        ? "TV show"
        : "title"
    : inventoryLabel;

  return (
    <Card className="overflow-hidden p-0">
      <div className="flex flex-col gap-4 border-b border-border/60 p-5 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h2 className="lumina-title text-2xl font-semibold">Media inventory</h2>
          <p className="mt-1 text-sm text-foreground/50">
            {sectionFilter
              ? `${sectionFilter.name}: ${totalItems.toLocaleString()} ${foundLabel} found. Showing ${items.length.toLocaleString()}.`
              : `${totalItems.toLocaleString()} ${foundLabel} found. Showing ${items.length.toLocaleString()}.`}
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
      <div className="grid gap-3 border-b border-border/60 bg-white/[0.025] p-4 sm:grid-cols-[minmax(220px,1fr)_190px_190px]">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-foreground/42" />
          <Input
            value={inventorySearch}
            onChange={(event) => setInventorySearch(event.target.value)}
            placeholder="Filter titles…"
            className="pl-9"
            aria-label="Filter library titles"
          />
        </div>
        <Select value={availability} onValueChange={(value) => setAvailability(value as "available" | "unavailable" | "all")}>
          <SelectTrigger aria-label="Filter availability"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All availability</SelectItem>
            <SelectItem value="available">Available</SelectItem>
            <SelectItem value="unavailable">Unavailable</SelectItem>
          </SelectContent>
        </Select>
        <Select value={metadata} onValueChange={(value) => setMetadata(value as "matched" | "unmatched" | "all")}>
          <SelectTrigger aria-label="Filter metadata"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All metadata</SelectItem>
            <SelectItem value="matched">TMDB matched</SelectItem>
            <SelectItem value="unmatched">TMDB unmatched</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {matchTarget && (
        <div className="border-b border-border/60 bg-white/[0.035] p-5">
          <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="label-eyebrow mb-1 text-primary/90">Manual match</p>
              <h3 className="text-lg font-semibold">{matchTarget.title}</h3>
              <p className="mt-1 text-sm text-foreground/52">
                Pick the correct TMDB result. If another Lumina row already uses that TMDB ID,
                the stub will be merged into it.
              </p>
            </div>
            <Button variant="ghost" onClick={onCloseMatch}>
              <X className="h-4 w-4" />
            </Button>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              value={matchQuery}
              onChange={(e) => setMatchQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && onSearchMatch()}
              placeholder="Search TMDB title"
            />
            <Button variant="outline" onClick={onSearchMatch} disabled={searchPending}>
              {searchPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              Search
            </Button>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {matchResults.map((result) => (
              <button
                key={result.tmdbId}
                onClick={() => onApplyMatch(result.tmdbId)}
                disabled={matchingId === matchTarget.id}
                className="rounded-lg border border-border/60 bg-background/45 p-3 text-left transition-colors hover:border-primary/55 hover:bg-primary/8 disabled:opacity-60"
              >
                <div className="flex gap-3">
                  {result.posterUrl ? (
                    <img
                      src={result.posterUrl}
                      alt={result.title}
                      className="h-24 w-16 shrink-0 rounded object-cover"
                      loading="lazy"
                    />
                  ) : (
                    <div className="grid h-24 w-16 shrink-0 place-items-center rounded bg-white/8 text-xs text-foreground/42">
                      No art
                    </div>
                  )}
                  <div className="min-w-0">
                    <div className="line-clamp-2 font-semibold">{result.title}</div>
                    <div className="mt-1 text-xs text-foreground/50">{result.year ?? "Unknown year"}</div>
                    <p className="mt-2 line-clamp-3 text-xs leading-5 text-foreground/50">
                      {result.overview ?? "No overview from TMDB."}
                    </p>
                  </div>
                </div>
              </button>
            ))}
          </div>
          {!searchPending && matchResults.length === 0 && (
            <p className="mt-3 text-sm text-foreground/48">No TMDB candidates yet.</p>
          )}
        </div>
      )}
      <div className="thin-scrollbar max-h-[68vh] overflow-auto">
        <table className="w-full min-w-[860px] text-sm">
          <thead className="border-b border-border/60 text-left text-xs uppercase tracking-[0.12em] text-foreground/50">
            <tr>
              <th className="px-5 py-3 font-semibold">Title</th>
              <th className="px-3 py-3 font-semibold">Type</th>
              <th className="px-3 py-3 font-semibold">Year</th>
              <th className="px-3 py-3 font-semibold">Rating</th>
              <th className="px-3 py-3 font-semibold">Runtime</th>
              <th className="px-3 py-3 font-semibold">Availability</th>
              <th className="px-3 py-3 font-semibold">Metadata</th>
              <th className="px-5 py-3 text-right font-semibold">Action</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={8} className="px-5 py-10 text-center text-foreground/50"><Loader2 className="mx-auto h-5 w-5 animate-spin" /></td></tr>
            ) : items.length === 0 ? (
              <tr><td colSpan={8} className="px-5 py-10 text-center text-foreground/50">No media matches these filters.</td></tr>
            ) : (
              items.map((m) => {
                const available = m.available !== false;
                return (
                  <tr key={m.id} className="border-b border-border/40 last:border-0 hover:bg-foreground/5">
                    <td className="px-5 py-3 font-medium">
                      <div>{m.title}</div>
                      {m.sourcePath && <div className="mt-1 max-w-[420px] truncate font-mono text-[11px] font-normal text-foreground/38" title={m.sourcePath}>{m.sourcePath}</div>}
                    </td>
                    <td className="px-3 py-3 text-foreground/70">{m.type === "TV" ? "TV" : "Movie"}</td>
                    <td className="px-3 py-3 text-foreground/70">{m.year ?? "-"}</td>
                    <td className="px-3 py-3 text-foreground/70">{m.rating?.toFixed(1) ?? "-"}</td>
                    <td className="px-3 py-3 text-foreground/70">{m.runtime ? formatRuntime(m.runtime) : "-"}</td>
                    <td className="px-3 py-3">
                      <Badge variant={available ? "secondary" : "outline"} className={cn("gap-1", !available && "border-amber-400/30 text-amber-200/80")}>
                        {available ? <CheckCircle2 className="h-3 w-3 text-[var(--success)]" /> : <AlertTriangle className="h-3 w-3" />}
                        {available ? "Available" : "Unavailable"}
                      </Badge>
                    </td>
                    <td className="px-3 py-3">
                      {m.metadataMatched ? (
                        <Badge variant="secondary" className="gap-1"><CheckCircle2 className="h-3 w-3 text-primary" /> TMDB matched</Badge>
                      ) : (
                        <Badge variant="outline" className="gap-1 text-foreground/50"><AlertTriangle className="h-3 w-3" /> Unmatched</Badge>
                      )}
                    </td>
                    <td className="px-5 py-3 text-right">
                      <div className="flex justify-end gap-2">
                        <Button variant="outline" disabled={fetchingId === m.id} onClick={() => onFetchMetadata(m.id, m.title, m.type)}>
                          {fetchingId === m.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                          Fetch
                        </Button>
                        <Button
                          variant="outline"
                          onClick={() =>
                            onOpenManualMatch({
                              id: m.id,
                              title: m.title,
                              type: m.type,
                              year: m.year,
                            })
                          }
                        >
                          <Search className="h-3.5 w-3.5" />
                          Match
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
      {hasMore && (
        <div className="border-t border-border/60 p-4 text-center">
          <Button variant="outline" onClick={onLoadMore} disabled={loadingMore}>
            {loadingMore ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Load 100 more
          </Button>
        </div>
      )}
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
  const [retainedResult, setRetainedResult] = useState<ScanResult | null>(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);
  const shownResult = result ?? retainedResult;
  const saveDir = () => {
    if (dir !== section.mediaDir) onUpdate(dir);
    setEditing(false);
  };
  const loadLastReport = async () => {
    setReportLoading(true);
    setReportError(null);
    try {
      const response = await fetch(`/api/sections/scan?sectionId=${encodeURIComponent(section.id)}`);
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error ?? "Could not load the last scan report.");
      setRetainedResult(payload as ScanResult);
    } catch (error) {
      setReportError((error as Error).message);
    } finally {
      setReportLoading(false);
    }
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
        {!shownResult && section.scanCount > 0 && (
          <button type="button" onClick={loadLastReport} disabled={reportLoading} className="mt-1 flex items-center gap-1 text-[11px] text-foreground/50 hover:text-foreground disabled:opacity-50">
            {reportLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <ScanLine className="h-3 w-3" />}
            Last scan report
          </button>
        )}
        {reportError && <div className="mt-1 max-w-xs text-[11px] leading-4 text-amber-200/72">{reportError}</div>}
        {shownResult && (
          <div className="max-w-md">
            <div className="mt-1 text-[11px] text-foreground/46">
              {shownResult.added} added · {shownResult.updated} updated · {(shownResult.manifest.entryCount ?? shownResult.manifest.entries.length).toLocaleString()} manifest entries
              {!shownResult.complete && <span className="block text-amber-200/80">Incomplete; availability unchanged</span>}
            </div>
            <ScanManifestView result={shownResult} />
          </div>
        )}
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

function ScanManifestView({ result }: { result: ScanResult }) {
  const reportKey = result.reportUrl ?? `${result.sectionId ?? "all"}:${result.durationMs}`;
  const [loadedReport, setLoadedReport] = useState<{ key: string; result: ScanResult } | null>(null);
  const [loadingKey, setLoadingKey] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<{ key: string; message: string } | null>(null);
  const [visible, setVisible] = useState<{ key: string; count: number } | null>(null);
  const fullResult = loadedReport?.key === reportKey ? loadedReport.result : null;
  const loading = loadingKey === reportKey;
  const error = loadError?.key === reportKey ? loadError.message : null;
  const visibleCount = visible?.key === reportKey ? visible.count : 200;
  const shown = fullResult ?? result;
  const counts = shown.manifest.counts ?? shown.manifest.entries.reduce<Record<string, number>>((all, entry) => {
    all[entry.kind] = (all[entry.kind] ?? 0) + 1;
    return all;
  }, {});
  const entryCount = shown.manifest.entryCount ?? shown.manifest.entries.length;

  const loadFullReport = async () => {
    if (!result.reportUrl || fullResult || loading) return;
    setLoadingKey(reportKey);
    setLoadError(null);
    try {
      const response = await fetch(result.reportUrl, { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error ?? "Could not load the full scan report.");
      const loaded = (payload?.result ?? payload) as ScanResult;
      setLoadedReport({ key: reportKey, result: loaded });
    } catch (loadError) {
      setLoadError({ key: reportKey, message: (loadError as Error).message });
    } finally {
      setLoadingKey(null);
    }
  };

  return (
    <details
      className="mt-3 border-t border-white/10 pt-3"
      onToggle={(event) => {
        if (event.currentTarget.open && result.manifest.entriesTruncated) void loadFullReport();
      }}
    >
      <summary className="cursor-pointer text-xs font-semibold text-foreground/70">Path manifest · {entryCount} entries</summary>
      <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-foreground/55">
        {Object.entries(counts).map(([kind, count]) => <span key={kind} className="rounded bg-white/6 px-2 py-1">{kind}: {count}</span>)}
      </div>
      {loading && <div className="mt-2 flex items-center gap-2 text-xs text-foreground/52"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading full path report…</div>}
      {error && <div className="mt-2 text-xs text-amber-200/78">{error}</div>}
      {!loading && shown.manifest.entries.length > 0 && (
        <div className="thin-scrollbar mt-2 max-h-64 overflow-auto rounded bg-black/20 p-2 font-mono text-[11px] leading-5">
        {shown.manifest.entries.slice(0, visibleCount).map((entry, index) => (
          <div key={`${entry.kind}-${entry.path}-${index}`} className="break-all text-foreground/62">
            <span className="text-primary/80">[{entry.kind}]</span> {entry.path}{entry.title ? ` → ${entry.title}${entry.year ? ` (${entry.year})` : ""}` : ""}{entry.reason ? ` — ${entry.reason}` : ""}
          </div>
        ))}
        {visibleCount < shown.manifest.entries.length && (
          <button type="button" onClick={() => setVisible({ key: reportKey, count: visibleCount + 200 })} className="mt-2 text-primary hover:text-primary/80">
            Show 200 more · {(shown.manifest.entries.length - visibleCount).toLocaleString()} remaining
          </button>
        )}
        </div>
      )}
    </details>
  );
}
