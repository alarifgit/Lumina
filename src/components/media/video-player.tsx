"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Play,
  Pause,
  Volume2,
  VolumeX,
  Maximize,
  Minimize,
  Rewind,
  FastForward,
  ChevronLeft,
  SkipForward,
  Loader2,
  Settings,
  Captions,
  X,
} from "lucide-react";
import { useMediaStore } from "@/store/media-store";
import { useMediaDetail, useProbe } from "@/lib/queries";
import { useQueryClient } from "@tanstack/react-query";
import { formatTimecode } from "@/lib/media-utils";
import type { Episode } from "@/lib/types";
import { cn } from "@/lib/utils";

const RATES = [0.5, 0.75, 1, 1.25, 1.5, 2];

export function VideoPlayer() {
  const mediaId = useMediaStore((s) => s.watchMediaId);
  const episodeIdParam = useMediaStore((s) => s.watchEpisodeId);
  const startAt = useMediaStore((s) => s.watchStartAt);
  if (!mediaId) return null;
  return (
    <PlayerSession
      key={`${mediaId}|${episodeIdParam ?? ""}`}
      mediaId={mediaId}
      episodeIdParam={episodeIdParam}
      startAt={startAt}
    />
  );
}

function PlayerSession({
  mediaId,
  episodeIdParam,
  startAt,
}: {
  mediaId: string;
  episodeIdParam: string | null;
  startAt: number;
}) {
  const close = useMediaStore((s) => s.closeWatch);
  const detail = useMediaDetail(mediaId, undefined);
  const qc = useQueryClient();

  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSave = useRef(0);

  const [activeEpId, setActiveEpId] = useState<string | null>(episodeIdParam);
  const [resumeAt, setResumeAt] = useState(startAt);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [rate, setRate] = useState(1);
  const [rateOpen, setRateOpen] = useState(false);
  const [ccOpen, setCcOpen] = useState(false);
  const [activeSubId, setActiveSubId] = useState<string | null>(null);
  const [showControls, setShowControls] = useState(true);
  const [buffering, setBuffering] = useState(true);
  const [fullscreen, setFullscreen] = useState(false);
  const [ended, setEnded] = useState(false);
  const [audioError, setAudioError] = useState(false);
  const [audioHintDismissed, setAudioHintDismissed] = useState(false);

  const d = detail.data;

  const currentEpisode: Episode | null = useMemo(() => {
    if (!d) return null;
    if (d.type !== "TV") return null;
    if (activeEpId) {
      const found = d.episodes.find((e) => e.id === activeEpId);
      if (found) return found;
      return {
        id: activeEpId,
        seasonNumber: 0,
        episodeNumber: 0,
        title: "Episode",
        overview: null,
        stillUrl: null,
        airDate: null,
        runtime: null,
        streamUrl: null,
        filePath: null,
      } as Episode;
    }
    return d.nextEpisode ?? d.episodes[0] ?? null;
  }, [d, activeEpId]);

  // Subtitles for the currently-playing item (episode subs for TV, media subs for movies)
  const subtitles = currentEpisode?.subtitles ?? d?.subtitles ?? [];

  // Transcoding state.
  // `transcodeOverride` is null (auto), or a user's explicit choice (true/false).
  // The effective `transcode` value is: override if set, else auto-detected from probe.
  const [transcodeOverride, setTranscodeOverride] = useState<boolean | null>(null);
  const probeTargetId = currentEpisode?.id ?? d?.id ?? null;
  const probeKind: "media" | "episode" = currentEpisode ? "episode" : "media";
  const probe = useProbe(probeKind, probeTargetId, !!probeTargetId);

  // Effective transcoding decision: user override wins, else auto from ffprobe
  const transcode = transcodeOverride ?? (!probe.data?.browserCompatible && !!probe.data);

  const setTranscode = (v: boolean) => setTranscodeOverride(v);

  // Build the source URL. When transcoding, append ?transcode=1&t=<resumePos>
  // so ffmpeg starts at the resume position (seeking a live transcode isn't possible).
  const source = useMemo(() => {
    if (!d) return null;
    const base = currentEpisode
      ? (currentEpisode.streamUrl ?? `/api/episodes/${currentEpisode.id}/stream`)
      : (d.streamUrl ?? `/api/media/${d.id}/stream`);
    if (!transcode || currentEpisode?.streamUrl || d.streamUrl) return base;
    const sep = base.includes("?") ? "&" : "?";
    return `${base}${sep}transcode=1${resumeAt > 1 ? `&t=${Math.floor(resumeAt)}` : ""}`;
  }, [d, currentEpisode, transcode, resumeAt]);

  const nextUp = useMemo(() => {
    if (!d || d.type !== "TV" || !currentEpisode) return null;
    const idx = d.episodes.findIndex((e) => e.id === currentEpisode.id);
    if (idx >= 0 && idx < d.episodes.length - 1) return d.episodes[idx + 1];
    return null;
  }, [d, currentEpisode]);

  const saveProgress = useCallback(
    (force = false) => {
      const v = videoRef.current;
      if (!v || !mediaId || !d) return;
      const pos = v.currentTime || 0;
      const dur = v.duration || 0;
      if (dur <= 0) return;
      const now = Date.now();
      if (!force && now - lastSave.current < 4000) return;
      lastSave.current = now;
      const completed = pos / dur > 0.95;
      fetch("/api/progress", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mediaId,
          episodeId: d.type === "TV" ? activeEpId : null,
          position: pos,
          duration: dur,
          completed,
        }),
      }).catch(() => {});
    },
    [mediaId, d, activeEpId]
  );

  const togglePlay = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) v.play().catch(() => {});
    else v.pause();
  };

  const toggleFullscreen = () => {
    const el = containerRef.current;
    if (!el) return;
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else el.requestFullscreen().catch(() => {});
  };

  const flashControls = useCallback(() => {
    setShowControls(true);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => {
      if (videoRef.current && !videoRef.current.paused) setShowControls(false);
    }, 3000);
  }, []);

  // periodic save
  useEffect(() => {
    const t = setInterval(() => saveProgress(), 5000);
    return () => {
      clearInterval(t);
      saveProgress(true);
      qc.invalidateQueries({ queryKey: ["progress"] });
      qc.invalidateQueries({ queryKey: ["home"] });
      qc.invalidateQueries({ queryKey: ["media"], exact: false });
    };
  }, [saveProgress, qc]);

  // keyboard
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const v = videoRef.current;
      if (!v) return;
      switch (e.key) {
        case " ":
        case "k":
          e.preventDefault();
          togglePlay();
          break;
        case "ArrowLeft":
          e.preventDefault();
          v.currentTime = Math.max(0, v.currentTime - 10);
          break;
        case "ArrowRight":
          e.preventDefault();
          v.currentTime = Math.min(v.duration || 0, v.currentTime + 10);
          break;
        case "ArrowUp":
          e.preventDefault();
          setVolume((vol) => {
            const nv = Math.min(1, vol + 0.1);
            v.volume = nv;
            setMuted(nv === 0);
            return nv;
          });
          break;
        case "ArrowDown":
          e.preventDefault();
          setVolume((vol) => {
            const nv = Math.max(0, vol - 0.1);
            v.volume = nv;
            setMuted(nv === 0);
            return nv;
          });
          break;
        case "f":
          toggleFullscreen();
          break;
        case "m":
          setMuted((m) => {
            v.muted = !m;
            return !m;
          });
          break;
        case "Escape":
          if (!document.fullscreenElement) close();
          break;
      }
      flashControls();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close, flashControls]);

  // fullscreen change
  useEffect(() => {
    const onFs = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);

  // Detect missing/unplayable audio. After the video starts playing, if the
  // browser exposes audioTracks but none are enabled/working, or if a media
  // error fires specifically on the audio decoder, we auto-switch to the
  // transcoded stream (ffmpeg re-encodes audio to AAC) and show a hint.
  useEffect(() => {
    if (!playing || audioError) return;
    const v = videoRef.current;
    if (!v) return;
    const triggerFallback = () => {
      setAudioError(true);
      // Auto-enable transcoding (unless this is a remote/demo stream we can't transcode)
      if (!d?.streamUrl && !(currentEpisode?.streamUrl)) {
        setTranscode(true);
      }
    };
    // Use HTMLMediaElement.error for hard decode failures
    const onErr = () => {
      if (v.error && v.error.code === MediaError.MEDIA_ERR_DECODE) {
        triggerFallback();
      }
    };
    v.addEventListener("error", onErr);
    // Some browsers expose audioTracks — if all are disabled, flag it
    const checkAudio = () => {
      const at = (v as HTMLVideoElement & { audioTracks?: { length: number; enabled: boolean }[] }).audioTracks;
      if (at && at.length > 0 && !at.some((t) => t.enabled)) {
        triggerFallback();
      }
    };
    const t = setTimeout(checkAudio, 1500);
    return () => {
      v.removeEventListener("error", onErr);
      clearTimeout(t);
    };
  }, [playing, audioError, d?.streamUrl, currentEpisode?.streamUrl]);

  const onLoadedMetadata = () => {
    const v = videoRef.current;
    if (!v) return;
    setDuration(v.duration || 0);
    setBuffering(false);
    if (resumeAt > 0 && resumeAt < v.duration - 2) {
      v.currentTime = resumeAt;
    }
    v.volume = volume;
    v.play().catch(() => {});
    // Initialise the active subtitle from the default track (if any)
    const def = subtitles.find((s) => s.isDefault) ?? null;
    setActiveSubId(def?.id ?? null);
    if (def) {
      // Ensure the default track is showing (browser may need a tick)
      requestAnimationFrame(() => applySubtitle(def.id));
    }
    flashControls();
  };

  /** Set a subtitle track as showing (or disable all if id is null). */
  const applySubtitle = (id: string | null) => {
    const v = videoRef.current;
    if (!v) return;
    const tracks = v.textTracks;
    for (let i = 0; i < tracks.length && i < subtitles.length; i++) {
      // tracks[i] corresponds to subtitles[i] (same render order)
      tracks[i].mode = subtitles[i].id === id ? "showing" : "disabled";
    }
    setActiveSubId(id);
  };

  const seek = (val: number) => {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = val;
    setCurrent(val);
  };

  const changeRate = (r: number) => {
    setRate(r);
    if (videoRef.current) videoRef.current.playbackRate = r;
    setRateOpen(false);
  };

  const playNext = () => {
    if (nextUp) {
      setActiveEpId(nextUp.id);
      setResumeAt(0);
      setEnded(false);
      setCurrent(0);
      setActiveSubId(null);
    }
  };

  const titleText = d?.title ?? "Loading…";
  const subText =
    d?.type === "TV" && currentEpisode
      ? `S${currentEpisode.seasonNumber} · E${currentEpisode.episodeNumber}${currentEpisode.title && currentEpisode.title !== "Episode" ? ` · ${currentEpisode.title}` : ""}`
      : d?.type === "MOVIE"
        ? d.year
          ? String(d.year)
          : "Movie"
        : "";

  return (
    <div
      ref={containerRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black"
      onMouseMove={flashControls}
      onClick={(e) => {
        if (e.target === e.currentTarget || e.target === videoRef.current) togglePlay();
      }}
      role="dialog"
      aria-label="Video player"
    >
      {source && (
        <video
          key={source}
          ref={videoRef}
          src={source}
          className="h-full w-full bg-black object-contain"
          playsInline
          autoPlay
          onClick={(e) => {
            e.stopPropagation();
            togglePlay();
          }}
          onLoadedMetadata={onLoadedMetadata}
          onTimeUpdate={(e) => setCurrent((e.target as HTMLVideoElement).currentTime)}
          onDurationChange={(e) => setDuration((e.target as HTMLVideoElement).duration || 0)}
          onPlay={() => {
            setPlaying(true);
            setEnded(false);
            flashControls();
          }}
          onPause={() => {
            setPlaying(false);
            setShowControls(true);
            saveProgress(true);
          }}
          onWaiting={() => setBuffering(true)}
          onPlaying={() => setBuffering(false)}
          onCanPlay={() => setBuffering(false)}
          onEnded={() => {
            setEnded(true);
            setPlaying(false);
            saveProgress(true);
            if (nextUp) playNext();
          }}
          onError={(e) => {
            const v = e.currentTarget;
            if (v.error && v.error.code === MediaError.MEDIA_ERR_DECODE) {
              setAudioError(true);
            }
          }}
        >
          {subtitles.map((s) => (
            <track
              key={s.id}
              kind="subtitles"
              src={s.url}
              srcLang={s.language}
              label={s.label}
            />
          ))}
        </video>
      )}

      {buffering && source && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <Loader2 className="h-12 w-12 animate-spin text-white/80" />
        </div>
      )}

      {/* Audio decode hint — shown when the browser can't decode the audio track.
          Auto-switches to the transcoded stream (ffmpeg → AAC) so playback continues with sound. */}
      {audioError && !audioHintDismissed && (
        <div className="absolute inset-x-0 top-20 z-20 mx-auto max-w-md px-4">
          <div className="flex items-start gap-3 rounded-lg border border-amber-500/40 bg-black/90 p-3 text-sm text-white shadow-xl backdrop-blur">
            <VolumeX className="mt-0.5 h-5 w-5 shrink-0 text-amber-400" />
            <div className="flex-1">
              <p className="font-semibold text-amber-300">Switched to compatibility mode</p>
              <p className="mt-0.5 text-xs text-white/70">
                This file&apos;s audio codec (AC3/DTS/TrueHD) can&apos;t be decoded by the browser,
                so Lumina is now transcoding it to AAC via ffmpeg. Seeking is limited while transcoding.
                {!d?.streamUrl && !currentEpisode?.streamUrl && (
                  <> You can toggle back to direct mode in the settings menu.</>
                )}
              </p>
            </div>
            <button
              onClick={() => setAudioHintDismissed(true)}
              className="shrink-0 rounded-full p-1 text-white/60 hover:bg-white/10 hover:text-white"
              aria-label="Dismiss"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {ended && nextUp && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/70">
          <button
            onClick={playNext}
            className="inline-flex items-center gap-2 rounded-lg bg-white px-6 py-3 text-base font-bold text-black transition-transform hover:scale-105"
          >
            <SkipForward className="h-5 w-5 fill-current" />
            Next Episode
          </button>
        </div>
      )}

      {/* top bar */}
      <div
        className={cn(
          "absolute inset-x-0 top-0 z-10 flex items-center gap-3 bg-gradient-to-b from-black/80 to-transparent p-4 transition-opacity duration-300",
          showControls ? "opacity-100" : "opacity-0"
        )}
      >
        <button
          onClick={close}
          className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-black/40 text-white backdrop-blur transition-colors hover:bg-black/70"
          aria-label="Back"
        >
          <ChevronLeft className="h-6 w-6" />
        </button>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <div className="truncate text-sm font-semibold text-white sm:text-base">{titleText}</div>
            {transcode && (
              <span className="shrink-0 rounded bg-amber-500/20 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-amber-300">
                Compat
              </span>
            )}
          </div>
          {subText && <div className="truncate text-xs text-white/60">{subText}</div>}
        </div>
      </div>

      {!playing && !buffering && !ended && source && (
        <button
          onClick={togglePlay}
          className="absolute z-10 inline-flex h-16 w-16 items-center justify-center rounded-full bg-white/90 text-black shadow-2xl transition-transform hover:scale-110"
          aria-label="Play"
        >
          <Play className="ml-1 h-7 w-7 fill-current" />
        </button>
      )}

      {/* bottom controls */}
      <div
        className={cn(
          "absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-black/85 to-transparent px-4 pb-3 pt-10 transition-opacity duration-300",
          showControls ? "opacity-100" : "opacity-0"
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3">
          <span className="w-12 text-right text-xs font-medium tabular-nums text-white/80">
            {formatTimecode(current)}
          </span>
          <input
            type="range"
            className="lumina-range flex-1"
            min={0}
            max={duration || 0}
            step={0.1}
            value={Math.min(current, duration || 0)}
            onChange={(e) => seek(parseFloat(e.target.value))}
            aria-label="Seek"
          />
          <span className="w-12 text-xs font-medium tabular-nums text-white/80">
            {formatTimecode(duration)}
          </span>
        </div>

        <div className="mt-2 flex items-center gap-2">
          <CtrlButton onClick={togglePlay} label={playing ? "Pause" : "Play"}>
            {playing ? <Pause className="h-5 w-5 fill-current" /> : <Play className="h-5 w-5 fill-current" />}
          </CtrlButton>
          <CtrlButton onClick={() => seek(Math.max(0, current - 10))} label="Rewind 10s">
            <Rewind className="h-5 w-5" />
          </CtrlButton>
          <CtrlButton onClick={() => seek(Math.min(duration, current + 10))} label="Forward 10s">
            <FastForward className="h-5 w-5" />
          </CtrlButton>

          <div className="group/vol flex items-center gap-1">
            <CtrlButton
              onClick={() => {
                const v = videoRef.current;
                if (!v) return;
                setMuted((m) => {
                  v.muted = !m;
                  return !m;
                });
              }}
              label={muted ? "Unmute" : "Mute"}
            >
              {muted || volume === 0 ? <VolumeX className="h-5 w-5" /> : <Volume2 className="h-5 w-5" />}
            </CtrlButton>
            <input
              type="range"
              className="lumina-range w-0 opacity-0 transition-all group-hover/vol:w-20 group-hover/vol:opacity-100"
              min={0}
              max={1}
              step={0.05}
              value={muted ? 0 : volume}
              onChange={(e) => {
                const nv = parseFloat(e.target.value);
                setVolume(nv);
                setMuted(nv === 0);
                if (videoRef.current) {
                  videoRef.current.volume = nv;
                  videoRef.current.muted = nv === 0;
                }
              }}
              aria-label="Volume"
            />
          </div>

          {nextUp && (
            <CtrlButton onClick={playNext} label="Next episode">
              <SkipForward className="h-5 w-5" />
            </CtrlButton>
          )}

          <div className="ml-auto flex items-center gap-2">
            <div className="relative">
              <CtrlButton onClick={() => { setCcOpen(false); setRateOpen((o) => !o); }} label="Playback speed">
                <Settings className="h-5 w-5" />
              </CtrlButton>
              {rateOpen && (
                <div className="absolute bottom-12 right-0 w-44 rounded-lg border border-white/15 bg-black/90 p-1 backdrop-blur">
                  <div className="px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-white/40">
                    Playback speed
                  </div>
                  {RATES.map((r) => (
                    <button
                      key={r}
                      onClick={() => changeRate(r)}
                      className={cn(
                        "block w-full rounded px-3 py-1.5 text-left text-sm text-white/80 transition-colors hover:bg-white/10",
                        r === rate && "bg-white/10 font-semibold text-white"
                      )}
                    >
                      {r === 1 ? "Normal" : `${r}x`}
                    </button>
                  ))}
                  {/* Compatibility mode toggle (only for local files) */}
                  {!d?.streamUrl && !currentEpisode?.streamUrl && (
                    <>
                      <div className="my-1 border-t border-white/10" />
                      <button
                        onClick={() => {
                          setTranscode((t) => !t);
                          setRateOpen(false);
                        }}
                        className={cn(
                          "flex w-full items-center justify-between rounded px-3 py-1.5 text-left text-sm text-white/80 transition-colors hover:bg-white/10",
                          transcode && "bg-white/10 font-semibold text-white"
                        )}
                      >
                        <span>Compatibility</span>
                        <span className={cn("text-xs", transcode ? "text-primary" : "text-white/40")}>
                          {transcode ? "On" : "Off"}
                        </span>
                      </button>
                      <p className="px-2 py-1 text-[10px] leading-tight text-white/40">
                        Transcodes audio to AAC (fixes AC3/DTS). Seeking is limited.
                      </p>
                    </>
                  )}
                </div>
              )}
            </div>
            <span className="hidden text-xs font-medium text-white/60 sm:inline">
              {rate !== 1 ? `${rate}x` : "1x"}
            </span>

            {/* Subtitles / CC */}
            {subtitles.length > 0 && (
              <div className="relative">
                <CtrlButton
                  onClick={() => {
                    setRateOpen(false);
                    setCcOpen((o) => !o);
                  }}
                  label="Subtitles"
                >
                  <Captions className={cn("h-5 w-5", activeSubId && "text-primary")} />
                </CtrlButton>
                {ccOpen && (
                  <div className="absolute bottom-12 right-0 w-44 rounded-lg border border-white/15 bg-black/90 p-1 backdrop-blur">
                    <button
                      onClick={() => {
                        applySubtitle(null);
                        setCcOpen(false);
                      }}
                      className={cn(
                        "block w-full rounded px-3 py-1.5 text-left text-sm text-white/80 transition-colors hover:bg-white/10",
                        activeSubId === null && "bg-white/10 font-semibold text-white"
                      )}
                    >
                      Off
                    </button>
                    {subtitles.map((s) => (
                      <button
                        key={s.id}
                        onClick={() => {
                          applySubtitle(s.id);
                          setCcOpen(false);
                        }}
                        className={cn(
                          "block w-full rounded px-3 py-1.5 text-left text-sm text-white/80 transition-colors hover:bg-white/10",
                          activeSubId === s.id && "bg-white/10 font-semibold text-white"
                        )}
                      >
                        {s.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            <CtrlButton onClick={toggleFullscreen} label={fullscreen ? "Exit fullscreen" : "Fullscreen"}>
              {fullscreen ? <Minimize className="h-5 w-5" /> : <Maximize className="h-5 w-5" />}
            </CtrlButton>
          </div>
        </div>
      </div>
    </div>
  );
}

function CtrlButton({
  children,
  onClick,
  label,
}: {
  children: React.ReactNode;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className="inline-flex h-10 w-10 items-center justify-center rounded-full text-white/90 transition-colors hover:bg-white/15 hover:text-white"
      aria-label={label}
      title={label}
    >
      {children}
    </button>
  );
}
