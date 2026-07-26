// Playback endpoints: media info, direct play, and HLS transcode delivery.
package api

import (
	"mime"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/lumina-media/lumina/internal/library"
	"github.com/lumina-media/lumina/internal/media"
	"github.com/lumina-media/lumina/internal/transcode"
)

// playablePath returns the item's first on-disk path, verifying it exists.
func (s *Server) playablePath(it *library.Item) (string, error) {
	for _, p := range it.Paths {
		if _, err := os.Stat(p); err == nil {
			return p, nil
		}
	}
	return "", errNoPlayablePath
}

var errNoPlayablePath = errString("no playable path on disk")

type errString string

func (e errString) Error() string { return string(e) }

func (s *Server) itemFor(w http.ResponseWriter, r *http.Request) *library.Item {
	it, err := s.store.Get(r.PathValue("id"))
	if err != nil {
		http.Error(w, "store error", http.StatusInternalServerError)
		return nil
	}
	if it == nil {
		http.Error(w, "not found", http.StatusNotFound)
		return nil
	}
	return it
}

// GET /api/v1/items/{id} — item detail.
func (s *Server) getItem(w http.ResponseWriter, r *http.Request) {
	if it := s.itemFor(w, r); it != nil {
		writeJSON(w, it)
	}
}

// GET /api/v1/items/{id}/info — ffprobe stream/codec detail. The web
// client uses this for the direct-play vs transcode decision.
func (s *Server) itemInfo(w http.ResponseWriter, r *http.Request) {
	it := s.itemFor(w, r)
	if it == nil {
		return
	}
	path, err := s.playablePath(it)
	if err != nil {
		http.Error(w, err.Error(), http.StatusGone)
		return
	}
	info, err := s.probeCached(r.Context(), it, path)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	writeJSON(w, info)
}

// GET /api/v1/items/{id}/stream — direct play. http.ServeContent gives
// us Range requests (seeking) for free.
func (s *Server) directStream(w http.ResponseWriter, r *http.Request) {
	it := s.itemFor(w, r)
	if it == nil {
		return
	}
	path, err := s.playablePath(it)
	if err != nil {
		http.Error(w, err.Error(), http.StatusGone)
		return
	}
	f, err := os.Open(path)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer f.Close()
	fi, err := f.Stat()
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	// ServeContent sets Content-Type from the extension; for browsers the
	// container matters more than the codecs inside (that's why MKV is a
	// transcode candidate even though Chrome plays most MKV codecs).
	if ext := filepath.Ext(path); mime.TypeByExtension(ext) != "" {
		w.Header().Set("Content-Type", mime.TypeByExtension(ext))
	}
	http.ServeContent(w, r, filepath.Base(path), fi.ModTime(), f)
}

// GET /api/v1/items/{id}/hls/{file...} — HLS transcode delivery.
// The first request starts the session; segment requests poll until
// FFmpeg has produced the file, hiding transcode latency behind the
// client's normal HLS buffering.
func (s *Server) hlsFile(w http.ResponseWriter, r *http.Request) {
	it := s.itemFor(w, r)
	if it == nil {
		return
	}
	path, err := s.playablePath(it)
	if err != nil {
		http.Error(w, err.Error(), http.StatusGone)
		return
	}
	// Restart-on-seek: ?start=<seconds> keys the session. A far-ahead seek
	// in the client starts a NEW session at that offset; old ones idle out.
	start := 0.0
	if v := r.URL.Query().Get("start"); v != "" {
		if f, err := strconv.ParseFloat(v, 64); err == nil && f > 0 {
			start = f
		}
	}
	key := transcode.SessionKey(it.ID, start)

	// Session already running? Skip the ffprobe entirely — segment
	// requests arrive several times per minute and must stay cheap.
	sess := s.tm.Get(key)
	if sess == nil {
		info, err := s.probeCached(r.Context(), it, path)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		sess, err = s.tm.Ensure(it.ID, path, info, start)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
	}
	file := r.PathValue("file")
	if file == "" {
		file = "index.m3u8"
	}
	// The web client reads its mode badge from this header — the playlist
	// body is text, so the mode can't travel in the payload.
	w.Header().Set("X-Lumina-Session-Mode", sess.Mode)
	full, err := sess.WaitFile(file)
	if err != nil {
		http.Error(w, err.Error(), http.StatusServiceUnavailable)
		return
	}
	switch filepath.Ext(file) {
	case ".m3u8":
		w.Header().Set("Content-Type", "application/vnd.apple.mpegurl")
		w.Header().Set("Cache-Control", "no-cache")
	case ".ts":
		w.Header().Set("Content-Type", "video/mp2t")
	}
	http.ServeFile(w, r, full)
}

