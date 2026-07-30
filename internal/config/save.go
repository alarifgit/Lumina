package config

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
)

// SaveKey updates ONE top-level key in the JSON config file. It
// deliberately round-trips through map[string]any so unrelated settings,
// future keys, and env-provided secrets are not rewritten or persisted by
// accident. The write is atomic (temp file + rename) because /config is a
// Docker bind mount and a half-written lumina.json would be a bad time.
func SaveKey(path, key string, value any) error {
	doc := map[string]any{}
	if data, err := os.ReadFile(path); err == nil && len(data) > 0 {
		if err := json.Unmarshal(data, &doc); err != nil {
			return fmt.Errorf("parse %s: %w", path, err)
		}
	} else if err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("read %s: %w", path, err)
	}

	raw, err := json.Marshal(value)
	if err != nil {
		return err
	}
	var valueAny any
	if err := json.Unmarshal(raw, &valueAny); err != nil {
		return err
	}
	doc[key] = valueAny

	out, err := json.MarshalIndent(doc, "", "  ")
	if err != nil {
		return err
	}
	out = append(out, '\n')

	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return fmt.Errorf("create config dir: %w", err)
	}
	tmp, err := os.CreateTemp(dir, ".lumina-*.json")
	if err != nil {
		return fmt.Errorf("create temp config: %w", err)
	}
	tmpName := tmp.Name()
	defer os.Remove(tmpName)
	if _, err := tmp.Write(out); err != nil {
		tmp.Close()
		return fmt.Errorf("write temp config: %w", err)
	}
	if err := tmp.Chmod(0o644); err != nil {
		tmp.Close()
		return fmt.Errorf("chmod temp config: %w", err)
	}
	if err := tmp.Close(); err != nil {
		return fmt.Errorf("close temp config: %w", err)
	}
	if err := os.Rename(tmpName, path); err != nil {
		return fmt.Errorf("replace %s: %w", path, err)
	}
	return nil
}

// SaveLibraries updates ONLY the "libraries" key in the JSON config file.
func SaveLibraries(path string, libs []LibraryRoot) error {
	return SaveKey(path, "libraries", libs)
}

// SavePlex updates ONLY the "plex" key (URL + token for watch-state sync).
func SavePlex(path string, plex PlexConfig) error {
	return SaveKey(path, "plex", plex)
}

// SaveArr updates ONLY the "arr" key (Radarr/Sonarr instances for the
// downloads queue + calendar views and their webhooks).
func SaveArr(path string, arr []ArrInstance) error {
	return SaveKey(path, "arr", arr)
}
