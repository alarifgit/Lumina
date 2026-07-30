package scanner

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"log"
	"os"
	"path/filepath"
	"strings"

	"github.com/lumina-media/lumina/internal/config"
	"github.com/lumina-media/lumina/internal/library"
	"github.com/lumina-media/lumina/internal/metadata"
)

// resolveIdentity promotes a sampled fingerprint to a verified identity only
// when another item has the same sample. Conflicting parsed identities remain
// separate even when their bytes are identical.
func (s *Scanner) resolveIdentity(root config.LibraryRoot, path, sampleHash string) (string, error) {
	candidates, err := s.store.HashCandidates(sampleHash, root.Name)
	if err != nil {
		return "", fmt.Errorf("find hash candidates: %w", err)
	}
	if len(candidates) == 0 {
		return sampleHash, nil
	}
	logical := parsedContentIdentity(root, path)
	newFull := ""
	fullForNew := func() (string, error) {
		if newFull != "" {
			return newFull, nil
		}
		var err error
		newFull, err = FullContentHash(path)
		return newFull, err
	}

	for i := range candidates {
		candidate := &candidates[i]
		if itemOwnsPath(*candidate, path) {
			// A cache miss for the path that already owns this identity is
			// not a duplicate. Preserve the item (and its watch history)
			// instead of manufacturing a canonical successor. A later,
			// genuinely distinct path with the same sample performs the
			// full-file verification and promotes both caches atomically.
			return candidate.Hash, nil
		}
		candidateFull, verified, err := fullHashForCandidate(*candidate, sampleHash, path)
		if err != nil {
			log.Printf("scanner: verify candidate %s: %v", candidate.ID, err)
			continue
		}
		if !verified {
			if candidate.Hash == sampleHash && candidate.State == library.StateMissing && len(candidate.Paths) == 0 && len(candidates) == 1 {
				log.Printf("scanner: reusing unverified missing identity %s for probable rename %s", candidate.ID, path)
				return candidate.Hash, nil
			}
			continue
		}
		candidateLogical := firstCandidateIdentity(root, candidate.Paths, path)
		canonical := canonicalIdentity(sampleHash, candidateFull, candidateLogical)
		if candidate.Hash == sampleHash {
			if err := s.store.RekeyItemHash(candidate.ID, canonical); err != nil {
				log.Printf("scanner: promote verified identity %s: %v", candidate.ID, err)
			} else {
				candidate.Hash = canonical
			}
		}
		currentFull, err := fullForNew()
		if err != nil {
			return "", err
		}
		if currentFull != candidateFull {
			continue
		}
		if logical != "" && candidateLogical != "" && logical != candidateLogical {
			log.Printf("scanner: content conflict: %s and %s are byte-identical but parse as %q vs %q", candidate.ID, path, candidateLogical, logical)
			continue
		}
		return candidate.Hash, nil
	}

	currentFull, err := fullForNew()
	if err != nil {
		return "", err
	}

	return canonicalIdentity(sampleHash, currentFull, logical), nil
}

func itemOwnsPath(candidate library.Item, path string) bool {
	path = filepath.Clean(path)
	for _, candidatePath := range candidate.Paths {
		if filepath.Clean(candidatePath) == path {
			return true
		}
	}
	return false
}

func fullHashForCandidate(candidate library.Item, sampleHash, currentPath string) (string, bool, error) {
	if full, ok := verifiedFullFromIdentity(candidate.Hash, sampleHash); ok {
		return full, true, nil
	}
	currentPath = filepath.Clean(currentPath)
	for _, path := range candidate.Paths {
		if filepath.Clean(path) == currentPath {
			continue
		}
		fi, err := os.Stat(path)
		if err != nil || fi.IsDir() {
			continue
		}
		full, err := FullContentHash(path)
		if err != nil {
			return "", false, err
		}
		return full, true, nil
	}
	return "", false, nil
}

func verifiedFullFromIdentity(identity, sampleHash string) (string, bool) {
	prefix := sampleHash + ":"
	if !strings.HasPrefix(identity, prefix) {
		return "", false
	}
	rest := strings.TrimPrefix(identity, prefix)
	parts := strings.SplitN(rest, ":", 2)
	if len(parts[0]) != sha256.Size*2 {
		return "", false
	}
	if _, err := hex.DecodeString(parts[0]); err != nil {
		return "", false
	}
	return parts[0], true
}

func canonicalIdentity(sampleHash, fullHash, logical string) string {
	identity := sampleHash + ":" + fullHash
	if logical == "" {
		return identity
	}
	sum := sha256.Sum256([]byte(logical))
	return identity + ":" + hex.EncodeToString(sum[:])
}

func firstCandidateIdentity(root config.LibraryRoot, paths []string, currentPath string) string {
	currentPath = filepath.Clean(currentPath)
	for _, path := range paths {
		if filepath.Clean(path) == currentPath {
			continue
		}
		if _, err := os.Stat(path); err == nil {
			return parsedContentIdentity(root, path)
		}
	}
	return ""
}

func parsedContentIdentity(root config.LibraryRoot, path string) string {
	base := strings.TrimSuffix(filepath.Base(path), filepath.Ext(path))
	if isExtrasPath(path) {
		rel, err := filepath.Rel(root.Path, path)
		if err != nil {
			rel = path
		}
		return "extra|" + normalizeIdentityText(rel)
	}
	parsed := metadata.ParseFilename(base)
	if root.Kind != "tv" {
		if parsed.Title == "" {
			return ""
		}
		return fmt.Sprintf("movie|%s|%d", normalizeIdentityText(parsed.Title), parsed.Year)
	}
	hint := metadata.HintFor(root.Path, path, true)
	series := parsed.Title
	if hint.Series != "" {
		series = hint.Series
	}
	year := parsed.Year
	if hint.Year != 0 {
		year = hint.Year
	}
	season := parsed.Season
	episode := parsed.Episode
	if episode == 0 && hint.AbsEpisode > 0 {
		episode = hint.AbsEpisode
		if season == 0 {
			season = hint.Season
		}
	}
	if season == 0 && hint.Season > 0 {
		season = hint.Season
	}
	if series == "" || episode == 0 {
		return ""
	}
	return fmt.Sprintf("tv|%s|%d|%d|%d", normalizeIdentityText(series), year, season, episode)
}

func normalizeIdentityText(value string) string {
	return strings.ToLower(strings.Join(strings.Fields(value), " "))
}

// FullContentHash is intentionally invoked only after the sampled fingerprint
// collides. It is the definitive equality check, not the primary scan cost.
func FullContentHash(path string) (string, error) {
	f, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer f.Close()
	h := sha256.New()
	if _, err := io.Copy(h, f); err != nil {
		return "", err
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}
