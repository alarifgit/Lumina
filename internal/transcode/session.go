// Transcode session manager: on-demand FFmpeg → HLS, VAAPI-first with
// automatic software fallback, idle reaping.
//
// Design notes:
//   - One session per item (quality variants come in a later phase).
//   - FFmpeg runs at FULL SPEED (not realtime) writing a VOD playlist;
//     the API polls for segment files so transcoding latency is hidden
//     behind the client's normal HLS buffering.
//   - Seeking works for any segment already produced. Restart-with-ss
//     for far-ahead seeks is a Phase 4 refinement.
//   - Decode failures that -hwaccel can't foresee (e.g. 10-bit HEVC on
//     an older iGPU) trigger ONE automatic retry in software mode.
package transcode

import (
	"bytes"
	"context"
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/lumina-media/lumina/internal/media"
)

const (
	idleTimeout  = 2 * time.Minute
	reapInterval = 15 * time.Second
	fileWaitMax  = 60 * time.Second
)

type Manager struct {
	ffmpeg   string
	device   string
	caps     Capabilities
	root     string
	mu       sync.Mutex
	sessions map[string]*Session
	stopReap chan struct{}
}

type Session struct {
	Key  string `json:"key"`
	Dir  string `json:"dir"`
	Mode string `json:"mode"` // "copy" | "vaapi" | "software"

	mu        sync.Mutex
	cmd       *exec.Cmd
	lastTouch time.Time
	dead      bool
	completed bool // ffmpeg exited 0: VOD playlist is complete on disk
	logTail   bytes.Buffer
}

func NewManager(dataDir, ffmpeg, device string, caps Capabilities) (*Manager, error) {
	root := filepath.Join(dataDir, "transcode")
	if err := os.MkdirAll(root, 0o755); err != nil {
		return nil, err
	}
	m := &Manager{
		ffmpeg:   ffmpeg,
		device:   device,
		caps:     caps,
		root:     root,
		sessions: map[string]*Session{},
		stopReap: make(chan struct{}),
	}
	go m.reaper()
	return m, nil
}

// Close kills every session and stops the reaper.
func (m *Manager) Close() {
	close(m.stopReap)
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, s := range m.sessions {
		s.kill()
	}
}

// ActiveSessions is a snapshot for the admin API.
func (m *Manager) ActiveSessions() []Session {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := []Session{}
	for _, s := range m.sessions {
		s.mu.Lock()
		out = append(out, Session{Key: s.Key, Dir: s.Dir, Mode: s.Mode})
		s.mu.Unlock()
	}
	return out
}

// SessionKey identifies one transcode session: item + start offset.
// A seek beyond produced segments starts a NEW key (FFmpeg restarts with
// -ss) while the old session idles out under the reaper.
func SessionKey(itemID string, startS float64) string {
	return fmt.Sprintf("%s@%d", itemID, int64(startS))
}

// pipelineFor picks the cheapest pipeline that still yields browser-safe
// output (H.264 + AAC in HLS):
//
//	copy:     8-bit SDR H.264 passes through untouched (video copy, audio
//	          re-encoded to AAC). Zero GPU, near-zero CPU — the workhorse
//	          for MKV libraries, and the reason AC3/DTS files get sound.
//	vaapi:    full GPU pipeline for everything that must be re-encoded
//	          (HEVC, AV1, 10-bit, HDR), when the probe proved it works.
//	software: libx264 — the honest fallback.
func pipelineFor(caps Capabilities, info *media.Info) string {
	if info != nil && info.Video != nil && info.Video.Codec == "h264" &&
		!info.HDR && !strings.Contains(info.Video.Profile, "10") {
		return "copy"
	}
	if caps.VAAPI.Available && caps.Encoders["h264"] {
		return "vaapi"
	}
	return "software"
}