// GET /api/v1/system/sessions — active transcode sessions (admin view).
func (s *Server) sessions(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, s.tm.ActiveSessions())
}

// GET /api/v1/system/sessions/debug — every session with its ffmpeg log
// tail and on-disk files. The "why is my transcode stuck" answer, without
// needing docker exec.
func (s *Server) sessionsDebug(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, s.tm.DebugSessions())
}

// GET /api/v1/system/activity — the Now Playing card's data: live
// transcode sessions (mode, frontier, ffmpeg log) joined with item
// titles/artwork, plus every user whose latest playhead report is fresh
// enough to count as "currently watching".
func (s *Server) activity(w http.ResponseWriter, _ *http.Request) {
	type sessionView struct {
		transcode.SessionDebug
		ItemID    string `json:"itemId"`
		OffsetS   int64  `json:"offsetS"`
		Segments  int    `json:"segments"`
		Title     string `json:"title,omitempty"`
		PosterURL string `json:"posterUrl,omitempty"`
		Kind      string `json:"kind,omitempty"`
	}
	type watchingView struct {
		UserID     string    `json:"userId"`
		UserName   string    `json:"userName"`
		ItemID     string    `json:"itemId"`
		Title      string    `json:"title"`
		PosterURL  string    `json:"posterUrl,omitempty"`
		Kind       string    `json:"kind"`
		Mode       string    `json:"mode,omitempty"` // transcode mode, when a session is live
		PositionMs int64     `json:"positionMs"`
		DurationMs int64     `json:"durationMs"`
		ReportedAt time.Time `json:"reportedAt"`
	}

	sessions := []sessionView{}
	// modeByItem lets the watching list show HOW each item is being served.
	modeByItem := map[string]string{}
	for _, d := range s.tm.DebugSessions() {
		v := sessionView{SessionDebug: d}
		if i := strings.Index(d.Key, "@"); i > 0 {
			v.ItemID = d.Key[:i]
			v.OffsetS, _ = strconv.ParseInt(d.Key[i+1:], 10, 64)
		}
		for _, f := range d.Files {
			if strings.HasSuffix(f, ".ts") {
				v.Segments++
			}
		}
		if it, err := s.store.Get(v.ItemID); err == nil && it != nil {
			v.Title, v.PosterURL, v.Kind = it.Title, it.PosterURL, string(it.Kind)
		}
		if v.ItemID != "" && !d.Dead {
			modeByItem[v.ItemID] = d.Mode
		}
		sessions = append(sessions, v)
	}

	userNames := map[string]string{}
	if users, err := s.store.ListUsers(); err == nil {
		for _, u := range users {
			userNames[u.ID] = u.Name
		}
	}
	watching := []watchingView{}
	// Clients report every ~10s while playing; 2 minutes covers pauses
	// between reports plus a stopped tab's final flush.
	if reports, err := s.store.RecentPlayheads(time.Now().Add(-2 * time.Minute)); err == nil {
		for _, r := range reports {
			v := watchingView{
				UserID: r.UserID, UserName: userNames[r.UserID],
				ItemID: r.ItemID, PositionMs: r.PositionMs,
				DurationMs: r.DurationMs, ReportedAt: r.ReportedAt,
				Mode: modeByItem[r.ItemID],
			}
			if it, err := s.store.Get(r.ItemID); err == nil && it != nil {
				v.Title, v.PosterURL, v.Kind = it.Title, it.PosterURL, string(it.Kind)
			}
			watching = append(watching, v)
		}
	}
	writeJSON(w, map[string]any{"sessions": sessions, "watching": watching})
}
