// Package transcode probes FFmpeg's hardware capabilities at startup.
// Lumina never assumes what a GPU can do — it tests, caches, and reports
// honestly in the admin UI. See ARCHITECTURE.md §7.
//
// Target hardware: Intel/AMD GPU exposed to the container as
// /dev/dri/renderD128 (docker run --device=/dev/dri). The container
// process must be in the host's render group (GID via group_add or
// the linuxserver.io PUID/PGID pattern).
package transcode

import (
	"context"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"
)

// Capabilities is the cached result of the startup probe, exposed at
// GET /api/v1/system/capabilities.
type Capabilities struct {
	FFmpegVersion string            `json:"ffmpegVersion"`
	HWAccels      []string          `json:"hwaccels"` // e.g. ["vaapi", "qsv", "cuda"]
	VAAPI         VAAPIResult       `json:"vaapi"`
	Encoders      map[string]bool   `json:"encoders"`               // codec -> hardware encode works
	EncoderErrors map[string]string `json:"encoderErrors,omitempty"` // codec -> ffmpeg's reason, when it fails
	Driver        string            `json:"driver,omitempty"`        // vainfo driver string, e.g. radeonsi/iHD
	HDRToneMap    bool              `json:"hdrToneMap"`
	ProbedAt      time.Time         `json:"probedAt"`
	Error         string            `json:"error,omitempty"`
}

type VAAPIResult struct {
	Available bool   `json:"available"`
	Device    string `json:"device"` // e.g. /dev/dri/renderD128
}

var versionRe = regexp.MustCompile(`ffmpeg version (\S+)`)

// Probe runs the full capability probe. Each step is independent and
// failure-tolerant: a broken GPU must never prevent the server starting.
func Probe(ctx context.Context, ffmpegPath, renderDevice string) Capabilities {
	caps := Capabilities{
		ProbedAt:      time.Now(),
		Encoders:      map[string]bool{},
		EncoderErrors: map[string]string{},
		VAAPI:         VAAPIResult{Device: renderDevice},
	}

	// Bare `ffmpeg -hide_banner` prints the version banner to stderr and
	// exits non-zero (no output specified) — parse the output regardless
	// of the exit code.
	out, _ := run(ctx, ffmpegPath, "-hide_banner")
	if m := versionRe.FindStringSubmatch(out); m != nil {
		caps.FFmpegVersion = m[1]
	}

	out, err := run(ctx, ffmpegPath, "-hide_banner", "-hwaccels")
	if err != nil {
		caps.Error = "ffmpeg -hwaccels failed: " + err.Error()
		return caps
	}
	for _, line := range strings.Split(out, "\n") {
		line = strings.TrimSpace(line)
		switch line {
		case "", "Hardware acceleration methods:":
		default:
			caps.HWAccels = append(caps.HWAccels, line)
		}
	}

	for _, hw := range caps.HWAccels {
		if hw == "vaapi" {
			caps.VAAPI.Available = true
		}
	}

	// Test-encode 1 second of black at 128x72 per hardware encoder.
	// Cheap, definitive, and catches driver/permission problems that
	// -hwaccels alone cannot (e.g. render-group GID mismatch).
	if caps.VAAPI.Available {
		// The configured node is only a guess — multi-GPU hosts (like an
		// iGPU + dGPU laptop) expose several render nodes, and the stack
		// may map any of them to renderD128 inside the container. Try the
		// configured device first, then every other node we can see, and
		// keep the first one that actually encodes.
		device, firstErr := "", ""
		for _, dev := range candidateDevices(renderDevice) {
			ok, reason := testVAAPIEncode(ctx, ffmpegPath, dev, "h264_vaapi")
			if ok {
				device = dev
				break
			}
			if firstErr == "" {
				firstErr = reason
			}
			log.Printf("transcode: h264_vaapi probe on %s failed: %s", dev, reason)
		}
		if device == "" {
			caps.Encoders["h264"] = false
			caps.EncoderErrors["h264"] = firstErr
			log.Printf("transcode: no working VAAPI render node found (tried %s); falling back to software",
				strings.Join(candidateDevices(renderDevice), ", "))
			return caps
		}
		caps.VAAPI.Device = device
		if device != renderDevice {
			log.Printf("transcode: configured node %s failed; using working node %s", renderDevice, device)
		}
		caps.Encoders["h264"] = true
		for _, enc := range []string{"hevc_vaapi", "av1_vaapi"} {
			codec := strings.ReplaceAll(enc, "_vaapi", "")
			ok, reason := testVAAPIEncode(ctx, ffmpegPath, device, enc)
			caps.Encoders[codec] = ok
			if !ok {
				caps.EncoderErrors[codec] = reason
			}
		}
		caps.Driver = probeDriver(ctx, device)
		caps.HDRToneMap = caps.Encoders["hevc"] // Phase 4: real tonemap_vaapi filter test
	}
	return caps
}

