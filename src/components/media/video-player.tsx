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
  Check,
  Square,
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
  const rateMenuRef = useRef<HTMLDivElement>(null);
  const ccMenuRef = useRef<HTMLDivElement>(null);

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
  // Subtitle appearance (Plex-style): size + background.
  const [subSize, setSubSize] = useState<"S" | "M" | "L">("M");
  const [subBg, setSubBg] = useState(true);
  // Buffered-ahead seconds (for the seekbar's buffered region).
  const [buffered, setBuffered] = useState(0);

  const d = detail.data;
  const closeMenus = useCallback(() => {
    setRateOpen(false);
    setCcOpen(false);
  }, []);

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

  // Direct-first: prefer the server's `directPlayable` verdict (accounts for
  // container/codec/audio + browser). Fall back to the legacy `browserCompatible`
  // flag if the verdict isn't present. User override always wins.
  const autoTranscode = probe.data
    ? probe.data.directPlayable === false || (!("directPlayable" in probe.data) && !probe.data.browserCompatible)
    : false;
  const transcode = transcodeOverride ?? autoTranscode;

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
    (force = false, traktEvent?: "start" | "pause" | "resume" | "stop") => {
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
          traktEvent,
          progressPct: Math.round((pos / dur) * 1000) / 10,
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

  const stopPlayback = () => {
    const v = videoRef.current;
    if (v) {
      v.pause();
      v.currentTime = 0;
    }
    saveProgress(true, "stop");
    close();
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

  // periodic save + scrobble "stop" when the player unmounts (closed)
  useEffect(() => {
    const t = setInterval(() => saveProgress(), 5000);
    return () => {
      clearInterval(t);
      saveProgress(true, "stop");
      qc.invalidateQueries({ queryKey: ["progress"] });
      qc.invalidateQueries({ queryKey: ["home"] });
      qc.invalidateQueries({ queryKey: ["media"], exact: false });
    };
  }, [saveProgress, qc]);

  useEffect(() => {
    const previousBodyOverflow = document.body.style.overflow;
    const previousHtmlOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousBodyOverflow;
      document.documentElement.style.overflow = previousHtmlOverflow;
    };
  }, []);

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
          if (rateOpen || ccOpen) {
            closeMenus();
            break;
          }
          if (!document.fullscreenElement) close();
          break;
        case "s":
          stopPlayback();
          break;
      }
      flashControls();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ccOpen, close, closeMenus, flashControls, rateOpen]);

  // fullscreen change
  useEffect(() => {
    const onFs = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);

  useEffect(() => {
    if (!rateOpen && !ccOpen) return;

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (rateMenuRef.current?.contains(target) || ccMenuRef.current?.contains(target)) return;
      closeMenus();
    };

    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      closeMenus();
    };

    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onEscape, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onEscape, true);
    };
  }, [ccOpen, closeMenus, rateOpen]);

  // Subtitle appearance — inject ::cue styling so size/background apply to the active track.
  useEffect(() => {
    const id = "lumina-cue-style";
    let el = document.getElementById(id) as HTMLStyleElement | null;
    if (!el) {
      el = document.createElement("style");
      el.id = id;
      document.head.appendChild(el);
    }
    const sizePx = subSize === "S" ? "18px" : subSize === "L" ? "32px" : "24px";
    const bg = subBg ? "rgba(0,0,0,0.7)" : "transparent";
    el.textContent = `video::cue { font-size: ${sizePx}; background: ${bg}; text-shadow: 0 1px 3px rgba(0,0,0,0.9); }`;
    return () => {
      // leave the style in place for the player's lifetime; cleanup on unmount of the session
    };
  }, [subSize, subBg]);

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
      className="fixed inset-0 z-50 flex items-center justify-center overflow-hidden bg-[radial-gradient(circle_at_50%_18%,rgba(12,26,45,0.58),transparent_36%),radial-gradient(circle_at_18%_100%,rgba(217,170,76,0.12),transparent_34%),linear-gradient(180deg,#08111d_0%,#030405_100%)] p-4 sm:p-6"
      onMouseMove={flashControls}
      onClick={(e) => {
        if (e.target === e.currentTarget || e.target === videoRef.current) togglePlay();
      }}
      role="dialog"
      aria-label="Video player"
    >
      <div
        className={cn(
          "relative flex items-center justify-center overflow-hidden bg-black transition-all duration-300",
          fullscreen
            ? "h-full w-full"
            : "h-[72vh] max-h-[860px] w-[min(94vw,1520px)] rounded-[28px] border border-white/10 shadow-[0_32px_120px_rgba(0,0,0,0.72),0_0_0_1px_rgba(244,216,139,0.11)]"
        )}
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
          onProgress={(e) => {
            const v = e.currentTarget;
            if (v.buffered.length > 0) setBuffered(v.buffered.end(v.buffered.length - 1));
          }}
          onPlay={() => {
            setPlaying(true);
            setEnded(false);
            flashControls();
            saveProgress(true, "start");
          }}
          onPause={() => {
            setPlaying(false);
            setShowControls(true);
            saveProgress(true, "pause");
          }}
          onWaiting={() => setBuffering(true)}
          onPlaying={() => setBuffering(false)}
          onCanPlay={() => setBuffering(false)}
          onEnded={() => {
            setEnded(true);
            setPlaying(false);
            saveProgress(true, "stop");
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
        <div className="absolute inset-x-0 top-5 z-20 mx-auto max-w-md px-4">
          <div className="flex items-start gap-3 rounded-2xl border border-amber-500/35 bg-black/72 p-3 text-sm text-white shadow-2xl backdrop-blur-xl">
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
          "absolute left-4 right-4 top-4 z-10 flex items-center gap-3 rounded-2xl border border-white/10 bg-black/28 p-3 shadow-[0_18px_48px_rgba(0,0,0,0.28)] backdrop-blur-xl transition-opacity duration-300",
          showControls ? "opacity-100" : "opacity-0"
        )}
      >
        <button
          onClick={close}
          className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-white/8 text-white backdrop-blur transition-colors hover:bg-white/16"
          aria-label="Back"
        >
          <ChevronLeft className="h-6 w-6" />
        </button>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <div className="truncate text-lg font-semibold text-white sm:text-2xl">{titleText}</div>
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
          className="absolute z-10 inline-flex h-16 w-16 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-[0_0_44px_rgba(245,182,42,0.32)] transition-transform hover:scale-110"
          aria-label="Play"
        >
          <Play className="ml-1 h-7 w-7 fill-current" />
        </button>
      )}

      {/* bottom controls */}
      <div
        className={cn(
          "absolute inset-x-3 bottom-3 z-10 transition-opacity duration-300 sm:inset-x-5 sm:bottom-5",
          showControls ? "opacity-100" : "opacity-0"
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="rounded-2xl border border-white/12 bg-black/58 px-3 py-3 shadow-[0_20px_80px_rgba(0,0,0,0.46)] backdrop-blur-2xl sm:px-4">
        {/* Seek bar — Plex-style: thin gold progress over a lighter buffered region. */}
        <div className="mb-1 flex items-center gap-3">
          <span className="w-12 shrink-0 text-right text-xs font-medium tabular-nums text-white/68">
            {formatTimecode(current)}
          </span>
          <PlexSeekbar
            current={current}
            duration={duration}
            buffered={buffered}
            onSeek={seek}
          />
          <span className="w-12 shrink-0 text-xs font-medium tabular-nums text-white/68">
            {formatTimecode(duration)}
          </span>
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-1.5 sm:flex-nowrap sm:gap-2">
          <CtrlButton onClick={togglePlay} label={playing ? "Pause" : "Play"}>
            {playing ? <Pause className="h-5 w-5 fill-current" /> : <Play className="h-5 w-5 fill-current" />}
          </CtrlButton>
          <CtrlButton onClick={stopPlayback} label="Stop">
            <Square className="h-[18px] w-[18px] fill-current" />
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
            <div ref={rateMenuRef} className="relative">
              <CtrlButton onClick={() => { setCcOpen(false); setRateOpen((o) => !o); }} label="Playback speed">
                <Settings className="h-5 w-5" />
              </CtrlButton>
              {rateOpen && (
                <div className="lumina-panel absolute bottom-12 right-0 z-30 w-52 rounded-lg p-2 backdrop-blur-md">
                  <div className="px-1 py-1 text-[10px] font-bold uppercase tracking-wider text-white/40">
                    Playback speed
                  </div>
                  {RATES.map((r) => (
                    <button
                      key={r}
                      onClick={() => changeRate(r)}
                      className={cn(
                        "flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-sm text-white/80 transition-colors hover:bg-white/10",
                        r === rate && "bg-white/10 font-semibold text-white"
                      )}
                    >
                      <span>{r === 1 ? "Normal" : `${r}x`}</span>
                      {r === rate && <Check className="h-3.5 w-3.5 text-primary" />}
                    </button>
                  ))}
                  {/* Compatibility mode toggle (only for local files) */}
                  {!d?.streamUrl && !currentEpisode?.streamUrl && (
                    <>
                      <div className="my-2 border-t border-white/10" />
                      <button
                        onClick={() => {
                          setTranscode(!transcode);
                          setRateOpen(false);
                        }}
                        className={cn(
                          "flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-sm text-white/80 transition-colors hover:bg-white/10",
                          transcode && "bg-white/10 font-semibold text-white"
                        )}
                      >
                        <span>Compatibility mode</span>
                        <span className={cn("text-xs", transcode ? "text-primary" : "text-white/40")}>
                          {transcode ? "On" : "Off"}
                        </span>
                      </button>
                      <p className="px-2 py-1 text-[10px] leading-tight text-white/40">
                        Remuxes/transcodes to a browser-friendly format when the file can't play directly (AC3/DTS audio, MKV). Seeking is limited while active.
                      </p>
                      {transcode && probe.data?.directPlayReason && (
                        <p className="px-2 pb-1 text-[10px] leading-tight text-amber-300/80">
                          Reason: {probe.data.directPlayReason}
                        </p>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
            <span className="hidden text-xs font-medium text-white/60 sm:inline">
              {rate !== 1 ? `${rate}x` : "1x"}
            </span>

            {/* Subtitles / CC */}
            <div ref={ccMenuRef} className="relative">
              <CtrlButton
                onClick={() => {
                  if (subtitles.length === 0) return;
                  setRateOpen(false);
                  setCcOpen((o) => !o);
                }}
                label={subtitles.length > 0 ? "Subtitles" : "No subtitles available"}
                disabled={subtitles.length === 0}
              >
                <Captions className={cn("h-5 w-5", activeSubId && "text-primary")} />
              </CtrlButton>
              {ccOpen && subtitles.length > 0 && (
                <div className="lumina-panel thin-scrollbar absolute bottom-12 right-0 z-30 max-h-[60vh] w-56 overflow-y-auto rounded-lg p-2 backdrop-blur-md">
                  <div className="mb-1 px-2 text-[10px] font-bold uppercase tracking-wider text-white/40">Subtitles</div>
                  <button
                    onClick={() => { applySubtitle(null); setCcOpen(false); }}
                    className={cn(
                      "flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-sm text-white/80 transition-colors hover:bg-white/10",
                      activeSubId === null && "bg-white/10 font-semibold text-white"
                    )}
                  >
                    Off
                    {activeSubId === null && <Check className="h-3.5 w-3.5 text-primary" />}
                  </button>
                  {subtitles.map((s) => (
                    <button
                      key={s.id}
                      onClick={() => { applySubtitle(s.id); setCcOpen(false); }}
                      className={cn(
                        "flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-sm text-white/80 transition-colors hover:bg-white/10",
                        activeSubId === s.id && "bg-white/10 font-semibold text-white"
                      )}
                    >
                      <span className="min-w-0">
                        <span className="block truncate">{s.label.replace(/\s*\(embedded\)\s*$/i, "")}</span>
                        <span className="block text-[10px] font-medium uppercase tracking-wide text-white/35">
                          {s.source === "embedded" ? "embedded" : "sidecar"}{s.format !== "vtt" ? ` · ${s.format}` : ""}
                        </span>
                      </span>
                      {activeSubId === s.id && <Check className="h-3.5 w-3.5 shrink-0 text-primary" />}
                    </button>
                  ))}
                  {/* Appearance */}
                  <div className="my-2 border-t border-white/10" />
                  <div className="mb-1 px-2 text-[10px] font-bold uppercase tracking-wider text-white/40">Size</div>
                  <div className="mb-2 flex gap-1 px-2">
                    {(["S", "M", "L"] as const).map((sz) => (
                      <button
                        key={sz}
                        onClick={() => setSubSize(sz)}
                        className={cn(
                          "flex-1 rounded py-1 text-xs font-semibold transition-colors",
                          subSize === sz ? "bg-primary text-black" : "bg-white/10 text-white/70 hover:bg-white/20"
                        )}
                      >
                        {sz}
                      </button>
                    ))}
                  </div>
                  <button
                    onClick={() => setSubBg((b) => !b)}
                    className="flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-sm text-white/80 hover:bg-white/10"
                  >
                    <span>Background</span>
                    <span className={cn("text-xs", subBg ? "text-primary" : "text-white/40")}>{subBg ? "On" : "Off"}</span>
                  </button>
                </div>
              )}
            </div>

            <CtrlButton onClick={toggleFullscreen} label={fullscreen ? "Exit fullscreen" : "Fullscreen"}>
              {fullscreen ? <Minimize className="h-5 w-5" /> : <Maximize className="h-5 w-5" />}
            </CtrlButton>
          </div>
        </div>
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
  disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="inline-flex h-10 w-10 items-center justify-center rounded-full text-white/88 transition-colors hover:bg-white/12 hover:text-[var(--lumina-gold-bright)] disabled:cursor-not-allowed disabled:text-white/28 disabled:hover:bg-transparent"
      aria-label={label}
      title={label}
    >
      {children}
    </button>
  );
}

/**
 * Plex-style seek bar: a thin gold progress fill sitting over a lighter
 * buffered-ahead region, with a larger thumb on hover. Click/drag to seek.
 * Keeps a hidden native range input for accessibility + keyboard arrow seeking.
 */
function PlexSeekbar({
  current,
  duration,
  buffered,
  onSeek,
}: {
  current: number;
  duration: number;
  buffered: number;
  onSeek: (t: number) => void;
}) {
  const [hovering, setHovering] = useState(false);
  const dur = duration || 0;
  const pct = dur > 0 ? Math.min(100, (current / dur) * 100) : 0;
  const bufPct = dur > 0 ? Math.min(100, (buffered / dur) * 100) : 0;

  return (
    <div
      className="group/seek relative flex h-6 flex-1 cursor-pointer items-center"
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
      onClick={(e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        const ratio = (e.clientX - rect.left) / rect.width;
        onSeek(Math.max(0, Math.min(dur, ratio * dur)));
      }}
    >
      {/* track */}
      <div className="relative h-1 w-full rounded-full bg-white/20 transition-all group-hover/seek:h-1.5">
        {/* buffered-ahead region */}
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-white/30"
          style={{ width: `${bufPct}%` }}
        />
        {/* gold progress */}
        <div
          className="absolute inset-y-0 left-0 rounded-full"
          style={{
            width: `${pct}%`,
            background: "var(--lumina-gold)",
            boxShadow: "0 0 8px rgba(245,182,42,0.5)",
          }}
        />
        {/* thumb */}
        <div
          className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow transition-transform"
          style={{ left: `${pct}%`, opacity: hovering ? 1 : 0, transform: `translate(-50%,-50%) scale(${hovering ? 1 : 0.6})` }}
        />
      </div>
      {/* accessible native input (transparent overlay for keyboard seeking) */}
      <input
        type="range"
        className="lumina-range absolute inset-0 h-full w-full cursor-pointer opacity-0"
        min={0}
        max={dur}
        step={0.1}
        value={Math.min(current, dur)}
        onChange={(e) => onSeek(parseFloat(e.target.value))}
        aria-label="Seek"
      />
    </div>
  );
}
