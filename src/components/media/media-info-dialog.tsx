"use client";

import { FileText } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatRuntime } from "@/lib/media-utils";
import { useMediaDetail } from "@/lib/queries";

interface Props {
  mediaId: string;
  title: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function MediaInfoDialog({ mediaId, title, open, onOpenChange }: Props) {
  const info = useMediaDetail(open ? mediaId : null);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[82vh] overflow-hidden border-white/14 bg-[#1b303b]/96 p-0 text-foreground shadow-[0_24px_90px_rgba(7,23,32,0.58)] backdrop-blur-2xl sm:max-w-2xl"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") event.stopPropagation();
        }}
      >
        <DialogHeader className="border-b border-[var(--line-soft)] px-5 py-4">
          <DialogTitle className="flex items-center gap-2 text-xl">
            <FileText className="h-5 w-5 text-primary" />
            Media info
          </DialogTitle>
          <DialogDescription>Local paths and match identifiers for {title}.</DialogDescription>
        </DialogHeader>
        <div className="thin-scrollbar max-h-[64vh] space-y-4 overflow-y-auto px-5 py-4 text-sm">
          {info.isLoading && (
            <div className="rounded-lg border border-[var(--line-soft)] bg-white/[0.035] p-4 text-foreground/60">
              Loading media details...
            </div>
          )}
          {info.isError && (
            <div className="rounded-lg border border-destructive/35 bg-destructive/10 p-4 text-destructive-foreground">
              {info.error instanceof Error ? info.error.message : "Media details could not be loaded."}
            </div>
          )}
          {info.data && (
            <>
              <div className="grid gap-2 sm:grid-cols-2">
                <InfoField label="Title" value={info.data.title} />
                <InfoField label="Type" value={info.data.type === "TV" ? "TV show" : "Movie"} />
                <InfoField label="Year" value={info.data.year ? String(info.data.year) : null} />
                <InfoField label="Runtime" value={info.data.runtime ? formatRuntime(info.data.runtime) : null} />
                <InfoField label="TMDB ID" value={info.data.tmdbId ? String(info.data.tmdbId) : null} />
                <InfoField label="IMDb ID" value={info.data.imdbId} />
                <InfoField label="Source modified" value={formatDateTime(info.data.sourceModifiedAt)} />
                <InfoField label="Source created" value={formatDateTime(info.data.sourceCreatedAt)} />
              </div>

              <PathBlock label={info.data.type === "TV" ? "Show folder" : "Media file"} value={info.data.filePath} />

              {info.data.type === "TV" && (
                <div className="space-y-2">
                  <div className="label-eyebrow text-primary/90">Episode files</div>
                  {info.data.episodes.length === 0 ? (
                    <div className="rounded-lg border border-[var(--line-soft)] bg-white/[0.035] p-3 text-foreground/55">
                      No episode file paths loaded for this season.
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {info.data.episodes.slice(0, 12).map((episode) => (
                        <PathBlock
                          key={episode.id}
                          label={`S${episode.seasonNumber} E${episode.episodeNumber} - ${episode.title}`}
                          value={episode.filePath}
                        />
                      ))}
                      {info.data.episodes.length > 12 && (
                        <p className="text-xs text-foreground/50">
                          Showing the first 12 episode files for this season.
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function InfoField({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="rounded-lg border border-[var(--line-soft)] bg-white/[0.035] p-3">
      <div className="label-eyebrow text-foreground/45">{label}</div>
      <div className="mt-1 min-h-5 break-words font-medium text-foreground/88">
        {value || "Not available"}
      </div>
    </div>
  );
}

function PathBlock({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="rounded-lg border border-[var(--line-soft)] bg-black/24 p-3">
      <div className="label-eyebrow text-foreground/45">{label}</div>
      <div className="mt-1 break-all font-mono text-xs leading-5 text-foreground/82">
        {value || "No local path recorded"}
      </div>
    </div>
  );
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString();
}
