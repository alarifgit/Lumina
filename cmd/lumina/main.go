// Lumina — a self-hosted media server.
// Phase 0 skeleton: config, capability probe, scanner tiers, HTTP API,
// Emby/Jellyfin compat shim, *arr webhooks.
package main

import (
	"context"
	"flag"
	"log"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/lumina-media/lumina/internal/api"
	"github.com/lumina-media/lumina/internal/config"
	"github.com/lumina-media/lumina/internal/library"
	"github.com/lumina-media/lumina/internal/metadata"
	"github.com/lumina-media/lumina/internal/scanner"
	"github.com/lumina-media/lumina/internal/transcode"
)

func main() {
	configPath := flag.String("config", "lumina.json", "path to config file")
	renderDevice := flag.String("render-device", "/dev/dri/renderD128", "VAAPI DRM render node")
	flag.Parse()

	cfg, err := config.Load(*configPath)
	if err != nil {
		log.Fatalf("config: %v", err)
	}

	store, err := library.OpenStore(cfg.DataDir)
	if err != nil {
		log.Fatalf("store: %v", err)
	}
	defer store.Close()

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	log.Printf("lumina: probing ffmpeg capabilities (%s)...", cfg.FFmpegPath)
	caps := transcode.Probe(ctx, cfg.FFmpegPath, *renderDevice)
	log.Printf("lumina: hwaccels=%v vaapi=%v device=%s driver=%q encoders=%v",
		caps.HWAccels, caps.VAAPI.Available, caps.VAAPI.Device, caps.Driver, caps.Encoders)

	tmdb := metadata.NewClient(cfg.TMDB.APIKey, cfg.TMDB.Language)
	mw := metadata.NewWorker(tmdb, store)
	go mw.Run(ctx)

	sc := scanner.New(cfg, store, mw)
	go sc.Run(ctx)

	// Playhead-journal retention: the journal is append-only (a row every
	// ~10s per active viewer) and its history is never read, so sweep it
	// down to the latest row per (user,item) at boot and once a day —
	// otherwise months of viewing turns into millions of dead rows and
	// the MAX(version) joins behind Continue Watching degrade with it.
	go func() {
		compact := func() {
			n, err := store.CompactPlayheads()
			if err != nil {
				log.Printf("lumina: compact playheads: %v", err)
			} else if n > 0 {
				log.Printf("lumina: playhead journal compacted, %d superseded rows removed", n)
			}
		}
		compact()
		t := time.NewTicker(24 * time.Hour)
		defer t.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-t.C:
				compact()
			}
		}
	}()

	// Transcode segment root: default <data>/transcode, overridable so the
	// scratch space can live on fast local disk or tmpfs (Plex's "transcoder
	// temporary directory" equivalent). Never point it at a network share.
	transDir := os.Getenv("LUMINA_TRANSCODE_DIR")
	if transDir == "" {
		transDir = cfg.DataDir
	}
	tm, err := transcode.NewManager(transDir, cfg.FFmpegPath, caps.VAAPI.Device, caps)
	if err != nil {
		log.Fatalf("transcode manager: %v", err)
	}
	defer tm.Close()

	// Initial incremental scan of every root on boot.
	for _, root := range cfg.Libraries {
		sc.Notify(root.Path)
	}

	srv := api.New(cfg, *configPath, store, sc, caps, tm, mw)
	go srv.RunPlexSync(ctx)
	go func() {
		log.Printf("lumina: listening on %s", cfg.HTTPAddr)
		if err := srv.ListenAndServe(); err != nil {
			log.Printf("lumina: http server stopped: %v", err)
		}
	}()

	<-ctx.Done()
	log.Printf("lumina: shutting down")
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_ = srv.Shutdown(shutdownCtx)
}
