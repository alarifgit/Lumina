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
	// Paused playback makes NO segment requests — a 2-minute timeout killed
	// the session under anyone who paused for a cup of tea, and playback
	// broke on resume. 30 minutes matches Plex/Jellyfin patience; idle
	// sessions cost only disk (ffmpeg has long finished) or one process.
	idleTimeout  = 30 * time.Minute
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

type synchronizedBuffer struct {
	mu sync.Mutex
	b  bytes.Buffer
}

func (b *synchronizedBuffer) Write(p []byte) (int, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.b.Write(p)
}

func (b *synchronizedBuffer) String() string {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.b.String()
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
	logTail   synchronizedBuffer
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

// SessionDebug is the admin troubleshooting view: everything needed to
// answer "why is this transcode not producing output" without docker exec.
type SessionDebug struct {
	Key       string   `json:"key"`
	Mode      string   `json:"mode"`
	Dead      bool     `json:"dead"`
	Completed bool     `json:"completed"`
	IdleS     int      `json:"idleSeconds"`
	Files     []string `json:"files"` // segment/playlist files currently on disk
	LogTail   string   `json:"logTail"`
}

// DebugSessions snapshots every session with its ffmpeg log tail and the
// files it has produced so far.
func (m *Manager) DebugSessions() []SessionDebug {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := []SessionDebug{}
	for _, s := range m.sessions {
		s.mu.Lock()
		d := SessionDebug{
			Key: s.Key, Mode: s.Mode, Dead: s.dead, Completed: s.completed,
			IdleS: int(time.Since(s.lastTouch).Seconds()),
		}
		s.mu.Unlock()
		d.LogTail = s.tail()
		if ents, err := os.ReadDir(s.Dir); err == nil {
			for _, e := range ents {
				d.Files = append(d.Files, e.Name())
			}
		}
		out = append(out, d)
	}
	return out
}

// SessionKey identifies one transcode session: item + start offset +
// quality rung. A seek beyond produced segments or a quality change starts
// a NEW key (FFmpeg restarts) while the old session idles out under the
// reaper.
func SessionKey(itemID string, startS float64, qualityID string) string {
	return fmt.Sprintf("%s@%d@%s", itemID, int64(startS), qualityID)
}

// pipelineFor picks the cheapest pipeline that still yields browser-safe
// output (H.264 + AAC in HLS):
//
//	copy:     8-bit SDR H.264 passes through untouched (video copy, audio
//	          re-encoded to AAC). Zero GPU, near-zero CPU — the workhorse
//	          for MKV libraries, and the reason AC3/DTS files get sound.
//	vaapi:    full GPU pipeline for everything that must be re-encoded
//	          (HEVC, 10-bit, HDR), when the probe proved decode AND encode.
//	vaapi-hybrid: software decode + GPU encode, chosen UP FRONT for codecs
//	          the GPU can't decode (vainfo said so — e.g. AV1 on RDNA2).
//	          Picking it immediately avoids a doomed full-vaapi attempt
//	          that dies a few seconds in and restarts the session.
//	software: libx264 — the honest fallback.
func pipelineFor(caps Capabilities, info *media.Info, q Quality) string {
	// Copy is Original-only: any bitrate/resolution cap means re-encode.
	if !q.Constrained() &&
		info != nil && info.Video != nil && info.Video.Codec == "h264" &&
		!info.HDR && !strings.Contains(info.Video.Profile, "10") {
		return "copy"
	}
	if caps.VAAPI.Available && caps.Encoders["h264"] {
		// 10-bit HEVC needs the Main10 decode profile specifically.
		decodeKey := ""
		if info != nil && info.Video != nil {
			decodeKey = info.Video.Codec
			if decodeKey == "hevc" && strings.Contains(info.Video.Profile, "10") {
				decodeKey = "hevc10"
			}
		}
		// caps.Decoders is nil when vainfo was unavailable → unknown → try
		// full vaapi; the retry chain still protects us. But when vainfo
		// DID answer and the codec is missing, trust it and go hybrid.
		if caps.Decoders != nil && decodeKey != "" && !caps.Decoders[decodeKey] {
			log.Printf("transcode: %s has no hardware decode profile on this GPU; using vaapi-hybrid", decodeKey)
			return "vaapi-hybrid"
		}
		return "vaapi"
	}
	return "software"
}

// Ensure returns the live session for (item, startOffset), starting
// FFmpeg if needed. If a previous VAAPI session died before producing
// output, it retries once in software mode.
func (m *Manager) Ensure(itemID, inputPath string, info *media.Info, startS float64, q Quality, hevc bool) (*Session, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	keyID := q.ID
	if hevc {
		keyID += "-hevc"
	}
	key := SessionKey(itemID, startS, keyID)
	// Degrade honestly: a HEVC rung on a GPU that can't encode HEVC just
	// becomes the h264 rung — same ladder position, wider compatibility.
	if hevc && !m.caps.Encoders["hevc"] {
		log.Printf("transcode: %s requested HEVC but the GPU can't encode it; using h264", key)
		hevc = false
	}
	mode := pipelineFor(m.caps, info, q)

	if s, ok := m.sessions[key]; ok {
		s.mu.Lock()
		// A completed VOD transcode stays usable forever (files on disk);
		// only a FAILED session is eligible for the retry chain.
		usable := !s.dead || s.completed
		prevMode := s.Mode
		canRetry := s.dead && !s.completed && prevMode != "software"
		s.mu.Unlock()
		if usable {
			return s, nil
		}
		if !canRetry {
			return nil, fmt.Errorf("transcode session for %s died: %s", key, s.tail())
		}
		// Retry chain: vaapi → vaapi-hybrid (software decode, GPU encode —
		// GPUs without AV1/VP9 hw decode, like RDNA2, still encode on
		// silicon) → software. Never recompute the pipeline here: the
		// fancier one already failed, that's the information.
		next := map[string]string{
			"vaapi":        "vaapi-hybrid",
			"vaapi-hybrid": "software",
			"copy":         "software",
		}[prevMode]
		if next == "" {
			next = "software"
		}
		log.Printf("transcode: %s: %s session died (%s) — retrying as %s", key, prevMode, s.tail(), next)
		delete(m.sessions, key)
		os.RemoveAll(s.Dir)
		mode = next
	}

	s, err := m.start(key, inputPath, info, mode, startS, q, hevc)
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

func (m *Manager) start(key, inputPath string, info *media.Info, mode string, startS float64, q Quality, hevc bool) (*Session, error) {
	dir := filepath.Join(m.root, sessionDirName(key))
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, err
	}
	s := &Session{Key: key, Dir: dir, Mode: mode, lastTouch: time.Now()}
	args := buildArgs(m.ffmpeg, m.device, inputPath, dir, mode, info, m.caps, startS, q, hevc)
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
func buildArgs(ffmpeg, device, input, dir, mode string, info *media.Info, caps Capabilities, startS float64, q Quality, hevc bool) []string {
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

	// Quality rung: downscale expression (never upscale — min() with the
	// source height) and bitrate cap for constrained rungs. Original keeps
	// the unconstrained qp/crf quality mode.
	scaleExpr := ""
	if q.MaxHeight > 0 {
		scaleExpr = fmt.Sprintf("'min(%d,ih)'", q.MaxHeight)
	}
	// encoderRateControl returns the args AFTER "-c:v <enc>": unconstrained
	// quality (qp/crf 22) for Original, capped ABR for ladder rungs.
	encoderRateControl := func() []string {
		if q.VideoBps <= 0 {
			if mode == "software" {
				return []string{"-crf", "22"}
			}
			return []string{"-qp", "22"}
		}
		bps := strconv.FormatInt(q.VideoBps, 10)
		buf := strconv.FormatInt(2*q.VideoBps, 10)
		return []string{"-b:v", bps, "-maxrate", bps, "-bufsize", buf}
	}

	// HEVC rungs: same ladder position, roughly half the bitrate. VAAPI
	// encodes Main profile (HDR was already tone-mapped to 8-bit nv12);
	// the software path swaps libx264 for libx265. The hvc1 tag is what
	// lets fMP4 players accept the stream.
	videoEncoder, encoderProfile := "h264_vaapi", "high"
	if hevc {
		videoEncoder, encoderProfile = "hevc_vaapi", "main"
	}

	if mode == "copy" {
		// Video passthrough: no filter graph, no re-encode. The TS muxer
		// auto-inserts h264_mp4toannexb for AVCC (MP4/MKV) sources.
		args = append(args, "-c:v", "copy")
	} else if mode == "vaapi" {
		// HDR→SDR tone mapping in GPU memory when the input needs it and
		// the probe said the hardware can do it. Otherwise plain nv12.
		if info != nil && info.HDR && caps.HDRToneMap {
			vf := "tonemap_vaapi=format=nv12:t=bt709:m=bt709:p=bt709"
			if scaleExpr != "" {
				vf += ",scale_vaapi=w=-2:h=" + scaleExpr
			}
			args = append(args, "-vf", vf)
		} else if scaleExpr != "" {
			args = append(args, "-vf", "scale_vaapi=format=nv12:w=-2:h="+scaleExpr)
		} else {
			args = append(args, "-vf", "scale_vaapi=format=nv12")
		}
		args = append(args, "-c:v", videoEncoder, "-profile:v", encoderProfile)
		args = append(args, encoderRateControl()...)
		args = append(args, "-g", "96", "-keyint_min", "96")
	} else if mode == "vaapi-hybrid" {
		// Software decode → GPU encode: for codecs the GPU can't decode
		// (AV1 on RDNA2, VP9 on some parts). Frames cross RAM once, the
		// expensive encode still happens on silicon.
		if info != nil && info.HDR && caps.HDRToneMap {
			vf := "format=p010le,hwupload,tonemap_vaapi=format=nv12:t=bt709:m=bt709:p=bt709"
			if scaleExpr != "" {
				vf += ",scale_vaapi=w=-2:h=" + scaleExpr
			}
			args = append(args, "-vf", vf)
		} else if scaleExpr != "" {
			// Scale in software BEFORE upload: cheaper than round-tripping.
			args = append(args, "-vf", "format=nv12,scale=-2:"+scaleExpr+",hwupload")
		} else {
			args = append(args, "-vf", "format=nv12,hwupload")
		}
		args = append(args, "-c:v", videoEncoder, "-profile:v", encoderProfile)
		args = append(args, encoderRateControl()...)
		args = append(args, "-g", "96", "-keyint_min", "96")
	} else {
		// Software HDR handling (proper zscale+tonemap filter graph) is a
		// Phase 4 refinement; plain conversion is watchable but washed out.
		if scaleExpr != "" {
			args = append(args, "-vf", "scale=-2:"+scaleExpr)
		}
		softEncoder, softProfile := "libx264", "high"
		if hevc {
			softEncoder, softProfile = "libx265", "main"
		}
		args = append(args, "-c:v", softEncoder, "-preset", "veryfast", "-profile:v", softProfile, "-pix_fmt", "yuv420p")
		args = append(args, encoderRateControl()...)
		args = append(args, "-g", "96", "-keyint_min", "96")
	}
	audioBps := q.AudioBps
	if audioBps <= 0 {
		audioBps = 192_000
	}
	args = append(args,
		"-c:a", "aac", "-ac", "2", "-b:a", strconv.FormatInt(audioBps, 10),
		// Muxer headroom (Jellyfin uses the same 2048/5000000 pair): audio
		// re-encode + video copy can otherwise stall the TS muxer.
		"-max_muxing_queue_size", "2048", "-max_delay", "5000000",
		"-f", "hls",
		"-hls_time", "4",
		// Keep EVERY segment in the playlist. ffmpeg's default list_size of
		// 5 turns the playlist into a rolling 20-second live window — old
		// segments are unlisted and deleted, the client gets dragged to the
		// "live edge" and content appears to skip ahead. Jellyfin sets 0 too.
		"-hls_list_size", "0",
		// NO -hls_playlist_type: "vod" tells ffmpeg the playlist is static,
		// and it withholds index.m3u8 until the ENTIRE file is processed —
		// fine for a 2-minute clip, fatal for a 43-minute episode (the
		// client loads forever). The default progressive playlist appears
		// after the first segment and grows; seeking works for anything
		// already produced, which is exactly our session model.
		"-hls_flags", "independent_segments",
	)
	if hevc {
		// HEVC needs fMP4 HLS: Chrome/Safari MSE won't take HEVC in MPEG-TS.
		// The hvc1 tag and an init segment make it a well-behaved fMP4 stream.
		args = append(args,
			"-tag:v", "hvc1",
			"-hls_segment_type", "fmp4",
			"-hls_fmp4_init_filename", "init.mp4",
			"-hls_segment_filename", filepath.Join(dir, "seg_%05d.m4s"),
		)
	} else {
		args = append(args,
			"-hls_segment_filename", filepath.Join(dir, "seg_%05d.ts"),
		)
	}
	args = append(args, out)
	return args
}

// ProbeOnce is a tiny helper kept for API symmetry; media.Probe does the
// real work. (Context param keeps call sites honest about timeouts.)
func ProbeOnce(ctx context.Context, ffprobe, path string) (*media.Info, error) {
	return media.Probe(ctx, ffprobe, path)
}
