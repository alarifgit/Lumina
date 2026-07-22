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
  ChevronRight,
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
import {
  resolveAutoTranscodeStart,
  resolvePlaybackOffset,
  resolvePlaybackTimeline,
} from "@/lib/playback-progress";

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
  const [resumeOverride, setResumeOverride] = useState<number | null>(
    episodeIdParam != null ? startAt : null
  );
  const [timelineOffset, setTimelineOffset] = useState(startAt);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [rate, setRate] = useState(1);
  const [rateOpen, setRateOpen] = useState(false);
  const [settingsPage, setSettingsPage] = useState<"root" | "speed">("root");
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
  const resumeAt =
    resumeOverride ??
    (episodeIdParam == null && d?.type === "TV"
      ? d.playbackDecision?.target?.startAt ?? 0
      : startAt);
  // Generic show playback learns its resume point from the detail response,
  // after state initialisation. Keep the transcoded media clock anchored to
  // that server-selected offset until an explicit seek/quality change takes
  // ownership of the timeline.
  const resolvedTimelineOffset = resolvePlaybackOffset({
    resumeOverride,
    serverResumeAt: resumeAt,
    timelineOffset,
  });
  const closeMenus = useCallback(() => {
    setRateOpen(false);
    setSettingsPage("root");
    setCcOpen(false);
  }, []);

  const currentEpisode: Episode | null = useMemo(() => {
    if (!d) return null;
    if (d.type !== "TV") return null;
    const playableEpisodes = d.playableEpisodes ?? d.episodes;
    if (activeEpId) {
      const found = playableEpisodes.find((e) => e.id === activeEpId);
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
    const selectedEpisodeId = d.playbackDecision?.target?.episodeId;
    if (selectedEpisodeId) {
      return playableEpisodes.find((episode) => episode.id === selectedEpisodeId) ?? null;
    }
    return d.playbackDecision ? null : (d.nextEpisode ?? playableEpisodes[0] ?? null);
  }, [d, activeEpId]);

  // Subtitles for the currently-playing item (episode subs for TV, media subs for movies)
  const subtitles = currentEpisode?.subtitles ?? d?.subtitles ?? [];
  const trackSubtitles = subtitles.filter((subtitle) => subtitle.delivery === "track");
  const burnedSubtitle = subtitles.find(
    (subtitle) => subtitle.id === activeSubId && subtitle.delivery === "burn-in"
  );

  // Transcoding state.
  // `transcodeOverride` is null (auto), or a user's explicit choice (true/false).
  // The effective `transcode` value is: override if set, else auto-detected from probe.
  const [transcodeOverride, setTranscodeOverride] = useState<boolean | null>(null);
  const [preparedAutoTranscodeTarget, setPreparedAutoTranscodeTarget] = useState<
    string | null
  >(null);
  const probeTargetId =
    d?.type === "TV" ? currentEpisode?.id ?? null : d?.id ?? null;
  const probeKind: "media" | "episode" = currentEpisode ? "episode" : "media";
  const probe = useProbe(probeKind, probeTargetId, !!probeTargetId);

  // Direct-first: prefer the server's `directPlayable` verdict (accounts for
  // container/codec/audio + browser). Fall back to the legacy `browserCompatible`
  // flag if the verdict isn't present. User override always wins.
  const autoTranscode = probe.data
    ? probe.data.directPlayable === false || (!("directPlayable" in probe.data) && !probe.data.browserCompatible)
    : false;
  // Do not swap a playing direct source the instant an asynchronous probe
  // returns. First capture the current absolute clock, then start the
  // transcoded source from that point on the following render.
  const autoTranscodeReady =
    autoTranscode &&
    probeTargetId != null &&
    preparedAutoTranscodeTarget === probeTargetId;
  const transcode = transcodeOverride ?? autoTranscodeReady;

  useEffect(() => {
    if (
      transcodeOverride !== null ||
      !autoTranscode ||
      !probeTargetId ||
      preparedAutoTranscodeTarget === probeTargetId
    ) {
      return;
    }
    const frame = window.requestAnimationFrame(() => {
      const nextStart = resolveAutoTranscodeStart({
        currentTime: current,
        serverResumeAt: resumeAt,
      });
      setResumeOverride(nextStart);
      setTimelineOffset(nextStart);
      setPreparedAutoTranscodeTarget(probeTargetId);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [
    autoTranscode,
    current,
    preparedAutoTranscodeTarget,
    probeTargetId,
    resumeAt,
    transcodeOverride,
  ]);

  const setTranscode = (v: boolean) => {
    const nextStart = Math.max(0, current || resumeAt || 0);
    setTimelineOffset(v ? nextStart : 0);
    setResumeOverride(v ? nextStart : current || 0);
    setTranscodeOverride(v);
  };

  const expectedDuration = useMemo(() => {
    const probed = probe.data?.durationSeconds ?? 0;
    if (probed > 0) return probed;
    const runtime = currentEpisode?.runtime ?? d?.runtime ?? null;
    return runtime && runtime > 0 ? runtime * 60 : 0;
  }, [currentEpisode?.runtime, d?.runtime, probe.data?.durationSeconds]);

  const hasLocalTranscodeSource = transcode && !currentEpisode?.streamUrl && !d?.streamUrl;

  // Build the source URL. When transcoding, append ?transcode=1&t=<resumePos>
  // so ffmpeg starts at the resume position (seeking a live transcode isn't possible).
  const source = useMemo(() => {
    if (!d || (d.type === "TV" && !currentEpisode)) return null;
    const base = currentEpisode
      ? (currentEpisode.streamUrl ?? `/api/episodes/${currentEpisode.id}/stream`)
      : (d.streamUrl ?? `/api/media/${d.id}/stream`);
    if (!hasLocalTranscodeSource) return base;
    const sep = base.includes("?") ? "&" : "?";
    return `${base}${sep}transcode=1${resumeAt > 1 ? `&t=${Math.floor(resumeAt)}` : ""}${burnedSubtitle ? `&subtitleId=${encodeURIComponent(burnedSubtitle.id)}` : ""}`;
  }, [d, currentEpisode, hasLocalTranscodeSource, resumeAt, burnedSubtitle]);

  const nextUp = useMemo(() => {
    if (!d || d.type !== "TV" || !currentEpisode) return null;
    const playableEpisodes = d.playableEpisodes ?? d.episodes;
    const sameSequence = playableEpisodes.filter((episode) =>
      currentEpisode.seasonNumber === 0
        ? episode.seasonNumber === 0
        : episode.seasonNumber > 0
    );
    const idx = sameSequence.findIndex((episode) => episode.id === currentEpisode.id);
    if (idx >= 0 && idx < sameSequence.length - 1) return sameSequence[idx + 1];
    return null;
  }, [d, currentEpisode]);

  const saveProgress = useCallback(
    (force = false, traktEvent?: "start" | "pause" | "resume" | "stop") => {
      const v = videoRef.current;
      if (!v || !mediaId || !d) return;
      const timeline = resolvePlaybackTimeline({
        transcoded: hasLocalTranscodeSource,
        timelineOffset: resolvedTimelineOffset,
        currentTime: v.currentTime,
        mediaDuration: v.duration,
        probeDuration: probe.data?.durationSeconds,
        runtimeMinutes: currentEpisode?.runtime ?? d.runtime,
      });
      const pos = timeline.position;
      const dur = timeline.duration;
      if (dur <= 0) return;
      const now = Date.now();
      if (!force && now - lastSave.current < 4000) return;
      lastSave.current = now;
      const completed = timeline.completed;
      fetch("/api/progress", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mediaId,
          episodeId: d.type === "TV" ? currentEpisode?.id ?? activeEpId : null,
          position: pos,
          duration: dur,
          completed,
          traktEvent,
          progressPct: Math.round((pos / dur) * 1000) / 10,
        }),
        keepalive: true,
      }).catch(() => {});
    },
    [mediaId, d, activeEpId, currentEpisode?.id, currentEpisode?.runtime, hasLocalTranscodeSource, resolvedTimelineOffset, probe.data?.durationSeconds]
  );

  const togglePlay = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) v.play().catch(() => {});
    else v.pause();
  };

  const stopPlayback = () => {
    const v = videoRef.current;
    saveProgress(true, "stop");
    if (v) v.pause();
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

  const seek = useCallback(
    (val: number) => {
      const v = videoRef.current;
      if (!v) return;
      const target = Math.max(0, Math.min(duration || val, val));
      if (hasLocalTranscodeSource) {
        setResumeOverride(target);
        setTimelineOffset(target);
        setCurrent(target);
        setBuffered(target);
        setBuffering(true);
        return;
      }
      v.currentTime = target;
      setCurrent(target);
    },
    [duration, hasLocalTranscodeSource]
  );

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
          seek(Math.max(0, current - 10));
          break;
        case "ArrowRight":
          e.preventDefault();
          seek(Math.min(duration || current + 10, current + 10));
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
    const rawDuration = Number.isFinite(v.duration) ? v.duration : 0;
    const offset = hasLocalTranscodeSource ? resumeAt : 0;
    setTimelineOffset(offset);
    setDuration(expectedDuration || (hasLocalTranscodeSource ? offset + rawDuration : rawDuration));
    setCurrent(offset);
    setBuffered(offset);
    setBuffering(false);
    if (!hasLocalTranscodeSource && resumeAt > 0 && resumeAt < v.duration - 2) {
      v.currentTime = resumeAt;
    }
    v.volume = volume;
    v.playbackRate = rate;
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
    const selected = subtitles.find((subtitle) => subtitle.id === id) ?? null;
    const tracks = v.textTracks;
    for (let i = 0; i < tracks.length && i < trackSubtitles.length; i++) {
      tracks[i].mode = trackSubtitles[i].id === id ? "showing" : "disabled";
      if (trackSubtitles[i].id === id) {
        const keepCuesClearOfTransport = () => {
          const cues = tracks[i].cues;
          if (!cues) return;
          for (let cueIndex = 0; cueIndex < cues.length; cueIndex++) {
            const cue = cues[cueIndex];
            if (cue instanceof VTTCue && cue.snapToLines) cue.line = -7;
          }
        };
        keepCuesClearOfTransport();
        window.setTimeout(keepCuesClearOfTransport, 250);
      }
    }
    if (selected?.delivery === "burn-in" || burnedSubtitle) {
      const nextStart = Math.max(0, current || resumeAt || 0);
      setResumeOverride(nextStart);
      setTimelineOffset(nextStart);
      setTranscodeOverride(true);
    }
    setActiveSubId(id);
  };

  const changeRate = (r: number) => {
    setRate(r);
    if (videoRef.current) videoRef.current.playbackRate = r;
    setRateOpen(false);
  };

  const playNext = () => {
    if (nextUp) {
      setActiveEpId(nextUp.id);
      setResumeOverride(0);
      setTimelineOffset(0);
      setEnded(false);
      setCurrent(0);
      setBuffered(0);
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
      className={cn(
        "fixed inset-0 z-50 isolate flex items-center justify-center overflow-hidden bg-[#1b303b]",
        fullscreen ? "p-0" : "p-4 sm:p-6"
      )}
      onMouseMove={flashControls}
      onClick={(e) => {
        if (e.target === e.currentTarget || e.target === videoRef.current) togglePlay();
      }}
      role="dialog"
      aria-label="Video player"
    >
      {(currentEpisode?.stillUrl || d?.backdropUrl) && (
        <img
          src={currentEpisode?.stillUrl || d?.backdropUrl || ""}
          alt=""
          className="pointer-events-none absolute -inset-10 -z-10 h-[calc(100%+5rem)] w-[calc(100%+5rem)] scale-110 object-cover opacity-20 blur-3xl saturate-75"
        />
      )}
      <div className="pointer-events-none absolute inset-0 -z-10 bg-[linear-gradient(145deg,rgba(91,121,135,0.54),rgba(31,50,60,0.82)_54%,rgba(15,29,37,0.94))]" />
      <div
        className={cn(
          "relative flex items-center justify-center overflow-hidden bg-black transition-all duration-300",
          fullscreen
            ? "h-full w-full"
            : "h-[min(94vh,1240px)] w-[min(96vw,2400px)] rounded-lg ring-1 ring-white/18 shadow-[inset_0_1px_0_rgba(255,255,255,0.12),0_34px_120px_rgba(10,26,34,0.62)]"
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
          onTimeUpdate={(e) => {
            const v = e.target as HTMLVideoElement;
            setCurrent(hasLocalTranscodeSource ? resolvedTimelineOffset + (v.currentTime || 0) : v.currentTime || 0);
          }}
          onDurationChange={(e) => {
            const rawDuration = Number.isFinite(e.currentTarget.duration) ? e.currentTarget.duration : 0;
            setDuration(expectedDuration || (hasLocalTranscodeSource ? resolvedTimelineOffset + rawDuration : rawDuration));
          }}
          onProgress={(e) => {
            const v = e.currentTarget;
            if (v.buffered.length > 0) {
              const rawBuffered = v.buffered.end(v.buffered.length - 1);
              const nextBuffered = hasLocalTranscodeSource ? resolvedTimelineOffset + rawBuffered : rawBuffered;
              setBuffered(Math.min(duration || nextBuffered, nextBuffered));
            }
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
          {trackSubtitles.map((s) => (
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
          <div className="flex items-start gap-3 rounded-lg border border-white/16 bg-[#1b303b]/88 p-3 text-sm text-white shadow-2xl backdrop-blur-2xl">
            <VolumeX className="mt-0.5 h-5 w-5 shrink-0 text-amber-400" />
            <div className="flex-1">
              <p className="font-semibold text-amber-300">Switched to compatibility mode</p>
              <p className="mt-0.5 text-xs text-white/70">
                This file&apos;s audio codec (AC3/DTS/TrueHD) can&apos;t be decoded by the browser,
                so Lumina is now transcoding it to AAC via ffmpeg. Seeking restarts the stream at the selected time.
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

      <div
        className={cn(
          "pointer-events-none absolute inset-x-0 top-0 z-[5] h-40 bg-gradient-to-b from-[#071720]/78 via-[#071720]/26 to-transparent transition-opacity duration-300",
          showControls ? "opacity-100" : "opacity-0"
        )}
      />

      {/* Quiet title overlay: the film remains the dominant surface. */}
      <div
        className={cn(
          "absolute left-5 right-5 top-5 z-10 flex items-center gap-3 transition-opacity duration-300 sm:left-7 sm:right-7 sm:top-7",
          showControls ? "opacity-100" : "pointer-events-none opacity-0"
        )}
      >
        <button
          onClick={close}
          className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/14 bg-[#294553]/48 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.12)] backdrop-blur-xl transition-colors hover:bg-white/16"
          aria-label="Back"
        >
          <ChevronLeft className="h-6 w-6" />
        </button>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <div className="truncate text-lg font-semibold tracking-[-0.02em] text-white sm:text-xl">{titleText}</div>
            {transcode && (
              <span className="shrink-0 rounded border border-white/12 bg-white/10 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-primary">
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
          className="absolute z-10 inline-flex h-16 w-16 items-center justify-center rounded-full border border-white/18 bg-[var(--lumina-ink)] text-white shadow-[0_16px_46px_rgba(7,23,32,0.40)] transition-transform duration-200 hover:scale-105 active:scale-95"
          aria-label="Play"
        >
          <Play className="ml-1 h-7 w-7 fill-current" />
        </button>
      )}

      {/* bottom controls */}
      <div
        className={cn(
          "absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-[#071720]/96 via-[#071720]/68 to-transparent px-5 pb-5 pt-16 transition-opacity duration-300 sm:px-7 sm:pb-7 sm:pt-20",
          showControls ? "opacity-100" : "pointer-events-none opacity-0"
        )}
        onClick={(e) => e.stopPropagation()}
      >
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

        <div className="mt-2 grid grid-cols-[1fr_auto_1fr] items-center gap-1 sm:gap-3">
          <div className="group/vol hidden min-w-0 items-center gap-1 justify-self-start pl-10 md:flex">
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

          <div className="flex items-center justify-center gap-0.5 sm:gap-1">
            <CtrlButton onClick={() => seek(Math.max(0, current - 10))} label="Rewind 10 seconds">
              <Rewind className="h-5 w-5" />
            </CtrlButton>
            <CtrlButton onClick={togglePlay} label={playing ? "Pause" : "Play"} emphasis>
              {playing ? <Pause className="h-5 w-5 fill-current" /> : <Play className="ml-0.5 h-5 w-5 fill-current" />}
            </CtrlButton>
            <CtrlButton onClick={() => seek(Math.min(duration, current + 10))} label="Forward 10 seconds">
              <FastForward className="h-5 w-5" />
            </CtrlButton>
            {nextUp && (
              <CtrlButton onClick={playNext} label="Next episode">
                <SkipForward className="h-5 w-5" />
              </CtrlButton>
            )}
            <span className="hidden sm:inline-flex">
              <CtrlButton onClick={stopPlayback} label="Stop playback">
                <Square className="h-4 w-4 fill-current" />
              </CtrlButton>
            </span>
          </div>

          <div className="flex items-center justify-self-end gap-0.5 sm:gap-1">
            <div ref={rateMenuRef} className="relative">
              <CtrlButton
                onClick={() => {
                  setCcOpen(false);
                  setSettingsPage("root");
                  setRateOpen((open) => !open);
                }}
                label="Player settings"
              >
                <Settings className="h-5 w-5" />
              </CtrlButton>
              {rateOpen && (
                <div className="!absolute bottom-12 right-0 z-30 w-64 overflow-hidden rounded-lg border border-white/16 bg-[#1b303b]/92 p-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.10),0_22px_54px_rgba(7,23,32,0.44)] backdrop-blur-2xl">
                  {settingsPage === "root" ? (
                    <>
                      <div className="px-2 py-1.5 text-[10px] font-bold uppercase tracking-wider text-white/45">
                        Settings
                      </div>
                      <button
                        onClick={() => setSettingsPage("speed")}
                        className="flex w-full items-center justify-between rounded px-2 py-2 text-left text-sm text-white/85 transition-colors hover:bg-white/10"
                      >
                        <span>Playback speed</span>
                        <span className="flex items-center gap-1 text-xs text-white/50">
                          {rate === 1 ? "Normal" : `${rate}x`}
                          <ChevronRight className="h-4 w-4" />
                        </span>
                      </button>
                      {!d?.streamUrl && !currentEpisode?.streamUrl && (
                        <>
                          <div className="my-1 border-t border-white/10" />
                          <button
                            onClick={() => setTranscode(!transcode)}
                            className="flex w-full items-center justify-between rounded px-2 py-2 text-left text-sm text-white/85 transition-colors hover:bg-white/10"
                          >
                            <span>Compatibility mode</span>
                            <span className={cn("text-xs", transcode ? "text-primary" : "text-white/45")}>
                              {transcode ? "On" : "Auto"}
                            </span>
                          </button>
                          {probe.data?.directPlayReason && (
                            <p className="px-2 pb-1 text-[10px] leading-4 text-white/40">
                              {probe.data.directPlayReason}
                            </p>
                          )}
                        </>
                      )}
                    </>
                  ) : (
                    <>
                      <button
                        onClick={() => setSettingsPage("root")}
                        className="mb-1 flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm font-semibold text-white hover:bg-white/10"
                      >
                        <ChevronLeft className="h-4 w-4" /> Playback speed
                      </button>
                      {RATES.map((option) => (
                        <button
                          key={option}
                          onClick={() => changeRate(option)}
                          className={cn(
                            "flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-sm text-white/80 transition-colors hover:bg-white/10",
                            option === rate && "bg-white/10 font-semibold text-white"
                          )}
                        >
                          <span>{option === 1 ? "Normal" : `${option}x`}</span>
                          {option === rate && <Check className="h-3.5 w-3.5 text-primary" />}
                        </button>
                      ))}
                    </>
                  )}
                </div>
              )}
            </div>
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
                <div className="thin-scrollbar !absolute bottom-12 right-0 z-30 max-h-[60vh] w-56 overflow-y-auto rounded-lg border border-white/16 bg-[#1b303b]/92 p-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.10),0_22px_54px_rgba(7,23,32,0.44)] backdrop-blur-2xl">
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
                          {s.source === "embedded" ? "embedded" : "sidecar"}{s.delivery === "burn-in" ? " · burn-in" : s.format !== "vtt" ? ` · ${s.format}` : ""}
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
  );
}

function CtrlButton({
  children,
  onClick,
  label,
  disabled,
  emphasis = false,
}: {
  children: React.ReactNode;
  onClick: () => void;
  label: string;
  disabled?: boolean;
  emphasis?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-white/88 transition-[color,background-color,transform] duration-200 hover:bg-white/12 hover:text-white active:scale-95 disabled:cursor-not-allowed disabled:text-white/28 disabled:hover:bg-transparent",
        emphasis && "h-11 w-11 border border-white/16 bg-[var(--lumina-ink)] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_8px_24px_rgba(7,23,32,0.30)] hover:bg-[#102a37]"
      )}
      aria-label={label}
      title={label}
    >
      {children}
    </button>
  );
}

/**
 * A thin gold progress fill sitting over a lighter
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
            boxShadow: "none",
          }}
        />
        {/* thumb */}
        <div
          className="absolute top-1/2 h-3 w-3 rounded-full bg-white shadow transition-transform"
          style={{
            left: `${pct}%`,
            opacity: hovering ? 1 : 0,
            transform: `translate3d(-50%, -50%, 0) scale(${hovering ? 1 : 0.6})`,
          }}
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
