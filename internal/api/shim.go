// Emby/Jellyfin compatibility shim.
//
// Radarr/Sonarr ship a built-in "Connect" integration for Emby/Jellyfin:
// after an import they call the media server to trigger a targeted library
// refresh. By answering these few endpoints, Lumina gets instant,
// precise, event-driven updates with ZERO custom configuration on the
// *arr side — and later, compatibility with Jellyseerr/Overseerr, Bazarr,
// Notifiarr and friends.
//
// In Radarr/Sonarr: Settings → Connect → + → Emby (or Jellyfin) →
// host = lumina, port = 8096, API key = anything (Phase 5 adds real auth).
package api

import (
	"encoding/json"
	"net/http"
	"strings"
)

// registerShim mounts the compat endpoints both bare (Jellyfin-style)
// and under /emby (Emby-style). Radarr/Sonarr pick one; we answer both.
func (s *Server) registerShim(mux interface {
	HandleFunc(pattern string, handler func(http.ResponseWriter, *http.Request))
}) {
	for _, prefix := range []string{"", "/emby"} {
		mux.HandleFunc("GET "+prefix+"/System/Info", s.shimSystemInfo)
		mux.HandleFunc("GET "+prefix+"/System/Info/Public", s.shimSystemInfo)
		mux.HandleFunc("GET "+prefix+"/Library/VirtualFolders", s.shimVirtualFolders)
		mux.HandleFunc("POST "+prefix+"/Library/Media/Updated", s.shimMediaUpdated)
		mux.HandleFunc("POST "+prefix+"/Library/Refresh", s.shimLibraryRefresh)
	}
}

// shimAuthorized enforces the optional shared secret. Emby/Jellyfin
// clients send the key as ?api_key= or the X-Emby-Token header.
func (s *Server) shimAuthorized(w http.ResponseWriter, r *http.Request) bool {
	if s.cfg.ShimAPIKey == "" {
		return true
	}
	if r.URL.Query().Get("api_key") == s.cfg.ShimAPIKey ||
		r.Header.Get("X-Emby-Token") == s.cfg.ShimAPIKey {
		return true
	}
	http.Error(w, "unauthorized", http.StatusUnauthorized)
	return false
}

// shimSystemInfo answers the identity check Radarr/Sonarr perform when
// you press "Test" in the Connect settings. Reporting ProductName
// "Emby Server" is intentional — that is the point of the shim.
func (s *Server) shimSystemInfo(w http.ResponseWriter, r *http.Request) {
	if !s.shimAuthorized(w, r) {
		return
	}
	writeJSON(w, map[string]any{
		"ServerName":            "Lumina",
		"ProductName":           "Emby Server",
		"Version":               "4.8.0.0", // a version the *arrs recognise
		"Id":                    "lumina-0001",
		"OperatingSystem":       "Linux",
		"CanSelfRestart":        false,
		"HasUpdateAvailable":    false,
		"SupportsLibraryMonitor": true,
	})
}

// shimVirtualFolders lets tools enumerate Lumina's libraries using the
// Emby/Jellyfin shape.
func (s *Server) shimVirtualFolders(w http.ResponseWriter, r *http.Request) {
	if !s.shimAuthorized(w, r) {
		return
	}
	type vf struct {
		Name      string   `json:"Name"`
		Locations []string `json:"Locations"`
		CollectionType string `json:"CollectionType"`
	}
	out := []vf{}
	for _, root := range s.cfg.Libraries {
		ct := "movies"
		if root.Kind == "tv" {
			ct = "tvshows"
		}
		out = append(out, vf{Name: root.Name, Locations: []string{root.Path}, CollectionType: ct})
	}
	writeJSON(w, out)
}

// mediaUpdatedRequest is the Jellyfin/Emby "notify these paths changed" body.
type mediaUpdatedRequest struct {
	Updates []struct {
		Path        string `json:"Path"`
		UpdateType  string `json:"UpdateType"` // Created, Modified, Deleted
	} `json:"Updates"`
}

// shimMediaUpdated is the heart of the shim: Radarr/Sonarr call this right
// after importing a file. Each path becomes a Tier-2 scanner event.
func (s *Server) shimMediaUpdated(w http.ResponseWriter, r *http.Request) {
	if !s.shimAuthorized(w, r) {
		return
	}
	var req mediaUpdatedRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "bad body", http.StatusBadRequest)
		return
	}
	for _, u := range req.Updates {
		if u.Path == "" {
			continue
		}
		if strings.EqualFold(u.UpdateType, "Deleted") {
			s.sc.Remove(u.Path)
			continue
		}
		s.sc.Notify(u.Path)
	}
	w.WriteHeader(http.StatusNoContent)
}

// shimLibraryRefresh triggers an async full (incremental) scan of all roots.
func (s *Server) shimLibraryRefresh(w http.ResponseWriter, r *http.Request) {
	if !s.shimAuthorized(w, r) {
		return
	}
	for _, root := range s.cfg.Libraries {
		s.sc.Notify(root.Path) // directory paths → ScanRoot
	}
	w.WriteHeader(http.StatusNoContent)
}