// Ensure returns the live session for (item, startOffset), starting
// FFmpeg if needed. If a previous VAAPI session died before producing
// output, it retries once in software mode.
func (m *Manager) Ensure(itemID, inputPath string, info *media.Info, startS float64) (*Session, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	key := SessionKey(itemID, startS)
	mode := pipelineFor(m.caps, info)

	if s, ok := m.sessions[key]; ok {
		s.mu.Lock()
		// A completed VOD transcode stays usable forever (files on disk);
		// only a FAILED session is eligible for the software retry.
		usable := !s.dead || s.completed
		canRetry := s.dead && !s.completed && s.Mode != "software"
		s.mu.Unlock()
		if usable {
			return s, nil
		}
		if !canRetry {
			return nil, fmt.Errorf("transcode session for %s died: %s", key, s.tail())
		}
		log.Printf("transcode: %s: %s session died (%s) — retrying in software", key, s.Mode, s.tail())
		delete(m.sessions, key)
		os.RemoveAll(s.Dir)
		mode = "software" // don't recompute: the fancier pipeline already failed
	}

	s, err := m.start(key, inputPath, info, mode, startS)
	if err != nil {
		return nil, err
	}
	m.sessions[key] = s
	log.Printf("transcode: %s started (%s, offset %.0fs) from %s", key, mode, startS, inputPath)
	return s, nil
}

// Get returns the live session for a key, or nil. Lets callers skip
// expensive work (e.g. ffprobe) when a session is already running.
func (m *Manager) Get(key string) *Session {
	m.mu.Lock()
	defer m.mu.Unlock()
	s, ok := m.sessions[key]
	if !ok {
		return nil
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.dead && !s.completed {
		return nil
	}
	return s
}

// Session dir names must be filesystem-safe: "itm-1@120" → "itm-1_120".
func sessionDirName(key string) string {
	return strings.ReplaceAll(key, "@", "_")
}

func (m *Manager) start(key, inputPath string, info *media.Info, mode string, startS float64) (*Session, error) {
	dir := filepath.Join(m.root, sessionDirName(key))
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, err
	}
	s := &Session{Key: key, Dir: dir, Mode: mode, lastTouch: time.Now()}
	args := buildArgs(m.ffmpeg, m.device, inputPath, dir, mode, info, m.caps, startS)
	s.cmd = exec.Command(args[0], args[1:]...)
	s.cmd.Stderr = &s.logTail
	s.cmd.Stdout = &s.logTail
	if err := s.cmd.Start(); err != nil {
		return nil, fmt.Errorf("start ffmpeg: %w", err)
	}
	go func() {
		err := s.cmd.Wait()
		s.mu.Lock()
		s.dead = true
		s.completed = err == nil // exit 0 → complete VOD playlist on disk
		s.mu.Unlock()
	}()
	return s, nil
}

// Touch resets the idle timer — called on every segment request.
func (s *Session) Touch() {
	s.mu.Lock()
	s.lastTouch = time.Now()
	s.mu.Unlock()
}

// WaitFile blocks until name exists inside the session dir (polling,
// 100ms cadence) or the timeout/process death makes waiting pointless.
// Returns the absolute path for http.ServeFile.
func (s *Session) WaitFile(name string) (string, error) {
	// Path traversal guard: serve only files directly inside Dir.
	clean := filepath.Base(name)
	full := filepath.Join(s.Dir, clean)
	deadline := time.Now().Add(fileWaitMax)
	for {
		if fi, err := os.Stat(full); err == nil && fi.Size() > 0 {
			s.Touch()
			return full, nil
		}
		s.mu.Lock()
		dead := s.dead
		s.mu.Unlock()
		if dead {
			// ffmpeg finished (or crashed). If the file isn't on disk by
			// now it never will be — no point waiting out the timeout.
			return "", fmt.Errorf("ffmpeg exited before producing %s", clean)
		}
		if time.Now().After(deadline) {
			return "", fmt.Errorf("timeout waiting for %s", clean)
		}
		time.Sleep(100 * time.Millisecond)
	}
}

func (s *Session) kill() {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.cmd != nil && s.cmd.Process != nil && !s.dead {
		_ = s.cmd.Process.Kill()
	}
}

