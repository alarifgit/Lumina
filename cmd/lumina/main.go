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

	tm, err := transcode.NewManager(cfg.DataDir, cfg.FFmpegPath, caps.VAAPI.Device, caps)
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
