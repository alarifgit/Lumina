/* Lumina web client — browse + smart playback + watch state + subtitles.
 *
 * Playback:
 *   - ffprobe decides direct play vs transcode; runtime failure of a
 *     direct attempt falls back to HLS automatically.
 *   - HLS runs in SESSIONS keyed by start offset (restart-on-seek):
 *     seeking beyond produced segments restarts FFmpeg with -ss at the
 *     absolute target. video.currentTime is session-relative; all
 *     playhead reporting converts back to absolute time.
 *
 * Watch state: append-only journal server-side, keyed by content-hash
 * identity. Reported every 10s / on pause / on close.
 *
 * Visual design (procedural posters, hue palette, grain, watermark)
 * adapted from lumina_badattempt's ProceduralPoster + media-utils —
 * the salvageable parts of that codebase, per the project README.
 */

const grid = document.getElementById("grid");
const nav = document.getElementById("libraries");
const userBadge = document.getElementById("user-badge");
const overlay = document.getElementById("player-overlay");
const video = document.getElementById("video");
const playerTitle = document.getElementById("player-title");
const playerMode = document.getElementById("player-mode");
const mediaInfoJson = document.getElementById("media-info-json");
const forceTranscode = document.getElementById("force-transcode");
const ccSelect = document.getElementById("cc-select");
const pcPlay = document.getElementById("pc-play");
const pcBack = document.getElementById("pc-back");
const pcFwd = document.getElementById("pc-fwd");
const pcTimeCurrent = document.getElementById("pc-time-current");
const pcTimeTotal = document.getElementById("pc-time-total");
const pcRate = document.getElementById("pc-rate");
const pcVolume = document.getElementById("pc-volume");
const pcFull = document.getElementById("pc-full");
const pcNext = document.getElementById("pc-next");
const ccOpts = document.getElementById("cc-opts");
const ccPop = document.getElementById("cc-pop");
const playerSpinner = document.getElementById("player-spinner");
const upNext = document.getElementById("up-next");
const upNextTitle = document.getElementById("up-next-title");
const upNextCount = document.getElementById("up-next-count");
const seekBar = document.getElementById("seek-bar");
const seekPlayed = document.getElementById("seek-played");
const seekBuffered = document.getElementById("seek-buffered");
const headerEl = document.querySelector("header");

window.addEventListener("scroll", () => {
  headerEl.classList.toggle("solid", window.scrollY > 12);
}, { passive: true });

const REPORT_INTERVAL_MS = 10_000;
const RESUME_MIN_S = 5;
const WATCHED_FRACTION = 0.92;

let currentHls = null;
let currentItem = null;
let currentUser = null;
let users = [];
let playheads = {};
let myListIds = {}; // per-user bookmarks ("My List"), item id → true
let heroTimer = null; // home hero carousel auto-advance
let nextEp = null;    // next episode in order, for pc-next + "Up next"
let upNextTimer = null;
let upNextCountdown = null;
let lastReportAt = 0;
let resumeAtS = 0;
let activeLib = null;

// Every rendered item, by id — the context menu looks items up here
// instead of re-fetching.
const itemById = new Map();
// The last home-view item set, so the nav (which can finish loading after
// the home view at boot) can catch up its badge counts.
let lastVisibleItems = [];

// Transcode-session timeline state.
let isHls = false;
let sessionOffsetS = 0;     // absolute time at which the HLS session starts
let absoluteDurationS = 0;  // from ffprobe (video.duration is session-relative)
let seekRestartTimer = null;
// Quality ladder rung ("original" | "1080p" | "720p" | "480p"). Persisted:
// a user on a slow link shouldn't have to re-pick it every episode.
let currentQuality = localStorage.getItem("lumina-quality") || "original";
const pcQuality = document.getElementById("pc-quality");
pcQuality.value = currentQuality;

// Container gate uses the FILE EXTENSION, not ffprobe's format_name:
// ffprobe reports MKV as "matroska,webm", so a substring match waves
// every MKV through as if it were a WebM — browsers then get raw MKV
// streams they may demux but not fully decode (silent AC3, dead AV1).
const DIRECT_EXTS = ["mp4", "m4v", "mov", "webm"];
// Codec gates reflect what THIS browser can actually decode, not a fixed
// allowlist: Edge/Safari (and Chrome with platform HEVC) direct-play HEVC
// and AC-3/E-AC-3; probing canPlayType with real codec strings tells us.
const CAN_HEVC = video.canPlayType('video/mp4; codecs="hvc1.1.6.L93.B0"') !== "";
const CAN_AC3 = video.canPlayType('audio/mp4; codecs="ac-3"') !== "";
const CAN_EAC3 = video.canPlayType('audio/mp4; codecs="ec-3"') !== "";
const DIRECT_VIDEO = ["h264", "vp8", "vp9", "av1", ...(CAN_HEVC ? ["hevc"] : [])];
// DTS/TrueHD never direct-play: they fail SILENTLY (video plays, no audio)
// which doesn't trigger the onerror → HLS fallback. AC-3/E-AC-3 join only
// when the browser proves support; otherwise transcode, where FFmpeg
// outputs AAC.
const DIRECT_AUDIO = ["aac", "mp3", "opus", "vorbis", "flac",
  ...(CAN_AC3 ? ["ac3"] : []), ...(CAN_EAC3 ? ["eac3"] : [])];

