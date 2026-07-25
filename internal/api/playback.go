// Playback endpoints: media info, direct play, and HLS transcode delivery.
package api

import (
	"mime"
	"net/http"
	"os"
	"path/filepath"
	"strconv"

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
	info, err := media.Probe(r.Context(), s.cfg.FFprobePath, path)
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
		info, err := media.Probe(r.Context(), s.cfg.FFprobePath, path)
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
