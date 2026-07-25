// Subtitle endpoints: track discovery + WebVTT delivery.
package api

import (
	"fmt"
	"net/http"
	"strconv"
	"strings"

	"github.com/lumina-media/lumina/internal/media"
)

// GET /api/v1/items/{id}/subtitles — every selectable track (sidecars
// + embedded text streams). Bitmap subs are excluded by design.
func (s *Server) listSubtitles(w http.ResponseWriter, r *http.Request) {
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
	writeJSON(w, media.DiscoverSubtitles(path, info))
}

// GET /api/v1/items/{id}/subtitles/{subid} — the track as WebVTT.
// "sc-N" sidecars convert SRT in-process (cheap); ASS/SSA and "emb-N"
// go through ffmpeg. No ffprobe needed at serve time.
func (s *Server) subtitleVTT(w http.ResponseWriter, r *http.Request) {
	it := s.itemFor(w, r)
	if it == nil {
		return
	}
	path, err := s.playablePath(it)
	if err != nil {
		http.Error(w, err.Error(), http.StatusGone)
		return
	}
	subID := r.PathValue("subid")

	var vtt string
	switch {
	case strings.HasPrefix(subID, "sc-"):
		subPath, ok := media.LookupSidecar(path, subID)
		if !ok {
			http.Error(w, "subtitle not found", http.StatusNotFound)
			return
		}
		vtt, err = media.SidecarVTT(r.Context(), s.cfg.FFmpegPath, subPath)
	case strings.HasPrefix(subID, "emb-"):
		idx, convErr := strconv.Atoi(strings.TrimPrefix(subID, "emb-"))
		if convErr != nil {
			http.Error(w, "bad subtitle id", http.StatusBadRequest)
			return
		}
		vtt, err = media.EmbeddedVTT(r.Context(), s.cfg.FFmpegPath, path, idx)
	default:
		http.Error(w, "bad subtitle id", http.StatusBadRequest)
		return
	}
	if err != nil {
		http.Error(w, fmt.Sprintf("subtitle conversion: %v", err), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "text/vtt; charset=utf-8")
	w.Header().Set("Cache-Control", "max-age=3600")
	fmt.Fprint(w, vtt)
}