async function api(path, opts = {}) {
  // A wedged server must never leave the UI sitting on "Saving…" forever.
  // Long calls (season-walking episode metadata) pass opts.timeoutMs.
  const { timeoutMs, ...fetchOpts } = opts;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs || 20000);
  try {
    const res = await fetch(path, { ...fetchOpts, signal: ctrl.signal });
    if (res.status === 204) return null;
    if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
    return res.json();
  } catch (e) {
    if (e.name === "AbortError") throw new Error("server took too long to respond — check docker logs");
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

// --- procedural posters (ported from badattempt's media-utils.ts) ------------

function hashString(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

function hueForTitle(title) { return 20 + (hashString(title) % 60); }

function posterStyle(title) {
  const h = hueForTitle(title);
  const c1 = `hsl(${h} 38% 14%)`;
  const c2 = `hsl(${(h + 24) % 360} 30% 22%)`;
  const c3 = `hsl(${(h + 340) % 360} 45% 8%)`;
  return `background: linear-gradient(155deg, ${c2} 0%, ${c1} 48%, ${c3} 100%);`;
}

function glowStyle(title) {
  const h = hueForTitle(title);
  return `background: radial-gradient(circle at 50% 30%, hsl(${h} 70% 75% / 0.35), transparent 60%);`;
}

function posterInitials(title) {
  const words = title.replace(/[^a-zA-Z0-9 ]/g, "").split(/\s+/).filter(Boolean);
  if (words.length === 0) return "•";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

function fmtBytes(n) {
  const u = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(1)} ${u[i]}`;
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

// --- users -------------------------------------------------------------------

async function loadUsers() {
  users = await api("/api/v1/users");
  const saved = localStorage.getItem("lumina.user");
  currentUser = users.find((u) => u.id === saved) || users[0];
  renderUserBadge();
}

function renderUserBadge() {
  if (!currentUser) return;
  userBadge.innerHTML = `<span class="ic ic-user"></span> ${escapeHtml(currentUser.name)}`;
  localStorage.setItem("lumina.user", currentUser.id);
}

userBadge.onclick = () => {
  if (users.length < 2) return;
  const i = users.findIndex((u) => u.id === currentUser.id);
  currentUser = users[(i + 1) % users.length];
  renderUserBadge();
  refreshCurrentView();
};

// --- browse --------------------------------------------------------------------

function setActiveNav(btn) {
  nav.querySelectorAll("button").forEach((b) => b.classList.remove("active"));
  btn.classList.add("active");
  moveNavGlider();
}

// Segmented-control glider: the frosted pill that slides under the active
// nav segment. Recomputed whenever segments change or the window resizes.
function moveNavGlider() {
  const glider = nav.querySelector(".seg-glider");
  if (!glider) return;
  const active = nav.querySelector("button.active");
  if (!active) {
    glider.style.opacity = "0";
    return;
  }
  glider.style.opacity = "1";
  // Movement animates via transform (no layout thrash); width snaps to the
  // new segment — the slide makes the snap imperceptible.
  glider.style.width = `${active.offsetWidth}px`;
  glider.style.transform = `translateX(${active.offsetLeft}px)`;
}
window.addEventListener("resize", moveNavGlider);

async function loadLibraries() {
  const libs = await api("/api/v1/libraries");
  nav.innerHTML = '<span class="seg-glider"></span>';

  const homeBtn = document.createElement("button");
  homeBtn.textContent = "Home";
  homeBtn.onclick = () => {
    setActiveNav(homeBtn);
    loadHome();
  };
  nav.appendChild(homeBtn);

  for (const lib of libs) {
    const btn = document.createElement("button");
    btn.textContent = `${lib.name} (${lib.items})`;
    btn.title = `${lib.path} — watcher: ${lib.watcher}`;
    // loadHome() rewrites the count once items are known: TV libraries show
    // a SERIES count (Plex-style), not raw episode files.
    btn.dataset.lib = lib.name;
    btn.dataset.kind = lib.kind || "movies";
    btn.onclick = () => {
      setActiveNav(btn);
      loadItems(lib);
    };
    nav.appendChild(btn);
  }

  // "My List" — per-user bookmarks, always the last segment.
  const mlBtn = document.createElement("button");
  mlBtn.textContent = "My List";
  mlBtn.title = "Titles you bookmarked (right-click any card → Add to My List)";
  mlBtn.dataset.kind = "mylist";
  mlBtn.onclick = () => {
    setActiveNav(mlBtn);
    loadMyList();
  };
  nav.appendChild(mlBtn);

  // Home is the default active segment; loadHome() runs in parallel at
  // boot, so no synthetic click here (a click would double-fetch).
  setActiveNav(homeBtn);
  // Buttons just materialized — if loadHome already has items, the counts
  // (and the glider) catch up now instead of waiting for the next visit.
  if (lastVisibleItems.length > 0) updateNavCounts(lastVisibleItems);
}

async function loadItems(lib) {
  activeLib = lib;
  backTarget = () => loadItems(lib); // detail pages return to this library
  closeSettings();
  closeSearch();
  const [items, phs, ml] = await Promise.all([
    api(`/api/v1/items?library=${encodeURIComponent(lib.name)}`),
    currentUser ? api(`/api/v1/users/${currentUser.id}/playheads`) : {},
    currentUser ? api(`/api/v1/users/${currentUser.id}/mylist`) : {},
  ]);
  playheads = phs || {};
  myListIds = ml || {};
  // Mutate the grid only once the data has arrived (anti-flash).
  grid.className = "";
  grid.innerHTML = "";
  const visible = (items || []).filter((it) => it.state !== "missing");
  if (visible.length === 0) {
    grid.innerHTML = `<div id="empty">Nothing here yet — Lumina is scanning, or the path is empty.</div>`;
    return;
  }
  visible.forEach((it) => itemById.set(it.id, it));
  renderLibraryCards(visible);
}

// Shared card renderer for the library + My List views: episodes group into
// one card per series (Plex library view), everything else gets a movie card.
function renderLibraryCards(visible) {
  const episodes = visible.filter((it) => it.kind === "episode");
  const others = visible.filter((it) => it.kind !== "episode");

  if (episodes.length > 0) {
    // One card per series (Plex library view), not a wall of episode files.
    const groups = new Map();
    for (const it of episodes) {
      const k = seriesKey(it);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(it);
    }
    const series = [...groups.entries()].map(([key, eps]) => {
      eps.sort(compareSE);
      const rep = eps.find((e) => e.posterUrl) || eps[0];
      const seasonCount = new Set(eps.map((e) => (episodeSE(e) || { s: 0 }).s)).size;
      const unwatched = eps.filter((e) => !(playheads[e.id] && playheads[e.id].watched)).length;
      return { key, eps, rep, seasonCount, unwatched };
    }).sort((a, b) => a.key.localeCompare(b.key));

    for (const g of series) {
      const identified = !!g.rep.posterUrl;
      const card = document.createElement("div");
      card.className = "card";
      card.innerHTML = `
        <div class="poster" style="${posterStyle(g.key)}">
          ${identified ? "" : `<div class="glow" style="${glowStyle(g.key)}"></div><div class="grain"></div>`}
          ${identified
            ? `<img class="poster-img" src="${g.rep.posterUrl}" loading="lazy" alt=""
                 onerror="this.remove()">`
            : `<span class="initials">${posterInitials(g.key)}</span>
               <span class="poster-title">${escapeHtml(g.key)}</span>`}
          <button class="card-play" aria-label="Play next episode" title="Play next episode"><span class="ic ic-play"></span></button>
          <span class="watermark">LUMINA</span>
          ${g.unwatched > 0 ? `<span class="count-badge lib-badge">${g.unwatched}</span>` : ""}
        </div>
        <div class="meta">
          <div class="title" title="${escapeHtml(g.key)}">${escapeHtml(g.key)}</div>
          <div class="sub">${g.eps.length} episode${g.eps.length === 1 ? "" : "s"}${g.seasonCount > 1 ? ` · ${g.seasonCount} seasons` : ""}</div>
        </div>`;
      card.querySelector(".card-play").onclick = (e) => {
        e.stopPropagation();
        play(nextEpisode(g.eps));
      };
      card.onclick = () => openSeries(g.key, g.rep);
      card.dataset.id = g.rep.id;
      grid.appendChild(card);
    }
  }

  for (const it of others) {
    const ph = playheads[it.id];
    const pct = ph && ph.durationMs > 0
      ? Math.min(100, (ph.positionMs / ph.durationMs) * 100) : 0;
    const identified = !!it.posterUrl;
    const card = document.createElement("div");
    card.className = "card";
    card.innerHTML = `
      <div class="poster" style="${posterStyle(it.title)}">
        ${identified ? "" : `<div class="glow" style="${glowStyle(it.title)}"></div><div class="grain"></div>`}
        ${identified
          ? `<img class="poster-img" src="${it.posterUrl}" loading="lazy" alt=""
               onerror="this.remove()">`
          : `<span class="initials">${posterInitials(it.title)}</span>
             <span class="poster-title">${it.title}</span>`}
        <button class="card-play" aria-label="Play" title="Play"><span class="ic ic-play"></span></button>
        <span class="watermark">LUMINA</span>
        ${ph && ph.watched ? `<span class="watched" title="Watched"><span class="ic ic-check"></span></span>` : ""}
        ${pct > 0 && !(ph && ph.watched)
          ? `<div class="progress"><div class="progress-fill" style="width:${pct}%"></div></div>`
          : ""}
      </div>
      <div class="meta">
        <div class="title" title="${it.title}">${it.title}</div>
        <div class="sub">${it.year ? it.year + " · " : ""}${fmtBytes(it.sizeBytes)}</div>
      </div>`;
    card.querySelector(".card-play").onclick = (e) => {
      e.stopPropagation();
      play(it);
    };
    card.onclick = () => openMovieDetail(it);
    card.dataset.id = it.id;
    grid.appendChild(card);
  }
}

// --- My List (per-user bookmarks) -------------------------------------------

async function loadMyList() {
  activeLib = { name: "My List", kind: "mylist" };
  backTarget = loadMyList;
  closeSettings();
  closeSearch();
  const [items, phs, ml] = await Promise.all([
    api("/api/v1/items"),
    currentUser ? api(`/api/v1/users/${currentUser.id}/playheads`) : {},
    currentUser ? api(`/api/v1/users/${currentUser.id}/mylist`) : {},
  ]);
  playheads = phs || {};
  myListIds = ml || {};
  // Mutate the grid only once the data has arrived (anti-flash).
  grid.className = "";
  grid.innerHTML = "";
  const visible = (items || []).filter((it) => it.state !== "missing");
  visible.forEach((it) => itemById.set(it.id, it));
  const mine = visible.filter((it) => myListIds[it.id]);
  if (mine.length === 0) {
    grid.innerHTML = `<div id="empty">Nothing bookmarked yet — right-click any card → Add to My List.</div>`;
    return;
  }
  renderLibraryCards(mine);
}

async function toggleMyList(it) {
  if (!currentUser) {
    toast("Pick a user first", "err");
    return;
  }
  try {
    const r = await api(`/api/v1/items/${it.id}/mylist`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: currentUser.id }),
    });
    if (r.added) myListIds[it.id] = true;
    else delete myListIds[it.id];
    toast(r.added ? "Added to My List" : "Removed from My List");
    if (activeLib && activeLib.kind === "mylist") loadMyList(); // live update
  } catch (e) {
    toast(e.message, "err");
  }
}

// --- home (artwork-led cover + rails) ---------------------------------------------

function fmtLeftMs(ph) {
  if (!ph || !ph.durationMs) return "";
  const leftMs = Math.max(0, ph.durationMs - ph.positionMs);
  const mins = Math.round(leftMs / 60000);
  if (mins >= 60) return `${Math.floor(mins / 60)}h ${mins % 60}m left`;
  return `${mins}m left`;
}

function artHtml(it, prefer = "poster") {
  const url = prefer === "backdrop"
    ? (it.backdropUrl || it.posterUrl)
    : (it.posterUrl || it.backdropUrl);
  const fallback = `<div class="proc-fallback" style="${posterStyle(it.title)}">${posterInitials(it.title)}</div>`;
  return url
    ? `${fallback}<img src="${url}" loading="lazy" alt="" onerror="this.remove()">`
    : fallback;
}

function homeCard(it, ph, poster = false, label = null) {
  const pct = ph && ph.durationMs > 0
    ? Math.min(100, (ph.positionMs / ph.durationMs) * 100) : 0;
  const left = fmtLeftMs(ph);
  const sub = label && label.sub
    ? label.sub
    : ph && !ph.watched
      ? [left, it.year].filter(Boolean).join(" · ")
      : [it.year, fmtBytes(it.sizeBytes)].filter(Boolean).join(" · ");
  const title = label && label.title ? label.title : it.title;
  return `
    <figure class="media-card" data-id="${it.id}">
      <div class="thumb">
        ${artHtml(it, poster ? "poster" : "backdrop")}
        <button class="card-play" aria-label="Play" title="Play"><span class="ic ic-play"></span></button>
        ${pct > 0 && !(ph && ph.watched) ? `<div class="progress-line"><i style="width:${pct}%"></i></div>` : ""}
        ${label && label.badge ? `<span class="count-badge">${escapeHtml(label.badge)}</span>` : ""}
      </div>
      <figcaption>
        <span class="t" title="${escapeHtml(title)}">${escapeHtml(title)}</span>
        <span class="s">${escapeHtml(sub)}</span>
      </figcaption>
    </figure>`;
}

// Plex behaviour: Recently Added TV shows one card per series, not a wall of
// identical posters for every new episode. Episodes carry SxxExx in the
// title (scanner-side parse), so group on the prefix before that marker.
const SERIES_RE = /\s*[-–—.:]?\s*[Ss](\d{1,3})[Ee](\d{1,4})\b/;
// Absolute-numbered anime displays as "Bleach E362 · …" — group those too.
const ABS_EP_RE = /\s*[-–—.:]?\s*[Ee](\d{1,4})\b/;

function seriesKey(it) {
  const m = it.title.match(SERIES_RE) || it.title.match(ABS_EP_RE);
  if (!m || m.index === 0) return it.title;
  return it.title.slice(0, m.index).replace(/[\s\-–—.:]+$/, "") || it.title;
}

function episodeSE(it) {
  const m = it.title.match(SERIES_RE);
  if (m) return { s: +m[1], e: +m[2] };
  const a = it.title.match(ABS_EP_RE);
  return a ? { s: 0, e: +a[1] } : null;
}

// Group episodes (already sorted newest-first) into one entry per series.
function groupBySeries(episodes) {
  const groups = new Map();
  for (const it of episodes) {
    const k = seriesKey(it);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(it);
  }
  return [...groups.entries()].map(([name, eps]) => {
    let sMax = 0, eMax = 0;
    for (const it of eps) {
      const se = episodeSE(it);
      if (se && (se.s > sMax || (se.s === sMax && se.e > eMax))) {
        sMax = se.s; eMax = se.e;
      }
    }
    const latest = sMax > 0 ? `S${sMax}E${eMax}` : (eMax > 0 ? `E${eMax}` : "");
    const sub = eps.length > 1
      ? [latest && `up to ${latest}`, `${eps.length} new`].filter(Boolean).join(" · ")
      : latest;
    return { rep: eps[0], label: { title: name, sub, badge: eps.length > 1 ? `${eps.length}` : "" } };
  });
}

// --- detail pages (series drill-down + movie page) --------------------------------
// The card contract: the ▶ badge plays immediately; the card body opens a
// detail page. Episodes drill into their series; movies open a movie page.

let backTarget = null; // set by loadHome/loadItems; detail pages return here

function compareSE(a, b) {
  const sa = episodeSE(a) || { s: 0, e: 0 };
  const sb = episodeSE(b) || { s: 0, e: 0 };
  return sa.s - sb.s || sa.e - sb.e || a.title.localeCompare(b.title);
}

function seriesEpisodes(key, library) {
  return [...itemById.values()]
    .filter((it) => it.kind === "episode" && it.state !== "missing" &&
      seriesKey(it) === key && (!library || it.library === library))
    .sort(compareSE);
}

// Plex's "play the series" = the next unwatched episode in S/E order.
function nextEpisode(eps) {
  return eps.find((it) => {
    const ph = playheads[it.id];
    return !(ph && ph.watched);
  }) || eps[0];
}

function seTag(it) {
  const se = episodeSE(it);
  if (!se) return "";
  return se.s > 0 ? `S${se.s}E${se.e}` : `E${se.e}`;
}

// "Bleach E362 · The Final Getsuga" → "The Final Getsuga"; bare markers
// fall back to "Episode 362".
function episodeLabel(it, key) {
  let rem = it.title.startsWith(key) ? it.title.slice(key.length) : it.title;
  rem = rem.replace(/^[\s\-–—.:]+/, "").trim();
  const m = rem.match(SERIES_RE) || rem.match(ABS_EP_RE);
  const name = m ? rem.replace(m[0], "").replace(/^[\s\-–—.:]+/, "").trim() : rem;
  if (name) return name;
  const se = episodeSE(it);
  return se && se.e ? `Episode ${se.e}` : it.title;
}

function openItem(it) {
  if (it.kind === "episode") openSeries(seriesKey(it), it);
  else openMovieDetail(it);
}

function detailBackButton() {
  return `<button class="back-button" id="detail-back"><span class="ic ic-back"></span> Back</button>`;
}

function wireDetailBack() {
  document.getElementById("detail-back").onclick = () =>
    (backTarget || loadHome)();
}

function openMovieDetail(it) {
  const ph = playheads[it.id];
  const resumable = ph && !ph.watched && ph.durationMs > 0 &&
    ph.positionMs >= RESUME_MIN_S * 1000 &&
    ph.positionMs / ph.durationMs < WATCHED_FRACTION;
  grid.className = "home detail";
  window.scrollTo(0, 0);
  grid.innerHTML = `
    <section class="hero detail-hero">
      ${artHtml(it, "backdrop")}
      <div class="hero-scrim"></div>
      <div class="hero-copy">
        ${detailBackButton()}
        <div class="eyebrow">${["Movie", it.year, (it.genres || []).slice(0, 3).join(" · ")]
          .filter(Boolean).join("  ·  ")}</div>
        <h2>${escapeHtml(it.title)}</h2>
        <p>${escapeHtml(it.overview || "No synopsis yet — identify this title with Fix match if it was missed.")}</p>
        <div class="detail-actions">
          <button class="text-button" id="detail-play"><span class="ic ic-play"></span> ${resumable ? `Resume · ${fmtLeftMs(ph)}` : "Play"}</button>
          <button class="ghost-button" id="detail-mylist"><span class="ic ic-bookmark"></span> ${myListIds[it.id] ? "In My List" : "My List"}</button>
          <button class="ghost-button" id="detail-info"><span class="ic ic-info"></span> Media info</button>
          <button class="ghost-button" id="detail-match"><span class="ic ic-edit"></span> Fix match</button>
        </div>
      </div>
    </section>`;
  wireDetailBack();
  document.getElementById("detail-play").onclick = () => play(it);
  document.getElementById("detail-info").onclick = () => openInfoModal(it);
  document.getElementById("detail-match").onclick = () => openMatchModal(it);
  const mlDetailBtn = document.getElementById("detail-mylist");
  mlDetailBtn.classList.toggle("active", !!myListIds[it.id]);
  mlDetailBtn.onclick = async () => {
    await toggleMyList(it);
    mlDetailBtn.innerHTML = `<span class="ic ic-bookmark"></span> ${myListIds[it.id] ? "In My List" : "My List"}`;
    mlDetailBtn.classList.toggle("active", !!myListIds[it.id]);
  };
}

function openSeries(key, anchor) {
  const eps = seriesEpisodes(key, anchor.library);
  if (eps.length === 0) return; // nothing to drill into — shouldn't happen
  if (eps.length === 1) return openMovieDetail(anchor); // single file: no seasons to show
  const rep = eps.find((it) => it.backdropUrl) || eps.find((it) => it.posterUrl) || eps[0];
  const seasons = new Map();
  for (const it of eps) {
    const s = (episodeSE(it) || { s: 0 }).s;
    if (!seasons.has(s)) seasons.set(s, []);
    seasons.get(s).push(it);
  }
  const next = nextEpisode(eps);
  const nextSeason = (episodeSE(next) || { s: 0 }).s;

  grid.className = "home detail";
  window.scrollTo(0, 0);
  grid.innerHTML = `
    <section class="hero detail-hero">
      ${artHtml(rep, "backdrop")}
      <div class="hero-scrim"></div>
      <div class="hero-copy">
        ${detailBackButton()}
        <div class="eyebrow">${["Series", rep.year, `${seasons.size} season${seasons.size === 1 ? "" : "s"}`,
          `${eps.length} episode${eps.length === 1 ? "" : "s"}`].filter(Boolean).join("  ·  ")}</div>
        <h2>${escapeHtml(key)}</h2>
        <p>${escapeHtml(rep.overview || "")}</p>
        <div class="detail-actions">
          <button class="text-button" id="detail-play"><span class="ic ic-play"></span> ${playheads[next.id] && !playheads[next.id].watched && playheads[next.id].positionMs > 0
            ? `Resume ${seTag(next)}` : `Play ${seTag(next)}`}</button>
          <button class="ghost-button" id="detail-mylist"><span class="ic ic-bookmark"></span> ${myListIds[rep.id] ? "In My List" : "My List"}</button>
        </div>
      </div>
    </section>
    <section class="episodes">
      ${seasons.size > 1 ? `<div class="season-tabs">${[...seasons.keys()].map((s) =>
        `<button data-season="${s}" class="${s === nextSeason ? "active" : ""}">${s > 0 ? `Season ${s}` : "Episodes"}</button>`).join("")}</div>` : ""}
      <div class="ep-list"></div>
    </section>`;
  wireDetailBack();
  document.getElementById("detail-play").onclick = () => play(next);
  const mlSeriesBtn = document.getElementById("detail-mylist");
  mlSeriesBtn.classList.toggle("active", !!myListIds[rep.id]);
  mlSeriesBtn.onclick = async () => {
    await toggleMyList(rep);
    mlSeriesBtn.innerHTML = `<span class="ic ic-bookmark"></span> ${myListIds[rep.id] ? "In My List" : "My List"}`;
    mlSeriesBtn.classList.toggle("active", !!myListIds[rep.id]);
  };

  // Real episode names/stills arrive asynchronously: rows render with
  // filename-derived labels first, then re-render once TMDB answers.
  // Absolute-numbered files (s=0) probe season 1 — many anime series are
  // single-season on TMDB; a miss just keeps the filename label.
  const epMeta = new Map(); // "SxE" -> { name, overview, stillUrl, airDate }
  let activeSeason = nextSeason;

  const listEl = grid.querySelector(".ep-list");
  function renderSeason(s) {
    activeSeason = s;
    listEl.innerHTML = seasons.get(s).map((it) => {
      const ph = playheads[it.id];
      const pct = ph && ph.durationMs > 0
        ? Math.min(100, (ph.positionMs / ph.durationMs) * 100) : 0;
      const se = episodeSE(it) || { s: 0, e: 0 };
      const meta = epMeta.get(`${se.s > 0 ? se.s : 1}x${se.e}`);
      const title = (meta && meta.name) || episodeLabel(it, key);
      return `
        <div class="ep-row" data-id="${it.id}"${meta && meta.overview ? ` title="${escapeHtml(meta.overview)}"` : ""}>
          <span class="ep-thumb">${meta && meta.stillUrl
            ? `<img src="${meta.stillUrl}" loading="lazy" alt="" onerror="this.remove()"><i>${se.e || "–"}</i>`
            : `<i class="num">${se.e || "–"}</i>`}</span>
          <div class="ep-meta">
            <div class="ep-title">${escapeHtml(title)}</div>
            <div class="ep-sub">${[seTag(it), meta && meta.airDate, fmtBytes(it.sizeBytes),
              ph && !ph.watched && pct > 0 ? fmtLeftMs(ph) : ""].filter(Boolean).join(" · ")}</div>
            ${pct > 0 && !(ph && ph.watched)
              ? `<div class="progress ep-progress"><div class="progress-fill" style="width:${pct}%"></div></div>` : ""}
          </div>
          ${ph && ph.watched ? `<span class="ep-watched" title="Watched"><span class="ic ic-check"></span></span>` : ""}
          <button class="card-play ep-play" aria-label="Play" title="Play"><span class="ic ic-play"></span></button>
        </div>`;
    }).join("");
    listEl.querySelectorAll(".ep-row").forEach((row) => {
      const it = itemById.get(row.dataset.id);
      if (!it) return;
      row.querySelector(".ep-play").onclick = (e) => { e.stopPropagation(); play(it); };
      row.onclick = () => play(it);
    });
  }
  renderSeason(nextSeason);
  grid.querySelectorAll(".season-tabs button").forEach((btn) => {
    btn.onclick = () => {
      grid.querySelectorAll(".season-tabs button").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      renderSeason(Number(btn.dataset.season));
    };
  });

  if (rep.tmdbId) {
    api(`/api/v1/metadata/series/${rep.tmdbId}/episodes`, { timeoutMs: 60000 }).then((data) => {
      for (const e of (data && data.episodes) || []) {
        epMeta.set(`${e.season}x${e.episode}`, e);
      }
      // Only repaint if the user is still on this series page.
      if (grid.classList.contains("detail") && grid.contains(listEl)) {
        renderSeason(activeSeason);
      }
    }).catch(() => {}); // no key / TMDB down → filename labels stay
  }
}

// Nav badge counts: episodes → series count (matches the Recently Added TV
// rail), movies/music → file count. Called from loadHome once items are in.
function updateNavCounts(visible) {
  const byLib = new Map();
  for (const it of visible) {
    if (!byLib.has(it.library)) byLib.set(it.library, []);
    byLib.get(it.library).push(it);
  }
  nav.querySelectorAll("button[data-lib]").forEach((btn) => {
    const its = byLib.get(btn.dataset.lib) || [];
    const n = btn.dataset.kind === "tv"
      ? new Set(its.map(seriesKey)).size
      : its.length;
    btn.textContent = `${btn.dataset.lib} (${n})`;
  });
  moveNavGlider(); // count changes rewrap segment widths
}

async function loadHome() {
  activeLib = null;
  backTarget = null; // home is the root view — detail pages return here
  closeSettings();
  closeSearch();
  // Don't touch the grid until the data is here: switching class/innerHTML
  // before the fetch resolves is what caused the flash of broken layout
  // when changing nav segments.
  const [items, phs, ml] = await Promise.all([
    api("/api/v1/items"),
    currentUser ? api(`/api/v1/users/${currentUser.id}/playheads`) : {},
    currentUser ? api(`/api/v1/users/${currentUser.id}/mylist`) : {},
  ]);
  playheads = phs || {};
  myListIds = ml || {};
  grid.className = "home";

  const visible = (items || []).filter((it) => it.state !== "missing");
  lastVisibleItems = visible;
  visible.forEach((it) => itemById.set(it.id, it));
  updateNavCounts(visible);
  if (visible.length === 0) {
    grid.innerHTML = `<div class="home-empty"><img class="empty-emblem" src="/brand/emblem-512.png" alt=""><br>Nothing here yet — add a library with ⚙, then let Lumina scan.</div>`;
    return;
  }

  const byId = Object.fromEntries(visible.map((it) => [it.id, it]));
  const recent = [...visible].sort((a, b) => new Date(b.addedAt) - new Date(a.addedAt));
  const recentTV = recent.filter((it) => it.kind === "episode");
  const recentMovies = recent.filter((it) => it.kind !== "episode");
  const resume = visible
    .filter((it) => {
      const ph = playheads[it.id];
      return ph && !ph.watched && ph.durationMs > 0 &&
        ph.positionMs >= RESUME_MIN_S * 1000 &&
        ph.positionMs / ph.durationMs < WATCHED_FRACTION;
    })
    .sort((a, b) => new Date(playheads[b.id].updatedAt) - new Date(playheads[a.id].updatedAt));

  const featured = resume.find((it) => it.backdropUrl) ||
    recent.find((it) => it.backdropUrl) || recent[0];

  // Hero carousel: up to 5 slides with real backdrops — what you're
  // mid-way through first, then the newest additions. Falls back to the
  // single featured item when nothing has backdrop art yet.
  const slides = [];
  const seenSlide = new Set();
  for (const it of [...resume, ...recent]) {
    if (!it.backdropUrl || seenSlide.has(it.id)) continue;
    seenSlide.add(it.id);
    slides.push(it);
    if (slides.length >= 5) break;
  }
  if (slides.length === 0) slides.push(featured);

  grid.innerHTML = `
    <section class="hero carousel">
      ${slides.map((it, i) => {
        const ph = playheads[it.id];
        return `
        <div class="hero-slide${i === 0 ? " active" : ""}">
          ${artHtml(it, "backdrop")}
          <div class="hero-scrim"></div>
          <div class="hero-copy">
            <div class="eyebrow">${ph ? "Resume" : "Featured"} · ${it.kind === "episode" ? "Episode" : "Movie"}</div>
            <h2>${escapeHtml(it.title)}</h2>
            <p>${escapeHtml(it.overview || "Your library, direct from the source — no cloud account, no Plex pass, no transcode unless it has to.")}</p>
            <button class="text-button" data-play="${it.id}"><span class="ic ic-play"></span> ${ph ? "Resume" : "Play now"}</button>
          </div>
        </div>`;
      }).join("")}
      ${slides.length > 1 ? `
        <button class="hero-nav prev" aria-label="Previous slide"><span class="ic ic-back"></span></button>
        <button class="hero-nav next" aria-label="Next slide"><span class="ic ic-back ic-flip"></span></button>
        <div class="hero-dots">${slides.map((_, i) =>
          `<button data-i="${i}" class="${i === 0 ? "active" : ""}" aria-label="Slide ${i + 1}"></button>`).join("")}</div>` : ""}
    </section>
    ${resume.length ? `
      <section class="rail">
        <div class="rail-head"><h3>Continue Watching</h3><span>${resume.length} in progress</span></div>
        <div class="rail-track">${resume.slice(0, 16).map((it) => homeCard(it, playheads[it.id], false)).join("")}</div>
      </section>` : ""}
    ${recentTV.length ? (() => {
      const groups = groupBySeries(recentTV);
      return `
      <section class="rail">
        <div class="rail-head"><h3>Recently Added TV</h3><span>${groups.length} series · ${recentTV.length} episodes</span></div>
        <div class="rail-track posters">${groups.slice(0, 16).map((g) => homeCard(g.rep, playheads[g.rep.id], true, g.label)).join("")}</div>
      </section>`;
    })() : ""}
    ${recentMovies.length ? `
      <section class="rail">
        <div class="rail-head"><h3>Recently Added Movies</h3><span>${recentMovies.length} movies</span></div>
        <div class="rail-track posters">${recentMovies.slice(0, 24).map((it) => homeCard(it, playheads[it.id], true)).join("")}</div>
      </section>` : ""}`;

  // Carousel wiring: crossfade slides, 8s auto-advance, pause on hover.
  // If the user has navigated away the interval stops itself (the hero is
  // no longer in the DOM).
  const heroEl = grid.querySelector(".hero");
  const slideEls = [...heroEl.querySelectorAll(".hero-slide")];
  let heroIdx = 0;
  const showSlide = (i) => {
    if (!heroEl.isConnected) {
      clearInterval(heroTimer);
      heroTimer = null;
      return;
    }
    heroIdx = (i + slideEls.length) % slideEls.length;
    slideEls.forEach((s, j) => s.classList.toggle("active", j === heroIdx));
    heroEl.querySelectorAll(".hero-dots button").forEach((d, j) =>
      d.classList.toggle("active", j === heroIdx));
  };
  const startHeroTimer = () => {
    clearInterval(heroTimer);
    if (slideEls.length > 1) heroTimer = setInterval(() => showSlide(heroIdx + 1), 8000);
  };
  if (slideEls.length > 1) {
    heroEl.querySelector(".hero-nav.prev").onclick = () => { showSlide(heroIdx - 1); startHeroTimer(); };
    heroEl.querySelector(".hero-nav.next").onclick = () => { showSlide(heroIdx + 1); startHeroTimer(); };
    heroEl.querySelectorAll(".hero-dots button").forEach((d) => {
      d.onclick = () => { showSlide(Number(d.dataset.i)); startHeroTimer(); };
    });
    heroEl.addEventListener("mouseenter", () => clearInterval(heroTimer));
    heroEl.addEventListener("mouseleave", startHeroTimer);
    startHeroTimer();
  }
  heroEl.querySelectorAll("[data-play]").forEach((btn) => {
    btn.onclick = () => play(byId[btn.dataset.play]);
  });
  grid.querySelectorAll(".media-card").forEach((card) => {
    const it = byId[card.dataset.id];
    if (!it) return;
    card.querySelector(".card-play").onclick = (e) => {
      e.stopPropagation();
      play(it);
    };
    card.onclick = () => openItem(it);
  });
  enhanceRails();
}

// Plex/Netflix-style rail paging: glass ‹ › wedges at the rail edges that
// scroll ~one viewport per click, hidden at the scroll ends.
function enhanceRails() {
  grid.querySelectorAll(".rail").forEach((rail) => {
    const track = rail.querySelector(".rail-track");
    if (!track || rail.querySelector(".rail-nav")) return;
    const prev = document.createElement("button");
    prev.className = "rail-nav prev off";
    prev.innerHTML = '<span class="ic ic-back"></span>';
    prev.setAttribute("aria-label", "Scroll back");
    const next = document.createElement("button");
    next.className = "rail-nav next";
    next.innerHTML = '<span class="ic ic-back ic-flip"></span>';
    next.setAttribute("aria-label", "Scroll forward");
    const page = (dir) =>
      track.scrollBy({ left: dir * track.clientWidth * 0.85, behavior: "smooth" });
    prev.onclick = () => page(-1);
    next.onclick = () => page(1);
    const sync = () => {
      prev.classList.toggle("off", track.scrollLeft <= 4);
      next.classList.toggle("off", track.scrollLeft + track.clientWidth >= track.scrollWidth - 4);
    };
    track.addEventListener("scroll", sync, { passive: true });
    rail.append(prev, next);
    requestAnimationFrame(sync);
  });
}

// --- global search ---------------------------------------------------------------
// Header magnifier opens a full-screen overlay (settings-page pattern).
// Episodes collapse into one card per series; everything else is a movie card.

const searchPage = document.getElementById("search-page");
const searchInput = document.getElementById("search-input");
const searchResults = document.getElementById("search-results");
let searchTimer = null;

function openSearch() {
  closeSettings();
  searchPage.classList.remove("hidden");
  searchInput.focus();
  if (searchInput.value.trim()) runSearch(searchInput.value.trim());
}

function closeSearch() {
  searchPage.classList.add("hidden");
}

document.getElementById("search-button").onclick = () =>
  searchPage.classList.contains("hidden") ? openSearch() : closeSearch();
document.getElementById("search-close").onclick = closeSearch;

searchInput.addEventListener("input", () => {
  clearTimeout(searchTimer);
  const q = searchInput.value.trim();
  if (!q) {
    searchResults.innerHTML = `<div class="modal-note">Type to search your library.</div>`;
    return;
  }
  searchTimer = setTimeout(() => runSearch(q), 250);
});
searchInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    clearTimeout(searchTimer);
    runSearch(searchInput.value.trim());
  }
});

async function runSearch(q) {
  if (!q) return;
  searchResults.innerHTML = `<div class="modal-note">Searching…</div>`;
  let found;
  try {
    found = await api(`/api/v1/search?q=${encodeURIComponent(q)}`);
  } catch (e) {
    searchResults.innerHTML = `<div class="modal-note err">${escapeHtml(e.message)}</div>`;
    return;
  }
  if (searchPage.classList.contains("hidden")) return; // closed mid-flight
  (found || []).forEach((it) => itemById.set(it.id, it));

  const episodes = (found || []).filter((it) => it.kind === "episode");
  const movies = (found || []).filter((it) => it.kind !== "episode");
  const groups = new Map();
  for (const it of episodes) {
    const k = seriesKey(it);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(it);
  }
  const seriesCards = [...groups.entries()].map(([key, eps]) => ({
    rep: eps.find((e) => e.posterUrl) || eps[0],
    label: { title: key, sub: `${eps.length} episode${eps.length === 1 ? "" : "s"}`, badge: "" },
  })).sort((a, b) => a.label.title.localeCompare(b.label.title));

  if (seriesCards.length === 0 && movies.length === 0) {
    searchResults.innerHTML = `<div class="modal-note">No results for “${escapeHtml(q)}”.</div>`;
    return;
  }
  searchResults.innerHTML = `
    ${seriesCards.length ? `
      <section class="rail block">
        <div class="rail-head"><h3>Series</h3><span>${seriesCards.length} match${seriesCards.length === 1 ? "" : "es"}</span></div>
        <div class="rail-track posters wrap">${seriesCards.map((g) =>
          homeCard(g.rep, playheads[g.rep.id], true, g.label)).join("")}</div>
      </section>` : ""}
    ${movies.length ? `
      <section class="rail block">
        <div class="rail-head"><h3>Movies &amp; more</h3><span>${movies.length}</span></div>
        <div class="rail-track posters wrap">${movies.map((it) =>
          homeCard(it, playheads[it.id], true)).join("")}</div>
      </section>` : ""}`;
  searchResults.querySelectorAll(".media-card").forEach((card) => {
    const it = itemById.get(card.dataset.id);
    if (!it) return;
    card.querySelector(".card-play").onclick = (e) => {
      e.stopPropagation();
      closeSearch();
      play(it);
    };
    card.onclick = () => {
      closeSearch();
      openItem(it);
    };
  });
}

// --- playback --------------------------------------------------------------------

// Why isn't this file direct-playing? The answer used to live in the
// client's head only — now it rides on the mode badge's tooltip.
function directPlayBlockers(info, item) {
  const reasons = [];
  if (!info.video) {
    reasons.push("no video stream found by ffprobe");
    return reasons;
  }
  const ext = ((item.paths && item.paths[0]) || "").split(".").pop().toLowerCase();
  if (!DIRECT_EXTS.includes(ext)) {
    reasons.push(`${ext} container (browsers only play ${DIRECT_EXTS.join("/")} natively)`);
  }
  if (!DIRECT_VIDEO.includes(info.video.codec)) {
    reasons.push(`video codec ${info.video.codec} (this browser decodes ${DIRECT_VIDEO.join("/")})`);
  }
  // Only the PRIMARY audio track gates: browsers play the container's
  // default (first) audio stream, so a secondary AC3 commentary track
  // shouldn't force a transcode of an otherwise direct-playable file.
  const primary = (info.audio || [])[0];
  if (primary && !DIRECT_AUDIO.includes(primary.codec)) {
    reasons.push(`audio codec ${primary.codec} (DTS/TrueHD never direct-play — silent audio is worse than a transcode)`);
  }
  return reasons;
}

function setMode(label, cls) {
  playerMode.textContent = label;
  playerMode.className = `badge ${cls}`;
}

function absolutePositionS() { return sessionOffsetS + video.currentTime; }

function stopPlayback() {
  reportPlayhead(true); // final flush before teardown
  clearTimeout(seekRestartTimer);
  clearTimeout(idleTimer);
  overlay.classList.remove("idle");
  if (currentHls) { currentHls.destroy(); currentHls = null; }
  video.pause();
  video.querySelectorAll("track").forEach((t) => t.remove());
  video.removeAttribute("src");
  video.load();
  subCues = [];
  activeSubTrack = -1;
  renderSubtitles();
  ccSelect.classList.add("hidden");
  ccOpts.classList.add("hidden");
  ccPop.classList.add("hidden");
  isHls = false;
  sessionOffsetS = 0;
  // NOTE: resumeAtS is set by play() AFTER this runs and consumed by
  // applyResume on loadedmetadata — do not reset it here.
}

async function play(item) {
  currentItem = item;
  lastReportAt = 0;
  playerTitle.textContent = item.title;
  overlay.classList.remove("hidden");
  pcRate.textContent = "1×";
  pcVolume.value = String(video.volume);
  seekPlayed.style.width = "0";
  seekBuffered.style.width = "0";
  pcTimeCurrent.textContent = "0:00";
  pcTimeTotal.textContent = "0:00";
  syncPlayButton();
  pokeControls();
  forceTranscode.onchange = () => play(item);
  // Quality change = seamless restart at the current absolute position on
  // the new rung's session (item@offset@quality keys keep them apart).
  pcQuality.onchange = () => {
    currentQuality = pcQuality.value;
    localStorage.setItem("lumina-quality", currentQuality);
    if (!currentItem) return;
    if (isHls) {
      startHls(currentItem, absolutePositionS());
    } else if (currentQuality !== "original") {
      startHls(currentItem, video.currentTime || 0); // direct → capped rung
    }
    // direct → original: keep direct playing; only the NEXT play uses it.
  };

  // Next-episode button + end-of-episode "Up next" (episodes only).
  closeUpNext();
  nextEp = null;
  if (item.kind === "episode") {
    const eps = seriesEpisodes(seriesKey(item), item.library);
    const i = eps.findIndex((e) => e.id === item.id);
    if (i >= 0 && i + 1 < eps.length) nextEp = eps[i + 1];
  }
  pcNext.classList.toggle("hidden", !nextEp);

  // Resume point from the journal: skip intros (<5s) and finished items.
  resumeAtS = 0;
  if (currentUser) {
    try {
      const ph = await api(`/api/v1/items/${item.id}/playhead?user=${currentUser.id}`);
      if (ph && !ph.watched && ph.durationMs > 0) {
        const posS = ph.positionMs / 1000;
        if (posS >= RESUME_MIN_S) resumeAtS = posS;
      }
    } catch { /* no journal entry — start from 0 */ }
  }

  const info = await api(`/api/v1/items/${item.id}/info`);
  mediaInfoJson.textContent = JSON.stringify(info, null, 2);
  document.getElementById("media-overview").textContent = item.overview || "";
  absoluteDurationS = info.durationS || 0;

  loadSubtitles(item).catch((e) => console.warn("subtitle discovery failed:", e));

  // A constrained quality rung forces transcode (Plex behaviour): even a
  // direct-playable file must be re-encoded to honour the bitrate cap.
  if (!forceTranscode.checked && currentQuality === "original" &&
      directPlayBlockers(info, item).length === 0) {
    startDirect(item);
  } else {
    // The "why" rides on the mode badge: hover "transcode · vaapi" to see
    // exactly which gate failed (container, video codec, audio codec).
    playerMode.title = forceTranscode.checked
      ? "force transcode is on"
      : currentQuality !== "original"
        ? `quality cap: ${pcQuality.selectedOptions[0]?.textContent || currentQuality}`
        : directPlayBlockers(info, item).join("\n");
    startHls(item, resumeAtS);
  }
}

function applyResume() {
  // Direct play only: HLS sessions START at the resume offset instead.
  if (isHls) return;
  if (resumeAtS > 0 && video.duration && resumeAtS < video.duration * WATCHED_FRACTION) {
    video.currentTime = resumeAtS;
    resumeAtS = 0;
  }
}

function startDirect(item) {
  stopPlayback();
  setMode("direct play", "direct");
  video.onerror = () => startHls(item, video.currentTime || resumeAtS || 0);
  video.src = `/api/v1/items/${item.id}/stream`;
  video.play().catch(() => {});
}

async function startHls(item, startS) {
  stopPlayback();
  isHls = true;
  sessionOffsetS = Math.max(0, startS || 0);
  // Quality rung always rides the URL: it keys the server-side session
  // (item@offset@quality), so switching rungs never collides with a
  // session from another rung.
  const params = new URLSearchParams();
  if (sessionOffsetS > 0) params.set("start", String(Math.floor(sessionOffsetS)));
  if (currentQuality !== "original") params.set("quality", currentQuality);
  const qs = params.toString() ? `?${params}` : "";
  const url = `/api/v1/items/${item.id}/hls/index.m3u8${qs}`;

  let mode = "";
  try {
    // The playlist is TEXT — api() would throw on res.json() and the badge
    // used to be stuck on its "software" default forever. The session mode
    // travels in a response header instead; fallback asks the sessions list
    // for THIS offset's exact key (older sessions from earlier seeks must
    // not win — they can carry a stale retry mode).
    const res = await fetch(url);
    mode = res.headers.get("x-lumina-session-mode") || "";
    if (!res.ok) throw new Error(`hls ${res.status}`);
  } catch { /* header missing (old server) — fall through to the list */ }
  if (!mode) {
    try {
      const sessions = await api("/api/v1/system/sessions");
      const key = `${item.id}@${Math.floor(sessionOffsetS)}@${currentQuality}`;
      const sess = sessions.find((s) => s.key === key) ||
        sessions.find((s) => s.key.startsWith(item.id));
      if (sess) mode = sess.mode;
    } catch { /* session may already exist */ }
  }
  if (!mode) mode = "software"; // unknown ≠ software, but badge needs a label
  const rung = currentQuality !== "original" ? ` · ${currentQuality}` : "";
  if (mode === "copy") {
    setMode("direct stream · remux", "direct");
  } else if (mode === "vaapi-hybrid") {
    setMode(`transcode · vaapi (gpu encode)${rung}`, "");
  } else {
    setMode(`transcode · ${mode}${rung}`, mode === "vaapi" ? "" : "software");
  }

  if (window.Hls && Hls.isSupported()) {
    currentHls = new Hls({
      maxBufferLength: 60,
      // The session playlist GROWS (no EXT-X-ENDLIST until ffmpeg finishes),
      // which hls.js treats as a live stream. Default startPosition (-1)
      // means "live edge" — playback opened ~12s into the content and
      // hls.js kept re-syncing forward = the skip-ahead bug. Start at the
      // session's t=0 and never live-edge-sync (Infinity: stall and buffer
      // at the transcode frontier instead of jumping).
      startPosition: 0,
      liveSyncDurationCount: Infinity,
    });
    currentHls.loadSource(url);
    currentHls.attachMedia(video);
    currentHls.on(Hls.Events.MANIFEST_PARSED, () => {
      video.currentTime = 0; // session timeline starts at the offset
      video.play().catch(() => {});
    });
  } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
    video.src = url; // Safari native HLS
    video.play().catch(() => {});
  } else {
    playerTitle.textContent = `${item.title} — this browser cannot play HLS`;
  }
}

// NOTE: there is deliberately no "seeking"-event restart listener. Every
// user seek goes through seekToAbsolute (seek bar + keyboard), which
// restarts ffmpeg directly when the target is past the produced frontier.
// A passive listener ALSO fired when hls.js moved the playhead itself
// (live-edge sync), mistook it for a user seek, and restarted ffmpeg in a
// loop — the "skips ahead, then repeats, then stabilises" bug.


// --- subtitles --------------------------------------------------------------------
// Custom cue renderer (not native <track>). Two reasons:
//   1. HLS sessions are OFFSET — video.currentTime restarts at 0 from the
//      seek/resume point while VTT cues are absolute, so native tracks
//      drift out of sync on every seek-restart. We render against
//      absolutePositionS(), which is always right.
//   2. ASS/SSA conversions carry typesetting (giant mid-frame signs); we
//      strip override tags and render with our own CSS instead.

const subOverlay = document.getElementById("sub-overlay");
let subTracks = [];      // server track list for the current item
let subCues = [];        // parsed cues in ABSOLUTE seconds: {start, end, html}
let activeSubTrack = -1; // -1 = off

async function loadSubtitles(item) {
  subTracks = await api(`/api/v1/items/${item.id}/subtitles`);
  subCues = [];
  activeSubTrack = -1;
  renderSubtitles();
  ccSelect.innerHTML = '<option value="">Subtitles: off</option>';
  subTracks.forEach((t, i) => {
    const opt = document.createElement("option");
    opt.value = String(i);
    opt.textContent = t.label;
    ccSelect.appendChild(opt);
  });
  if (subTracks.length === 0) {
    ccSelect.classList.add("hidden");
    ccOpts.classList.add("hidden");
    return;
  }
  ccSelect.classList.remove("hidden");
  ccOpts.classList.remove("hidden");
  // Forced/default tracks auto-enable (Plex behaviour); otherwise off.
  const def = subTracks.findIndex((t) => t.default);
  if (def >= 0) selectTrack(def);
}

async function selectTrack(i) {
  activeSubTrack = i == null ? -1 : i;
  ccSelect.value = i == null ? "" : String(i);
  subCues = [];
  renderSubtitles();
  if (i == null || !currentItem) return;
  // First selection of an embedded track pays a container scan (uncached);
  // show the wait instead of looking broken. Cached tracks answer in ms.
  ccSelect.disabled = true;
  subOverlay.innerHTML = '<div class="sub-line sub-loading">Loading subtitles…</div>';
  try {
    const res = await fetch(`/api/v1/items/${currentItem.id}/subtitles/${subTracks[i].id}`);
    if (!res.ok) throw new Error(`subtitles ${res.status}`);
    // The user may have switched tracks (or off) while we were fetching —
    // only apply cues if this selection is still current.
    const cues = parseVTT(await res.text());
    if (activeSubTrack === i) {
      subCues = cues;
      renderSubtitles();
    }
  } catch (e) {
    console.warn("subtitle load failed:", subTracks[i] && subTracks[i].id, e);
    if (activeSubTrack === i) {
      activeSubTrack = -1;
      ccSelect.value = "";
      subOverlay.innerHTML = '<div class="sub-line sub-loading">Subtitles failed to load — try again</div>';
      setTimeout(renderSubtitles, 2500);
    }
  } finally {
    ccSelect.disabled = false;
  }
}

function parseVTT(text) {
  const toS = (ts) => {
    const m = ts.trim().match(/(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{3})/);
    if (!m) return 0;
    return (+(m[1] || 0)) * 3600 + (+m[2]) * 60 + (+m[3]) + (+m[4]) / 1000;
  };
  const cues = [];
  for (const block of text.split(/\r?\n\r?\n/)) {
    const lines = block.split(/\r?\n/)
      .filter((l) => l.trim() && !/^(WEBVTT|NOTE)/.test(l));
    const ti = lines.findIndex((l) => l.includes("-->"));
    if (ti < 0) continue;
    const [a, z] = lines[ti].split("-->");
    const body = lines.slice(ti + 1).join("\n");
    if (!body.trim()) continue;
    cues.push({ start: toS(a), end: toS(z), html: subHtml(body) });
  }
  return cues.sort((x, y) => x.start - y.start);
}

// Keep basic emphasis; drop ASS-override braces and font/position tags
// that leak through conversion.
function subHtml(s) {
  let h = escapeHtml(s).replace(/\{[^}]*\}/g, "");
  h = h.replace(/&lt;(\/?)(i|b|u)&gt;/g, "<$1$2>");
  h = h.replace(/&lt;[^&]{0,120}?&gt;/g, "");
  return h.replace(/\n/g, "<br>");
}

function renderSubtitles() {
  if (activeSubTrack < 0 || subCues.length === 0) {
    subOverlay.innerHTML = "";
    return;
  }
  const t = absolutePositionS();
  subOverlay.innerHTML = subCues
    .filter((c) => t >= c.start && t < c.end)
    .map((c) => `<div class="sub-line">${c.html}</div>`)
    .join("");
}
video.addEventListener("timeupdate", renderSubtitles);

ccSelect.onchange = () =>
  selectTrack(ccSelect.value === "" ? null : Number(ccSelect.value));

// --- buffering spinner ----------------------------------------------------------
// Shows while the video starves (startup, seek-restart, network stall).

const showSpinner = () => playerSpinner.classList.remove("hidden");
const hideSpinner = () => playerSpinner.classList.add("hidden");
video.addEventListener("loadstart", showSpinner);
video.addEventListener("waiting", showSpinner);
video.addEventListener("stalled", showSpinner);
video.addEventListener("playing", hideSpinner);
video.addEventListener("canplay", hideSpinner);
video.addEventListener("pause", hideSpinner);
video.addEventListener("error", hideSpinner);
video.addEventListener("emptied", hideSpinner);

// --- next episode + "Up next" ------------------------------------------------------

pcNext.onclick = () => {
  if (nextEp) play(nextEp);
};

function closeUpNext() {
  clearTimeout(upNextTimer);
  clearInterval(upNextCountdown);
  upNextTimer = null;
  upNextCountdown = null;
  upNext.classList.add("hidden");
}

function showUpNext() {
  if (!nextEp) return;
  upNextTitle.textContent = `${seriesKey(nextEp)} — ${seTag(nextEp)}`;
  upNext.classList.remove("hidden");
  pokeControls();
  let left = 6;
  upNextCount.textContent = `(${left}s)`;
  upNextCountdown = setInterval(() => {
    left -= 1;
    upNextCount.textContent = left > 0 ? `(${left}s)` : "";
  }, 1000);
  upNextTimer = setTimeout(() => {
    closeUpNext();
    if (nextEp) play(nextEp);
  }, 6000);
}

document.getElementById("up-next-play").onclick = () => {
  closeUpNext();
  if (nextEp) play(nextEp);
};
document.getElementById("up-next-cancel").onclick = closeUpNext;

video.addEventListener("ended", () => {
  reportPlayhead(true);
  if (nextEp) showUpNext();
});

// --- subtitle appearance (size + background, persisted) ------------------------------

function applySubPrefs() {
  const size = localStorage.getItem("lumina.subSize") || "m";
  const bg = localStorage.getItem("lumina.subBg") || "on";
  overlay.classList.toggle("subs-s", size === "s");
  overlay.classList.toggle("subs-m", size === "m");
  overlay.classList.toggle("subs-l", size === "l");
  overlay.classList.toggle("subs-nobg", bg === "off");
  ccPop.querySelectorAll("[data-size]").forEach((b) =>
    b.classList.toggle("active", b.dataset.size === size));
  ccPop.querySelectorAll("[data-bg]").forEach((b) =>
    b.classList.toggle("active", b.dataset.bg === bg));
}

ccOpts.onclick = (e) => {
  e.stopPropagation();
  ccPop.classList.toggle("hidden");
};
ccPop.querySelectorAll("[data-size]").forEach((b) => {
  b.onclick = () => {
    localStorage.setItem("lumina.subSize", b.dataset.size);
    applySubPrefs();
  };
});
ccPop.querySelectorAll("[data-bg]").forEach((b) => {
  b.onclick = () => {
    localStorage.setItem("lumina.subBg", b.dataset.bg);
    applySubPrefs();
  };
});
document.addEventListener("click", (e) => {
  if (!ccPop.classList.contains("hidden") &&
      !ccPop.contains(e.target) && e.target !== ccOpts) {
    ccPop.classList.add("hidden");
  }
});
applySubPrefs();

// --- watch-state reporting -----------------------------------------------------------

video.addEventListener("loadedmetadata", applyResume);
video.addEventListener("timeupdate", () => reportPlayhead(false));
video.addEventListener("pause", () => reportPlayhead(true));

function reportPlayhead(force) {
  if (!currentUser || !currentItem) return;
  if (!force && video.paused) return;
  // Duration must come from ffprobe. During a growing HLS session
  // video.duration is only the produced frontier (or Infinity) — reporting
  // it would poison the watched/resume math with a moving target.
  const durationS = absoluteDurationS || (!isHls ? video.duration : 0);
  if (!durationS) return;
  const now = Date.now();
  if (!force && now - lastReportAt < REPORT_INTERVAL_MS) return;
  lastReportAt = now;
  api(`/api/v1/items/${currentItem.id}/playhead`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      userId: currentUser.id,
      positionMs: Math.round(absolutePositionS() * 1000),
      durationMs: Math.round(durationS * 1000),
    }),
  }).catch(() => {}); // reporting must never break playback
}

// --- custom player chrome -----------------------------------------------------
// Native controls are off; the bar below is the whole interface. Times are
// always shown ABSOLUTE (HLS sessions start at an offset — the raw
// video.currentTime would under-report after a seek-restart).

function fmtClock(s) {
  if (!isFinite(s) || s < 0) s = 0;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  return (h > 0 ? `${h}:${String(m).padStart(2, "0")}` : String(m)) +
    `:${String(sec).padStart(2, "0")}`;
}

function displayPositionS() { return sessionOffsetS + (video.currentTime || 0); }
function displayDurationS() { return absoluteDurationS || video.duration || 0; }

function togglePlay() {
  if (video.paused) video.play().catch(() => {});
  else video.pause();
}

function syncPlayButton() {
  pcPlay.innerHTML = `<span class="ic ${video.paused ? "ic-play" : "ic-pause"}"></span>`;
}

// Seek in absolute terms; restarts the HLS session when the target is past
// what FFmpeg has produced (the seek-bar equivalent of restart-on-seek).
function seekToAbsolute(targetAbs) {
  const dur = displayDurationS();
  if (!dur || !currentItem) return;
  targetAbs = Math.min(Math.max(targetAbs, 0), Math.max(dur - 0.5, 0));
  if (!isHls) {
    video.currentTime = targetAbs;
    return;
  }
  const sessionDur = video.duration || 0;
  const rel = targetAbs - sessionOffsetS;
  if (rel > sessionDur) {
    clearTimeout(seekRestartTimer);
    startHls(currentItem, targetAbs);
  } else {
    // Within the produced range: the "seeking" listener decides whether a
    // restart is needed (target beyond the buffered frontier).
    video.currentTime = Math.max(0, Math.min(rel, sessionDur));
  }
}

function seekBy(deltaS) { seekToAbsolute(displayPositionS() + deltaS); }

function updateSeekUI() {
  const dur = displayDurationS();
  const pos = displayPositionS();
  if (dur > 0) {
    seekPlayed.style.width = `${Math.min(100, (pos / dur) * 100)}%`;
    let bufEndAbs = 0;
    if (video.buffered.length > 0) {
      bufEndAbs = video.buffered.end(video.buffered.length - 1);
      if (isHls) bufEndAbs += sessionOffsetS;
      bufEndAbs = Math.max(bufEndAbs, pos);
    }
    seekBuffered.style.width = `${Math.min(100, (bufEndAbs / dur) * 100)}%`;
  }
  pcTimeCurrent.textContent = fmtClock(pos);
  pcTimeTotal.textContent = fmtClock(dur);
}

video.addEventListener("timeupdate", updateSeekUI);
video.addEventListener("progress", updateSeekUI);
video.addEventListener("durationchange", updateSeekUI);
video.addEventListener("play", syncPlayButton);
video.addEventListener("pause", syncPlayButton);
video.addEventListener("volumechange", () => {
  pcVolume.value = video.muted ? "0" : String(video.volume);
});

// Scrubbing: drag anywhere on the bar, pointer-captured so fast moves
// outside the strip keep tracking.
function fractionFromEvent(e) {
  const r = seekBar.getBoundingClientRect();
  return Math.min(Math.max((e.clientX - r.left) / r.width, 0), 1);
}
seekBar.addEventListener("pointerdown", (e) => {
  seekBar.setPointerCapture(e.pointerId);
  seekToAbsolute(fractionFromEvent(e) * displayDurationS());
});
seekBar.addEventListener("pointermove", (e) => {
  if (e.buttons) seekToAbsolute(fractionFromEvent(e) * displayDurationS());
});

pcPlay.onclick = togglePlay;
video.addEventListener("click", togglePlay);
pcBack.onclick = () => seekBy(-10);
pcFwd.onclick = () => seekBy(10);

const RATES = [0.5, 0.75, 1, 1.25, 1.5, 2];
pcRate.onclick = () => {
  const i = RATES.indexOf(video.playbackRate);
  const next = RATES[(i + 1) % RATES.length];
  video.playbackRate = next;
  pcRate.textContent = `${next}×`;
};

pcVolume.oninput = () => {
  video.muted = false;
  video.volume = Number(pcVolume.value);
};

pcFull.onclick = () => {
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  else overlay.requestFullscreen().catch(() => {});
};

// Auto-hide: 3s of stillness while playing fades the chrome and the cursor;
// any movement, or pausing, brings it back.
let idleTimer = null;
function pokeControls() {
  overlay.classList.remove("idle");
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    if (!video.paused && !overlay.classList.contains("hidden")) {
      overlay.classList.add("idle");
    }
  }, 3000);
}
overlay.addEventListener("mousemove", pokeControls);
overlay.addEventListener("pointerdown", pokeControls);
overlay.addEventListener("touchstart", pokeControls, { passive: true });
video.addEventListener("pause", () => {
  overlay.classList.remove("idle");
  clearTimeout(idleTimer);
});
video.addEventListener("play", pokeControls);

// --- settings page ---------------------------------------------------------------
// One full-page settings surface with sidebar sections; the section
// contents keep their original element IDs, so all the existing wiring
// (library rows, Plex import, *arr status) works unchanged.

const settingsPage = document.getElementById("settings-page");
const libsButton = document.getElementById("libs-button");
const libsRows = document.getElementById("libs-rows");
const libsStatus = document.getElementById("libs-status");

function closeSettings() {
  settingsPage.classList.add("hidden");
  clearInterval(activityTimer); // Now Playing stops polling when hidden
  activityTimer = null;
}

async function openSettings(sectionId) {
  settingsPage.classList.remove("hidden");
  settingsPage.querySelectorAll(".settings-nav button").forEach((b) =>
    b.classList.toggle("active", b.dataset.section === sectionId));
  settingsPage.querySelectorAll(".settings-sections > section").forEach((sec) =>
    sec.classList.toggle("hidden", sec.id !== sectionId));

  if (sectionId === "sec-libraries") {
    libsStatus.textContent = "";
    try {
      const libs = await api("/api/v1/libraries");
      renderLibraryRows(libs);
      libsStatus.innerHTML = missingPathNote(libs);
    } catch (e) {
      libsStatus.innerHTML = `<span class="err">${escapeHtml(e.message)}</span>`;
    }
  } else if (sectionId === "sec-integrations") {
    prefillPlexConfig();
    loadPlexSyncStatus();
    renderArrEditor();
    loadArrStatus();
  } else if (sectionId === "sec-playback") {
    renderCapabilities();
  } else if (sectionId === "sec-users") {
    renderUsers();
  } else if (sectionId === "sec-activity") {
    renderActivity();
    clearInterval(activityTimer);
    activityTimer = setInterval(renderActivity, 5000); // live card
  }
  if (sectionId !== "sec-activity") {
    clearInterval(activityTimer);
    activityTimer = null;
  }
}

settingsPage.querySelectorAll(".settings-nav button").forEach((b) => {
  b.onclick = () => openSettings(b.dataset.section);
});
document.getElementById("settings-close").onclick = closeSettings;
libsButton.onclick = () => openSettings("sec-libraries");

// --- now playing (activity) ---------------------------------------------------
// The transcoder-health view: who is watching what (fresh playhead
// reports), and every ffmpeg session with its mode, frontier, and log
// tail — no more docker logs for "why is this stuttering".

let activityTimer = null;

function activityModeBadge(mode) {
  if (!mode) return `<span class="badge direct">direct play</span>`;
  const gpu = mode === "vaapi" || mode === "vaapi-hybrid";
  const label = { copy: "remux", "vaapi": "vaapi", "vaapi-hybrid": "hybrid" }[mode] || mode;
  return `<span class="badge ${gpu ? "" : "software"}">${escapeHtml(label)}</span>`;
}

async function renderActivity() {
  const watchEl = document.getElementById("activity-watching");
  const sessEl = document.getElementById("activity-sessions");
  let data;
  try {
    data = await api("/api/v1/system/activity");
  } catch (e) {
    watchEl.innerHTML = `<span class="err">${escapeHtml(e.message)}</span>`;
    return;
  }
  const watching = data.watching || [];
  watchEl.innerHTML = watching.length === 0
    ? `<p class="libs-note">Nothing is playing right now.</p>`
    : `<div class="activity-grid">${watching.map((w) => {
        const pct = w.durationMs > 0 ? Math.min(100, (w.positionMs / w.durationMs) * 100) : 0;
        return `<div class="activity-card">
          ${w.posterUrl ? `<img class="activity-poster" src="${w.posterUrl}" alt="" loading="lazy">` : ""}
          <div class="activity-meta">
            <div class="activity-title">${escapeHtml(w.title || w.itemId)}</div>
            <div class="activity-sub">
              <span class="ic ic-user"></span> ${escapeHtml(w.userName || w.userId)}
              · ${w.kind === "episode" ? "Episode" : w.kind === "extra" ? "Extra" : "Movie"}
              · ${activityModeBadge(w.mode)}
            </div>
            <div class="activity-progress"><div style="width:${pct}%"></div></div>
            <div class="activity-time">${fmtClock(w.positionMs / 1000)} / ${fmtClock(w.durationMs / 1000)}</div>
          </div>
        </div>`;
      }).join("")}</div>`;

  const sessions = data.sessions || [];
  sessEl.innerHTML = sessions.length === 0
    ? `<p class="libs-note">No transcode sessions.</p>`
    : sessions.map((s) => {
        const status = s.completed ? "complete" : s.dead ? "dead" : "live";
        return `<div class="session-row">
          <div class="session-head">
            ${activityModeBadge(s.mode)}
            <span class="session-title">${escapeHtml(s.title || s.key)}</span>
            <span class="badge ${status === "live" ? "direct" : status === "dead" ? "software" : ""}">${status}</span>
          </div>
          <div class="session-sub">
            offset ${fmtClock(s.offsetS)} · ${s.segments} segments · idle ${s.idleSeconds}s
          </div>
          ${s.logTail ? `<details class="session-log"><summary>ffmpeg log</summary><pre>${escapeHtml(s.logTail)}</pre></details>` : ""}
        </div>`;
      }).join("");
}

// Playback section: the capabilities probe, rendered as a readable card
// instead of a hover tooltip.
async function renderCapabilities() {
  const el = document.getElementById("caps-content");
  try {
    const caps = await api("/api/v1/system/capabilities");
    const rows = [
      ["ffmpeg", caps.ffmpegVersion || "—"],
      ["VAAPI device", (caps.vaapi && caps.vaapi.device) || "—"],
      ["Driver", caps.driver || "—"],
      ["Hardware encoders", Object.entries(caps.encoders || {})
        .map(([k, v]) => `${k} ${v ? "✓" : "✗"}`).join("   ")],
      ["HDR tone mapping", caps.hdrToneMap ? "✓ supported" : "✗"],
      ["Browser direct play", [
        CAN_HEVC ? "HEVC ✓" : "HEVC ✗",
        CAN_AC3 ? "AC-3 ✓" : "AC-3 ✗",
        CAN_EAC3 ? "E-AC-3 ✓" : "E-AC-3 ✗",
      ].join("   ")],
    ];
    const errs = Object.entries(caps.encoderErrors || {});
    el.innerHTML = `
      <dl class="info-grid">${rows.map(([k, v]) =>
        `<dt>${escapeHtml(k)}</dt><dd>${escapeHtml(String(v))}</dd>`).join("")}</dl>
      ${errs.length ? `<h4 class="caps-err-head">Encoder probe errors</h4>
        <pre class="caps-errors">${escapeHtml(errs.map(([k, v]) => `${k}: ${v}`).join("\n"))}</pre>` : ""}`;
  } catch (e) {
    el.innerHTML = `<span class="err">${escapeHtml(e.message)}</span>`;
  }
}

// Users section: switch or create watch-state identities.
async function renderUsers() {
  const el = document.getElementById("users-list");
  try {
    users = await api("/api/v1/users");
    el.innerHTML = users.map((u) =>
      `<button class="user-chip${currentUser && u.id === currentUser.id ? " active" : ""}"
         data-uid="${u.id}"><span class="ic ic-user"></span> ${escapeHtml(u.name)}</button>`).join("");
    el.querySelectorAll(".user-chip").forEach((chip) => {
      chip.onclick = () => {
        currentUser = users.find((u) => u.id === chip.dataset.uid) || currentUser;
        renderUserBadge();
        renderUsers();
      };
    });
  } catch (e) {
    el.innerHTML = `<span class="err">${escapeHtml(e.message)}</span>`;
  }
}

document.getElementById("user-create").onclick = async () => {
  const input = document.getElementById("user-new-name");
  const name = input.value.trim();
  if (!name) return;
  try {
    const u = await api("/api/v1/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    input.value = "";
    await renderUsers();
    toast(`User added: ${u.name}`);
  } catch (e) {
    toast(e.message, "err");
  }
};

function libraryRow(lib = { name: "", path: "", kind: "movies" }) {
  const row = document.createElement("div");
  row.className = "lib-row";
  row.innerHTML = `
    <input class="lib-name" placeholder="Name (Movies)" value="${escapeHtml(lib.name)}">
    <input class="lib-path" placeholder="/media/movies" value="${escapeHtml(lib.path)}">
    <select class="lib-kind">
      <option value="movies"${lib.kind === "tv" ? "" : " selected"}>Movies</option>
      <option value="tv"${lib.kind === "tv" ? " selected" : ""}>TV</option>
    </select>
    <span class="lib-move">
      <button class="lib-up" title="Move up">▲</button>
      <button class="lib-down" title="Move down">▼</button>
    </span>
    <button class="lib-remove" title="Remove"><span class="ic ic-close"></span></button>`;
  row.querySelector(".lib-remove").onclick = () => row.remove();
  // Row order IS the library order — it persists on save and drives the
  // nav order, home rails, and scan order.
  row.querySelector(".lib-up").onclick = () => {
    if (row.previousElementSibling) libsRows.insertBefore(row, row.previousElementSibling);
  };
  row.querySelector(".lib-down").onclick = () => {
    if (row.nextElementSibling) libsRows.insertBefore(row.nextElementSibling, row);
  };
  return row;
}

function renderLibraryRows(libs) {
  libsRows.innerHTML = "";
  for (const lib of libs || []) libsRows.appendChild(libraryRow(lib));
  if (!libs || libs.length === 0) libsRows.appendChild(libraryRow());
}

function missingPathNote(libs) {
  const missing = (libs || []).filter((l) => l.exists === false);
  if (missing.length === 0) return "";
  const list = missing.map((l) => `${l.name} (${l.path})`).join(", ");
  return `<br><span class="err">Path not visible inside the container: ${escapeHtml(list)} — check the bind mount (e.g. /media/movies-anime, not /movies-anime).</span>`;
}

document.getElementById("libs-add").onclick = () => libsRows.appendChild(libraryRow());

const libsSaveButton = document.getElementById("libs-save");
libsSaveButton.onclick = async () => {
  if (libsSaveButton.disabled) return;
  const libs = [...libsRows.querySelectorAll(".lib-row")].map((row) => ({
    name: row.querySelector(".lib-name").value.trim(),
    path: row.querySelector(".lib-path").value.trim(),
    kind: row.querySelector(".lib-kind").value,
  })).filter((lib) => lib.name || lib.path);

  libsSaveButton.disabled = true;
  libsStatus.textContent = "Saving…";
  try {
    const saved = await api("/api/v1/config/libraries", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(libs),
    });
    libsStatus.innerHTML = `<span class="ok">Saved ${saved.length} librar${saved.length === 1 ? "y" : "ies"} — scanning…</span>${missingPathNote(saved)}`;
    renderLibraryRows(saved);
    await loadLibraries();
    refreshCurrentView(); // loadLibraries no longer auto-loads the home view
  } catch (e) {
    libsStatus.innerHTML = `<span class="err">${escapeHtml(e.message)}</span>`;
  } finally {
    libsSaveButton.disabled = false;
  }
};

// --- *arr status (downloads & upcoming, inside Settings → Integrations) ---------

const arrButton = document.getElementById("arr-button");

function fmtPct(left, total) {
  if (!total) return "";
  return `${Math.round(((total - left) / total) * 100)}%`;
}

arrButton.onclick = () => openSettings("sec-integrations");

// --- *arr instance editor (inside Settings → Integrations) ----------------------
// Rows mirror the library editor: name / URL / API key, add + remove + save.
// Saving persists server-side (lumina.json) and refreshes the status view.

const arrRows = document.getElementById("arr-rows");
const arrConfigStatus = document.getElementById("arr-config-status");

function arrRowHtml(inst) {
  return `
    <div class="arr-edit-row">
      <input class="arr-name" placeholder="sonarr" value="${escapeHtml(inst.name || "")}">
      <input class="arr-url" placeholder="http://sonarr:8989" value="${escapeHtml(inst.url || "")}">
      <input class="arr-key" placeholder="API key" type="password" value="${escapeHtml(inst.apiKey || "")}">
      <button class="lib-remove" title="Remove"><span class="ic ic-close"></span></button>
    </div>`;
}

async function renderArrEditor() {
  arrConfigStatus.textContent = "";
  let instances = [];
  try {
    instances = await api("/api/v1/config/arr");
  } catch (e) {
    arrConfigStatus.innerHTML = `<span class="err">${escapeHtml(e.message)}</span>`;
  }
  arrRows.innerHTML = (instances || []).map(arrRowHtml).join("") ||
    `<div class="libs-note">No instances yet — add one, or keep webhooks-only.</div>`;
  arrRows.querySelectorAll(".lib-remove").forEach((btn) => {
    btn.onclick = () => btn.closest(".arr-edit-row").remove();
  });
}

document.getElementById("arr-add").onclick = () => {
  if (arrRows.querySelector(".libs-note")) arrRows.innerHTML = "";
  arrRows.insertAdjacentHTML("beforeend", arrRowHtml({}));
  const btn = arrRows.lastElementChild.querySelector(".lib-remove");
  btn.onclick = () => btn.closest(".arr-edit-row").remove();
};

document.getElementById("arr-save").onclick = async () => {
  const instances = [...arrRows.querySelectorAll(".arr-edit-row")].map((row) => ({
    name: row.querySelector(".arr-name").value.trim(),
    url: row.querySelector(".arr-url").value.trim(),
    apiKey: row.querySelector(".arr-key").value.trim(),
  })).filter((i) => i.url);
  arrConfigStatus.textContent = "Saving…";
  try {
    await api("/api/v1/config/arr", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(instances),
    });
    arrConfigStatus.textContent = `Saved ${instances.length} instance(s).`;
    loadArrStatus();
  } catch (e) {
    arrConfigStatus.innerHTML = `<span class="err">${escapeHtml(e.message)}</span>`;
  }
};

// Plex auto-sync loop state — one quiet line above the manual controls.
async function loadPlexSyncStatus() {
  const el = document.getElementById("plex-sync-status");
  try {
    const st = await api("/api/v1/plex/syncstatus");
    if (!st.configured) {
      el.textContent = "Save a Plex URL + token and watch state auto-syncs here.";
      return;
    }
    const last = st.lastRun && !st.lastRun.startsWith("0001-")
      ? new Date(st.lastRun).toLocaleString() : "not yet";
    el.textContent = st.enabled
      ? `Auto-sync every ${st.intervalMinutes} min · last run: ${last}${st.summary ? ` — ${st.summary}` : ""}`
      : "Auto-sync disabled (syncIntervalMinutes < 0).";
  } catch { el.textContent = ""; }
}

// Re-identify everything TMDB hasn't matched (Settings → Libraries).
document.getElementById("rematch-btn").onclick = async () => {
  const el = document.getElementById("rematch-status");
  el.textContent = "Queueing…";
  try {
    const r = await api("/api/v1/metadata/rematch-unidentified", { method: "POST" });
    el.textContent = r.queued > 0
      ? `Queued ${r.queued} item(s) — matches land over the next minute or so.`
      : "Nothing unmatched — every active item has a TMDB id.";
    if (r.queued > 0) setTimeout(() => refreshCurrentView(), 20000);
  } catch (e) {
    el.innerHTML = `<span class="err">${escapeHtml(e.message)}</span>`;
  }
};

async function loadArrStatus() {
  const el = document.getElementById("arr-content");
  el.innerHTML = `<div class="arr-error">Loading…</div>`;
  try {
    const statuses = await api("/api/v1/arr/status");
    if (statuses.length === 0) {
      el.innerHTML = `<div class="arr-error">No *arr instances configured.</div>`;
      return;
    }
    el.innerHTML = statuses.map((st) => {
      if (!st.reachable) {
        return `<h4>${st.name}</h4><div class="arr-error">unreachable — ${st.error || ""}</div>`;
      }
      const queue = (st.queue || []).map((q) => `
        <div class="arr-row"><span class="t" title="${q.title}">${q.title}</span>
        <span class="r">${fmtPct(q.sizeLeft, q.size)} ${q.timeLeft || q.status}</span></div>`).join("");
      const upcoming = (st.upcoming || []).slice(0, 8).map((c) => `
        <div class="arr-row"><span class="t">${c.title}${c.subtitle ? " · " + c.subtitle : ""}</span>
        <span class="r">${c.airDate}${c.hasFile ? " ✓" : ""}</span></div>`).join("");
      return `<h4>${st.name} <span class="r" style="font-weight:400;color:var(--muted)">${st.version || ""}</span></h4>
        ${queue ? `<h5>Queue</h5>${queue}` : ""}
        ${upcoming ? `<h5>Next 7 days</h5>${upcoming}` : ""}
        ${!queue && !upcoming ? `<div class="arr-error">Idle — nothing queued or upcoming.</div>` : ""}`;
    }).join("");
  } catch (e) {
    el.innerHTML = `<div class="arr-error">${e.message}</div>`;
  }
}

// --- Plex import (inside Settings → Integrations) ------------------------------

const plexUrl = document.getElementById("plex-url");
const plexToken = document.getElementById("plex-token");
const plexDirection = document.getElementById("plex-direction");
const plexResult = document.getElementById("plex-result");
const plexApplyBtn = document.getElementById("plex-apply");

plexUrl.value = localStorage.getItem("lumina.plexUrl") || "";
plexToken.value = localStorage.getItem("lumina.plexToken") || "";

// Server-saved connection wins over the browser's memory: the settings UI
// prefills from lumina.json whenever the Integrations section opens.
async function prefillPlexConfig() {
  try {
    const cfg = await api("/api/v1/config/plex");
    if (cfg) {
      if (cfg.url) plexUrl.value = cfg.url;
      if (cfg.token) plexToken.value = cfg.token;
    }
  } catch { /* older server or no config — localStorage values stay */ }
}

function savePlexConfig() {
  api("/api/v1/config/plex", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: plexUrl.value.trim(), token: plexToken.value.trim() }),
  }).catch(() => {}); // saving must never block a sync run
}

function plexBody(apply) {
  localStorage.setItem("lumina.plexUrl", plexUrl.value);
  localStorage.setItem("lumina.plexToken", plexToken.value);
  savePlexConfig(); // persist server-side too — survives browser/device changes
  return {
    url: plexUrl.value,
    token: plexToken.value,
    userId: currentUser ? currentUser.id : "",
    direction: plexDirection.value,
    apply,
  };
}

document.getElementById("plex-test").onclick = async () => {
  plexResult.innerHTML = `<span class="plex-error">Testing…</span>`;
  try {
    const q = new URLSearchParams({ url: plexUrl.value, token: plexToken.value });
    const r = await api(`/api/v1/plex/test?${q}`);
    plexResult.innerHTML = `<div class="summary">Connected to <b>${r.serverName || "Plex"}</b> — ${r.sections.length} movie/show section(s):
      ${r.sections.map((s) => s.title).join(", ")}</div>`;
  } catch (e) {
    plexResult.innerHTML = `<span class="plex-error">${e.message}</span>`;
  }
};

document.getElementById("plex-preview").onclick = () => runPlexImport(false);
plexApplyBtn.onclick = () => runPlexImport(true);

async function runPlexImport(apply) {
  plexApplyBtn.disabled = true;
  plexResult.innerHTML = `<span class="plex-error">${apply ? "Applying import…" : "Scanning Plex library…"}</span>`;
  try {
    const r = await api("/api/v1/plex/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(plexBody(apply)),
    });
    const rows = (r.items || []).map((it) => `
      <tr><td title="${it.title}">${it.title}</td>
      <td>${it.subtitle || ""}</td>
      <td class="act-${it.action}">${it.action}</td>
      <td>${it.method || "—"}</td></tr>`).join("");
    plexResult.innerHTML = `
      <div class="summary">
        ${r.mode === "apply" ? "<b>Applied.</b> " : "<b>Preview</b> — nothing written. "}
        Scanned <b>${r.scanned}</b> · matched <b>${r.matched}</b> ·
        unmatched <b>${r.unmatched}</b> · already synced ${r.alreadySynced} ·
        to mark in Lumina <b>${r.markedLumina}</b> · to scrobble ${r.scrobbledPlex}
        ${r.errors.length ? `<br><span class="plex-error">${r.errors.length} error(s): ${r.errors[0]}</span>` : ""}
      </div>
      ${rows ? `<table>${rows}</table>` : ""}
      ${r.itemsTruncated ? `<div class="plex-error">…list truncated</div>` : ""}`;
    // Apply only unlocks after a preview with something to do.
    if (!apply && (r.markedLumina > 0 || r.scrobbledPlex > 0)) {
      plexApplyBtn.disabled = false;
    }
    if (apply && activeLib) loadItems(activeLib); // watched badges refresh
  } catch (e) {
    plexResult.innerHTML = `<span class="plex-error">${e.message}</span>`;
  }
}

function closePlayer() {
  overlay.classList.add("hidden");
  stopPlayback(); // flushes the final playhead report before teardown
  if (activeLib) refreshCurrentView();
}
document.getElementById("player-close").onclick = closePlayer;
// Stop = the transport-control way out (Plex convention): same flush +
// close, but reachable without leaving the controls row.
document.getElementById("pc-stop").onclick = closePlayer;

// --- boot -----------------------------------------------------------------------------

(async () => {
  try {
    // Skeleton home while the API answers — hero block + two shimmer rails,
    // replaced wholesale when loadHome() renders. First paint feels instant
    // even when the libraries call takes seconds on a big SMB library.
    grid.className = "home";
    grid.innerHTML = `
      <section class="hero skel skel-hero"></section>
      ${[0, 1].map(() => `
        <section class="rail">
          <div class="rail-head"><div class="skel skel-line"></div></div>
          <div class="rail-track">${'<div class="skel skel-card"></div>'.repeat(6)}</div>
        </section>`).join("")}`;
    await loadUsers();
    // Libraries (nav) and home (content) load in parallel — the nav catches
    // up its counts via lastVisibleItems when it lands second.
    await Promise.all([loadLibraries(), loadHome()]);
  } catch (e) {
    grid.innerHTML = `<div id="empty">Failed to reach Lumina API: ${e.message}</div>`;
  }
})();

// --- toasts -------------------------------------------------------------------------
// Small, quiet confirmations for background actions (match applied, watched
// toggled, scan queued). They stack bottom-right and dismiss themselves.

function toast(msg, kind = "ok") {
  let holder = document.getElementById("toasts");
  if (!holder) {
    holder = document.createElement("div");
    holder.id = "toasts";
    document.body.appendChild(holder);
  }
  const el = document.createElement("div");
  el.className = `toast ${kind}`;
  el.textContent = msg;
  holder.appendChild(el);
  setTimeout(() => el.classList.add("gone"), 3600);
  setTimeout(() => el.remove(), 4200);
}

// --- card context menu ---------------------------------------------------------------
// Right-click (long-press equivalent later) on ANY card — home rails or
// library grid — instead of a "..." button cluttering every poster.
// Pattern: one menu element, event delegation, close on any outside event.

let cardMenu = null;

function closeCardMenu() {
  if (cardMenu) {
    cardMenu.remove();
    cardMenu = null;
  }
}

function menuItem(label, fn) {
  const b = document.createElement("button");
  b.type = "button";
  b.innerHTML = label; // labels carry Lumina icon spans
  b.onclick = () => {
    closeCardMenu();
    fn();
  };
  return b;
}

function openCardMenu(x, y, it) {
  closeCardMenu();
  closeModal();
  const ph = playheads[it.id];
  cardMenu = document.createElement("div");
  cardMenu.className = "card-menu";
  cardMenu.append(
    menuItem(`<span class="ic ic-play"></span> Play ${ph && !ph.watched && ph.positionMs > 0 ? "(resume)" : ""}`, () => play(it)),
    menuItem(`<span class="ic ic-info"></span> Media info`, () => openInfoModal(it)),
    menuItem(`<span class="ic ic-edit"></span> Fix match…`, () => openMatchModal(it)),
    menuItem(myListIds[it.id]
      ? `<span class="ic ic-bookmark"></span> Remove from My List`
      : `<span class="ic ic-bookmark"></span> Add to My List`,
      () => toggleMyList(it)),
    menuItem("Re-identify", async () => {
      try {
        await api(`/api/v1/items/${it.id}/metadata/refresh`, { method: "POST" });
        toast("Re-identification queued");
      } catch (e) {
        toast(e.message, "err");
      }
    }),
  );
  if (currentUser) {
    cardMenu.appendChild(menuItem(
      ph && ph.watched ? "Mark unwatched" : `<span class="ic ic-check"></span> Mark watched`,
      () => toggleWatched(it, !(ph && ph.watched)),
    ));
    if (ph && !ph.watched && ph.positionMs > 0) {
      // Plex's "Remove from Continue Watching": same journal write as
      // unwatched — zero position with a nonzero duration reads as
      // "no resume point".
      cardMenu.appendChild(menuItem(`<span class="ic ic-close"></span> Remove from Continue Watching`,
        () => toggleWatched(it, false)));
    }
  }
  if (it.paths && it.paths[0]) {
    cardMenu.appendChild(menuItem("Copy file path", async () => {
      try {
        await navigator.clipboard.writeText(it.paths[0]);
        toast("Path copied");
      } catch {
        toast("Clipboard blocked — see Media info", "err");
      }
    }));
  }
  document.body.appendChild(cardMenu);
  // Clamp inside the viewport (menu may open near the right/bottom edge).
  const r = cardMenu.getBoundingClientRect();
  cardMenu.style.left = `${Math.min(x, innerWidth - r.width - 8)}px`;
  cardMenu.style.top = `${Math.min(y, innerHeight - r.height - 8)}px`;
}

document.addEventListener("contextmenu", (e) => {
  const card = e.target.closest(".card, .media-card, .ep-row");
  if (!card || !card.dataset.id) return;
  const it = itemById.get(card.dataset.id);
  if (!it) return;
  e.preventDefault();
  openCardMenu(e.clientX, e.clientY, it);
});
document.addEventListener("click", (e) => {
  if (cardMenu && !cardMenu.contains(e.target)) closeCardMenu();
});
document.addEventListener("scroll", closeCardMenu, { passive: true, capture: true });

async function toggleWatched(it, watched) {
  try {
    await api(`/api/v1/items/${it.id}/playhead`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // The journal derives watched from position/duration (≥92%). A 1ms/1ms
      // row reads as watched; 0/1 reads as unwatched with no resume point.
      body: JSON.stringify({
        userId: currentUser.id,
        positionMs: watched ? 1 : 0,
        durationMs: 1,
      }),
    });
    playheads = await api(`/api/v1/users/${currentUser.id}/playheads`);
    toast(watched ? "Marked watched" : "Marked unwatched");
    refreshCurrentView();
  } catch (e) {
    toast(e.message, "err");
  }
}

function refreshCurrentView() {
  if (activeLib && activeLib.kind === "mylist") loadMyList();
  else if (activeLib) loadItems(activeLib);
  else loadHome();
}

// --- modals (info + fix match) ---------------------------------------------------------

let activeModal = null;

function closeModal() {
  if (activeModal) {
    activeModal.remove();
    activeModal = null;
  }
}

function openModal(titleText) {
  closeModal();
  const wrap = document.createElement("div");
  wrap.className = "modal-wrap";
  wrap.innerHTML = `
    <div class="modal">
      <div class="modal-head">
        <h3></h3>
        <button type="button" class="modal-close" title="Close"><span class="ic ic-close"></span></button>
      </div>
      <div class="modal-body"></div>
    </div>`;
  wrap.querySelector("h3").textContent = titleText;
  wrap.querySelector(".modal-close").onclick = closeModal;
  wrap.onclick = (e) => {
    if (e.target === wrap) closeModal();
  };
  document.body.appendChild(wrap);
  activeModal = wrap;
  return wrap.querySelector(".modal-body");
}

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    closeCardMenu();
    closeModal();
    closeSettings();
    closeSearch();
    closeUpNext();
    return;
  }
  // Player shortcuts — only while the overlay is up, and never while
  // typing in the subtitle select or a form field.
  if (overlay.classList.contains("hidden")) return;
  const tag = (e.target.tagName || "").toUpperCase();
  if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
  switch (e.key) {
    case " ":
    case "k":
      e.preventDefault(); // space must not page-scroll underneath
      togglePlay();
      break;
    case "ArrowLeft": seekBy(-10); break;
    case "ArrowRight": seekBy(10); break;
    case "f": pcFull.click(); break;
    case "m": video.muted = !video.muted; break;
    default: return;
  }
  pokeControls();
});

async function openInfoModal(it) {
  const body = openModal(it.title);
  body.innerHTML = `<div class="modal-note">Probing file…</div>`;
  let info = null;
  try {
    info = await api(`/api/v1/items/${it.id}/info`);
  } catch (e) {
    body.innerHTML = `<div class="modal-note err">ffprobe failed: ${escapeHtml(e.message)}</div>`;
    return;
  }
  const rows = [
    ["Library", it.library],
    ["Kind", it.kind],
    ["Year", it.year || "—"],
    ["Genres", (it.genres || []).join(", ") || "—"],
    ["Size", fmtBytes(it.sizeBytes)],
    ["Container", info.container],
    ["Duration", info.durationS ? `${Math.round(info.durationS / 60)} min` : "—"],
    ["TMDB", it.tmdbId ? `#${it.tmdbId}` : "unidentified"],
  ];
  if (info.video) {
    rows.push(["Video", [info.video.codec, info.video.profile,
      info.video.width && `${info.video.width}×${info.video.height}`,
      info.hdr ? "HDR" : ""].filter(Boolean).join(" · ")]);
  }
  for (const a of info.audio || []) {
    rows.push([`Audio ${a.index}`, [a.codec, a.channels ? `${a.channels}ch` : "", a.language].filter(Boolean).join(" · ")]);
  }
  for (const p of it.paths || []) {
    rows.push(["Path", p]);
  }
  body.innerHTML = `
    ${it.overview ? `<p class="modal-overview">${escapeHtml(it.overview)}</p>` : ""}
    <dl class="info-grid">
      ${rows.map(([k, v]) => `<dt>${escapeHtml(k)}</dt><dd>${escapeHtml(String(v ?? "—"))}</dd>`).join("")}
    </dl>`;
}

// --- fix match ------------------------------------------------------------------------

function titleForSearch(it) {
  // "Series Name S02E04" → "Series Name"; trailing "(2023)" / ".2023." gone.
  return it.title
    .replace(/\s+S\d{1,2}E\d{1,3}.*$/i, "")
    .replace(/[._]/g, " ")
    .replace(/\s+\d{4}$/, "")
    .trim();
}

async function openMatchModal(it) {
  const kind = it.kind === "episode" ? "tv" : "movies";
  const body = openModal(`Fix match — ${it.title}`);
  body.innerHTML = `
    <form class="match-form">
      <input type="search" class="match-q" value="${escapeHtml(titleForSearch(it))}" placeholder="Search TMDB…">
      <button type="submit" class="text-button">Search</button>
    </form>
    <div class="match-results"><div class="modal-note">Search TMDB, then click the right match.</div></div>`;

  const qInput = body.querySelector(".match-q");
  const results = body.querySelector(".match-results");

  async function runSearch() {
    const q = qInput.value.trim();
    if (!q) return;
    results.innerHTML = `<div class="modal-note">Searching…</div>`;
    let found;
    try {
      found = await api(`/api/v1/metadata/search?kind=${kind}&q=${encodeURIComponent(q)}`);
    } catch (e) {
      results.innerHTML = `<div class="modal-note err">${escapeHtml(e.message)}</div>`;
      return;
    }
    if (!found || found.length === 0) {
      results.innerHTML = `<div class="modal-note">No TMDB results for “${escapeHtml(q)}”.</div>`;
      return;
    }
    results.innerHTML = "";
    for (const r of found) {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "match-row";
      row.innerHTML = `
        ${r.posterUrl
          ? `<img src="${r.posterUrl}" alt="" loading="lazy" onerror="this.remove()">`
          : `<span class="match-noimg" style="${posterStyle(r.title)}">${posterInitials(r.title)}</span>`}
        <span class="match-meta">
          <span class="match-title">${escapeHtml(r.title)}${r.year ? ` <em>${r.year}</em>` : ""}</span>
          <span class="match-ov">${escapeHtml((r.overview || "").slice(0, 140))}${(r.overview || "").length > 140 ? "…" : ""}</span>
        </span>`;
      row.onclick = async () => {
        row.disabled = true;
        try {
          const updated = await api(`/api/v1/items/${it.id}/identify`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ tmdbId: r.tmdbId }),
          });
          if (updated) itemById.set(updated.id, updated);
          toast(`Matched: ${r.title}${r.year ? ` (${r.year})` : ""}`);
          closeModal();
          refreshCurrentView();
        } catch (e) {
          row.disabled = false;
          toast(e.message, "err");
        }
      };
      results.appendChild(row);
    }
  }

  body.querySelector(".match-form").onsubmit = (e) => {
    e.preventDefault();
    runSearch();
  };
  runSearch(); // prefill + auto-search with the parsed title
}