func (s *Session) tail() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := s.logTail.String()
	if len(out) > 400 {
		out = out[len(out)-400:]
	}
	return out
}

func (m *Manager) reaper() {
	ticker := time.NewTicker(reapInterval)
	defer ticker.Stop()
	for {
		select {
		case <-m.stopReap:
			return
		case <-ticker.C:
			m.mu.Lock()
			for id, s := range m.sessions {
				s.mu.Lock()
				idle := time.Since(s.lastTouch) > idleTimeout
				s.mu.Unlock()
				if idle {
					log.Printf("transcode: reaping idle session %s", id)
					s.kill()
					delete(m.sessions, id)
					os.RemoveAll(s.Dir)
				}
			}
			m.mu.Unlock()
		}
	}
}

// buildArgs constructs the FFmpeg command. Three pipelines:
//
//	copy:     video passthrough, audio → AAC (h264 SDR sources)
//	vaapi:    decode+filter+encode all in GPU memory (no RAM round trips)
//	software: libx264 veryfast — the honest fallback
//
// Output is HLS (mpegts segments, 4s, independent segments) — the single
// decision that keeps every browser/client happy.
func buildArgs(ffmpeg, device, input, dir, mode string, info *media.Info, caps Capabilities, startS float64) []string {
	out := filepath.Join(dir, "index.m3u8")
	args := []string{ffmpeg, "-hide_banner", "-loglevel", "warning", "-y"}

	if mode == "vaapi" {
		args = append(args,
			"-init_hw_device", "vaapi=va:"+device,
			"-hwaccel", "vaapi", "-hwaccel_output_format", "vaapi",
		)
	}
	// Restart-on-seek: input seeking (-ss BEFORE -i) is fast. Re-encode
	// modes are frame-accurate; copy mode lands on the nearest keyframe
	// (a few seconds of drift at worst — acceptable for a seek).
	// The new session's timeline starts at 0; the client adds the offset
	// back for playheads.
	if startS > 0 {
		args = append(args, "-ss", strconv.FormatFloat(startS, 'f', 3, 64))
	}
	args = append(args, "-i", input, "-avoid_negative_ts", "make_zero",
		"-map", "0:v:0",
		"-map", "0:a:0?", // audio optional: survive silent files
	)

	if mode == "copy" {
		// Video passthrough: no filter graph, no re-encode. The TS muxer
		// auto-inserts h264_mp4toannexb for AVCC (MP4/MKV) sources.
		args = append(args, "-c:v", "copy")
	} else if mode == "vaapi" {
		// HDR→SDR tone mapping in GPU memory when the input needs it and
		// the probe said the hardware can do it. Otherwise plain nv12.
		if info != nil && info.HDR && caps.HDRToneMap {
			args = append(args, "-vf", "tonemap_vaapi=format=nv12:t=bt709:m=bt709:p=bt709")
		} else {
			args = append(args, "-vf", "scale_vaapi=format=nv12")
		}
		args = append(args, "-c:v", "h264_vaapi", "-profile:v", "high", "-qp", "22")
	} else {
		// Software HDR handling (proper zscale+tonemap filter graph) is a
		// Phase 4 refinement; plain conversion is watchable but washed out.
		args = append(args, "-c:v", "libx264", "-preset", "veryfast", "-crf", "22", "-pix_fmt", "yuv420p")
	}
	args = append(args,
		"-c:a", "aac", "-ac", "2", "-b:a", "192k",
		"-f", "hls",
		"-hls_time", "4",
		"-hls_playlist_type", "vod",
		"-hls_flags", "independent_segments",
		"-hls_segment_filename", filepath.Join(dir, "seg_%05d.ts"),
		out,
	)
	return args
}

// ProbeOnce is a tiny helper kept for API symmetry; media.Probe does the
// real work. (Context param keeps call sites honest about timeouts.)
func ProbeOnce(ctx context.Context, ffprobe, path string) (*media.Info, error) {
	return media.Probe(ctx, ffprobe, path)
}