// candidateDevices returns the preferred device followed by every other
// DRM render node present in the container, de-duplicated.
func candidateDevices(preferred string) []string {
	seen := map[string]bool{}
	out := []string{}
	add := func(d string) {
		if d != "" && !seen[d] {
			seen[d] = true
			out = append(out, d)
		}
	}
	add(preferred)
	nodes, _ := filepath.Glob("/dev/dri/renderD*")
	sort.Strings(nodes)
	for _, n := range nodes {
		if fi, err := os.Stat(n); err == nil && !fi.IsDir() {
			add(n)
		}
	}
	return out
}

// probeDriver asks vainfo which VA-API driver backs the device
// ("Mesa Gallium driver ... for AMD" / "Intel iHD driver ..."). Best-effort:
// a missing vainfo binary is not an error — but it IS logged, because an
// empty driver string during GPU debugging is otherwise a silent gap.
func probeDriver(ctx context.Context, device string) string {
	out, err := run(ctx, "vainfo", "--display", "drm", "--device", device)
	for _, line := range strings.Split(out, "\n") {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(line, "vainfo: Driver version:") {
			return strings.TrimSpace(strings.TrimPrefix(line, "vainfo: Driver version:"))
		}
	}
	if err != nil {
		log.Printf("transcode: vainfo on %s failed: %v: %.200s", device, err, strings.TrimSpace(out))
	} else {
		log.Printf("transcode: vainfo on %s gave no driver line: %.200s", device, strings.TrimSpace(out))
	}
	return ""
}

func testVAAPIEncode(ctx context.Context, ffmpeg, device, encoder string) (bool, string) {
	out, err := run(ctx, ffmpeg,
		"-hide_banner", "-loglevel", "error",
		"-init_hw_device", "vaapi=va:"+device,
		// 160x96: both dimensions are multiples of 16. Some VAAPI drivers
		// (Mesa radeonsi in particular) reject unaligned heights like 72
		// with EINVAL (-22) — an alignment artifact of the probe itself,
		// not a real encoder limitation.
		"-f", "lavfi", "-i", "color=black:size=160x96:duration=1:rate=1",
		"-vf", "format=nv12,hwupload",
		"-c:v", encoder,
		// Rate control must be explicit: with no -qp/-b:v at all, radeonsi
		// rejects the encode with EINVAL even when the hardware is fine.
		"-qp", "22",
		"-frames:v", "1",
		"-f", "null", "-",
	)
	if err != nil {
		// The single most common GPU-support question is "why did the probe
		// say no?" — keep FFmpeg's own answer for the capabilities API.
		reason := strings.TrimSpace(out)
		if len(reason) > 300 {
			reason = reason[len(reason)-300:]
		}
		if reason == "" {
			reason = err.Error()
		}
		return false, reason
	}
	return true, ""
}

func run(ctx context.Context, name string, args ...string) (string, error) {
	ctx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, name, args...)
	out, err := cmd.CombinedOutput()
	// ffmpeg prints informational output to stderr and exits non-zero for
	// some probe invocations — callers judge by content, not just exit code.
	return string(out), err
}
