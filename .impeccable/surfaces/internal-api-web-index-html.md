---
version: 1
slug: "internal-api-web-index-html"
primary_target: "internal/api/web/index.html"
related_targets: ["internal/api/web/style.css","internal/api/web/app.js"]
---

# Lumina Layered Aero redesign

- **Scope and mode:** Every embedded web surface; operate mode for daily browsing, playback, and administration.
- **Audience and job:** A mouse-first desktop self-hoster who wants to resume, discover, manage, and watch owned media without losing context or operational truth.
- **Direction:** Carried Spotlight with the Layered Aero composition, luminous selected state, and generous rail spacing approved in `.impeccable/mocks/lumina-aero-c.png`.
- **Responsive contract:** Wide screens use a persistent left rail; medium screens use compact top navigation; small screens use an adaptive bottom navigation and touch-safe controls.
- **Material and color:** Smoked navy and graphite foundations; ice-white and cool blue-gray Aero glass; pale sky refraction; pearl primary actions; Lumina gold only for the exact brand assets, progress, and small emphasis.
- **Memorable moment:** A refractive Continue Watching dock overlaps the hero horizon while preserving legibility over real artwork.
- **Constraints:** Keep the dependency-free embedded HTML/CSS/JS architecture, exact `/brand/emblem-512.png` and `/brand/wordmark.webp` assets, current API and playback behavior, keyboard access, reduced motion, and large-catalog performance.

## Fidelity inventory

| Approved element | Production method |
| --- | --- |
| Emblem and wordmark | Exact repository assets already shipped by Lumina |
| Shell and adaptive navigation | Semantic HTML/CSS and code-native mask icons |
| Aero material | CSS translucency, `backdrop-filter`, bright edge, and an opaque fallback |
| Hero, rails, and cards | Real TMDB artwork URLs with the existing procedural fallback |
| Continue Watching overlap | CSS grid/overlap layout; no generated raster |
| Selected state | Pearl/glacier CSS rim and restrained luminance |
| Settings and player | Existing semantic markup restyled; no playback-state rewrite |
