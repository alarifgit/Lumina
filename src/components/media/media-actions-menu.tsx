"use client";

import { useState } from "react";
import {
  Check,
  FileText,
  Info,
  ListX,
  MoreHorizontal,
  Play,
  Plus,
  RefreshCw,
  Search,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { MediaSummary } from "@/lib/types";
import {
  useDismissContinueWatching,
  useRefreshMetadata,
  useSaveProgress,
  useToggleMyList,
} from "@/lib/queries";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { MediaInfoDialog } from "./media-info-dialog";
import { MediaMatchDialog } from "./media-match-dialog";

interface Props {
  media: MediaSummary;
  onPlay: (mediaId: string, episodeId: string | null, startAt: number) => void;
  onOpen?: (id: string) => void;
  showPlay?: boolean;
  showMyList?: boolean;
  showRemoveFromContinueWatching?: boolean;
  align?: "start" | "center" | "end";
  triggerClassName?: string;
}

export function MediaActionsMenu({
  media,
  onPlay,
  onOpen,
  showPlay = true,
  showMyList = true,
  showRemoveFromContinueWatching = false,
  align = "end",
  triggerClassName,
}: Props) {
  const [infoOpen, setInfoOpen] = useState(false);
  const [matchOpen, setMatchOpen] = useState(false);
  const toggle = useToggleMyList();
  const saveProgress = useSaveProgress();
  const refreshMetadata = useRefreshMetadata();
  const dismissContinueWatching = useDismissContinueWatching();
  const canMarkWatched = media.type === "MOVIE" || !!media.progressEpisodeId;
  const resume = (media.progressPosition ?? 0) > 0;

  const markWatched = () => {
    const duration = Math.max(1, media.progressDuration ?? (media.runtime ?? 1) * 60);
    saveProgress.mutate({
      mediaId: media.id,
      episodeId: media.progressEpisodeId ?? null,
      position: duration,
      duration,
      completed: true,
    });
  };

  const refresh = async () => {
    try {
      await refreshMetadata.mutateAsync(media.id);
      toast({ title: "Metadata refreshed", description: `${media.title} was updated from TMDB.` });
    } catch (error) {
      toast({
        title: "Couldn't refresh metadata",
        description: (error as Error).message,
        variant: "destructive",
      });
    }
  };

  const removeFromContinueWatching = async () => {
    try {
      await dismissContinueWatching.mutateAsync({
        mediaId: media.id,
        episodeId: media.progressEpisodeId,
        duration: media.progressDuration,
      });
      toast({
        title: "Removed from Continue Watching",
        description: "Playing it again will add it back automatically.",
      });
    } catch (error) {
      toast({
        title: "Couldn't remove item",
        description: (error as Error).message,
        variant: "destructive",
      });
    }
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className={cn(
              "inline-flex h-8 w-8 items-center justify-center rounded-full border border-white/40 bg-black/50 text-white backdrop-blur transition-colors hover:border-white hover:bg-black/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
              triggerClassName
            )}
            onClick={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
            onKeyDown={(event) => event.stopPropagation()}
            aria-label={`More actions for ${media.title}`}
            title="More actions"
          >
            <MoreHorizontal className="h-4 w-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align={align}
          className="w-56"
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") event.stopPropagation();
          }}
        >
          {onOpen && (
            <DropdownMenuItem onSelect={() => onOpen(media.id)}>
              <Info className="h-4 w-4" />
              More info
            </DropdownMenuItem>
          )}
          {showPlay && (
            <DropdownMenuItem
              onSelect={() =>
                onPlay(media.id, media.progressEpisodeId ?? null, media.progressPosition ?? 0)
              }
            >
              <Play className="h-4 w-4" />
              {resume ? "Resume" : "Play"}
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onSelect={() => setInfoOpen(true)}>
            <FileText className="h-4 w-4" />
            Get info
          </DropdownMenuItem>
          {showMyList && (
            <DropdownMenuItem onSelect={() => toggle.mutate(media.id)}>
              {media.inMyList ? <Check className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
              {media.inMyList ? "Remove from My List" : "Add to My List"}
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={refresh} disabled={refreshMetadata.isPending}>
            <RefreshCw className={cn("h-4 w-4", refreshMetadata.isPending && "animate-spin")} />
            Refresh metadata
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setMatchOpen(true)}>
            <Search className="h-4 w-4" />
            Fix match
          </DropdownMenuItem>
          {(canMarkWatched || showRemoveFromContinueWatching) && (
            <>
              <DropdownMenuSeparator />
              {canMarkWatched && (
                <DropdownMenuItem onSelect={markWatched} disabled={saveProgress.isPending}>
                  <Check className="h-4 w-4" />
                  {media.type === "TV" ? "Mark episode as watched" : "Mark as watched"}
                </DropdownMenuItem>
              )}
              {showRemoveFromContinueWatching && (
                <DropdownMenuItem
                  onSelect={removeFromContinueWatching}
                  disabled={dismissContinueWatching.isPending}
                >
                  <ListX className="h-4 w-4" />
                  Remove from Continue Watching
                </DropdownMenuItem>
              )}
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <MediaInfoDialog
        mediaId={media.id}
        title={media.title}
        open={infoOpen}
        onOpenChange={setInfoOpen}
      />
      {matchOpen && (
        <MediaMatchDialog
          media={media}
          open={matchOpen}
          onOpenChange={setMatchOpen}
        />
      )}
    </>
  );
}
