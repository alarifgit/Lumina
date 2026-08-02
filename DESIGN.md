---
name: Lumina
description: A cinematic, self-hosted media interface carried by cool Aero glass and exact Lumina identity.
colors:
  night-foundation: "#07111e"
  graphite-panel: "#102033"
  pearl: "#f5f8fc"
  ice-blue: "#8db4d2"
  lumina-gold: "#c7a56b"
  success: "#7fb98a"
  warning: "#d8a24a"
  danger: "#f09a91"
typography:
  display:
    fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif'
    fontSize: "clamp(2.4rem, 4.8vw, 4.8rem)"
    fontWeight: 620
    lineHeight: 0.94
    letterSpacing: "-0.055em"
  title:
    fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif'
    fontSize: "clamp(2rem, 4.5vw, 4.2rem)"
    fontWeight: 610
    lineHeight: 0.95
    letterSpacing: "-0.055em"
  body:
    fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif'
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.55
  label:
    fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif'
    fontSize: "0.69rem"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "0.16em"
rounded:
  control: "0.8rem"
  card: "1.05rem"
  panel: "1.55rem"
  hero: "2rem"
  pill: "999px"
spacing:
  xs: "0.25rem"
  sm: "0.5rem"
  md: "1rem"
  lg: "1.5rem"
  xl: "3rem"
  section: "4rem"
components:
  button-primary:
    backgroundColor: "{colors.pearl}"
    textColor: "{colors.night-foundation}"
    rounded: "{rounded.pill}"
    padding: "0.72rem 1.35rem"
    height: "2.75rem"
  button-ghost:
    backgroundColor: "rgba(211, 235, 250, 0.12)"
    textColor: "{colors.pearl}"
    rounded: "{rounded.pill}"
    padding: "0.62rem 1rem"
    height: "2.65rem"
  card-media:
    backgroundColor: "{colors.graphite-panel}"
    textColor: "{colors.pearl}"
    rounded: "{rounded.card}"
  input:
    backgroundColor: "rgba(8, 20, 33, 0.66)"
    textColor: "{colors.pearl}"
    rounded: "{rounded.control}"
    height: "2.65rem"
  navigation-selected:
    backgroundColor: "{colors.pearl}"
    textColor: "{colors.night-foundation}"
    rounded: "{rounded.control}"
---

# Design System: Lumina

## Overview

**Creative North Star: "Carried Spotlight in Layered Aero"**

Lumina treats one selected title or operational task as the visual anchor and lets navigation, discovery, and controls orbit it. The world is cinematic but grounded: real library artwork carries emotion, while smoked navy foundations and cool translucent control layers preserve the truth and legibility expected from a self-hosted media server.

Aero glass is functional architecture, not decoration. It identifies floating control layers, active choices, and the single overlapping dock; ordinary content remains artwork-first and comparatively quiet. Pearl selections supply clarity, while the exact Lumina emblem, wordmark, and restrained gold keep the product unmistakably its own.

**Key Characteristics:**

- One dominant cinematic focal area per surface.
- Cool, refractive functional glass with bright upper edges and deep ambient shadow.
- Pearl active states; Lumina gold reserved for identity, progress, and rare emphasis.
- Real media artwork and honest operational status throughout.
- Adaptive navigation: wide rail, medium top bar, mobile bottom bar.

## Colors

The palette begins in smoked navy and graphite, then uses ice-blue translucency and pearl luminance to establish hierarchy.

### Primary

- **Pearl Light:** The decisive active and primary-action color. It must remain high-contrast over artwork and glass.
- **Lumina Gold:** The identity accent used by the official brand assets, playback progress, and restrained emphasis.

### Secondary

- **Aero Ice Blue:** The cool environmental tint for glass edges, focus atmosphere, and quiet hover response.

### Neutral

- **Night Foundation:** The page and player foundation; it keeps photography dominant without collapsing to flat black.
- **Graphite Panel:** The stable opaque fallback and card base beneath translucent layers.
- **Success, Warning, and Danger:** Semantic operational colors used only when state meaning requires them.

### Named Rules

**The Gold Reserve Rule.** Gold belongs to Lumina identity, playback progress, and rare emphasis; never use it as the general interactive accent.

**The Functional Glass Rule.** Use translucent material only for a control layer, selected state, dialog, or deliberate overlap. Ordinary content does not need a glass container.

## Typography

**Display Font:** System UI with Segoe UI and platform fallbacks

**Body Font:** System UI with Segoe UI and platform fallbacks

**Character:** A compact, confident grotesk hierarchy lets media titles feel cinematic without importing a network font or weakening Lumina's air-gapped delivery.

### Hierarchy

- **Display** (620, fluid 2.4rem–4.8rem, 0.94 line height): Hero titles; tightly tracked and balanced, with room for long real-world names.
- **Headline** (610, fluid 2rem–4.2rem, 0.95 line height): Browse and major surface headings.
- **Title** (580–620, approximately 0.88rem–1.38rem): Card names, rail headings, settings group titles, and episode names.
- **Body** (400, 1rem, 1.55 line height): Overviews and explanatory copy, normally held to roughly 57 characters per line in heroes.
- **Label** (700, 0.69rem, 0.16em tracking, uppercase): Hero context and operational kicker text.

### Named Rules

**The Focal Compression Rule.** Large titles are tightly tracked and weighty; supporting text stays quieter and more open. Do not give metadata the same visual force as the title.

## Layout

The shell changes topology rather than merely shrinking. At 1280px and wider, a 7rem persistent left rail frames the application. Between 761px and 1279px, navigation returns to a compact top bar. At 760px and below, libraries become a viewport-bound bottom bar with safe-area padding, while brand and utility actions remain in a compact opaque top header.

Home uses a contained hero between roughly 31rem and 44rem tall. The first real content rail crosses its lower horizon in a single Layered Aero dock. Later rails regain open spacing. Browse views use an auto-filling poster grid and render 120 entries initially, then reveal more in batches. Details keep the cinematic hero and place season or operational content in a bounded glass surface below it.

Spacing follows a practical half-rem rhythm, opening to 3–4rem between major narrative regions. Media rails may scroll horizontally; the document itself must never overflow.

## Elevation & Depth

Depth is a hybrid of tonal layering, backdrop blur, bright inset edges, and wide ambient shadow. The dark foundation remains visually stable while functional glass floats above it. Hover raises artwork only slightly; selection is communicated more by luminance and border clarity than by movement.

### Shadow Vocabulary

- **Aero Floating:** A wide 24px-by-72px ambient shadow for dialogs, the overlapping dock, and major floating glass.
- **Artwork Lift:** A tighter 20px-by-48px shadow for a focused media card.
- **Shell Separation:** A low-contrast lateral or downward shadow that distinguishes navigation from content.

### Named Rules

**The One Floating Horizon Rule.** Only the first home rail overlaps the hero. Additional rails return to the page rhythm so the signature remains memorable.

**The Bright Edge Rule.** Every translucent functional surface needs a restrained light edge or inset highlight plus an opaque fallback.

## Shapes

Controls are pill-shaped when they represent an action or compact choice. Cards and rows use softly rounded 0.8rem–1.05rem corners; functional panels use approximately 1.55rem; the cinematic hero reaches 2rem on wide screens. Borders are hairline and cool, never thick outlines. Artwork remains clipped to its card, while focus rings sit clearly outside or just inside full-row controls.

## Components

### Buttons

- **Shape:** Decisive pill silhouette.
- **Primary:** Pearl fill, night text, 2.75rem minimum height, and compact horizontal padding.
- **Hover / Focus:** A one-pixel lift, brighter pearl, ambient shadow, and a two-pixel ice-white focus ring.
- **Ghost:** Cool translucent fill with a bright glass edge; never an unbounded low-contrast text target.

### Chips

- **Style:** Small cool translucent capsule with muted pearl text and a fine ice border.
- **State:** Selected season chips invert to pearl with night text; status chips retain semantic color meaning.

### Cards / Containers

- **Corner Style:** Soft card corners with a larger panel radius for grouped controls.
- **Background:** Artwork-first; graphite is the loading and opaque fallback.
- **Shadow Strategy:** Flat at rest, then a restrained lift and luminous rim on mouse hover or keyboard focus.
- **Border:** One-pixel cool edge whose contrast increases in the selected state.
- **Internal Padding:** Compact metadata below artwork; generous padding only inside functional panels.

### Inputs / Fields

- **Style:** Deep translucent graphite, cool hairline border, and 0.8rem corner radius.
- **Focus:** Border brightens and the shared focus ring remains visible over both dark UI and artwork.
- **Error / Disabled:** Semantic color and reduced prominence communicate state without changing control geometry.

### Navigation

Wide navigation is an icon-and-label rail with the official emblem above and utility actions below. The selected item becomes a luminous pearl tile. Medium navigation uses a horizontal glass track; mobile navigation is a bottom bar sized for the six primary destinations and safe-area insets. Counts remain secondary and may disappear where width is constrained.

### Layered Horizon Dock

The first home rail is the signature component: it overlaps the hero edge, refracts the artwork beneath it, and carries Continue Watching or the first truthful available rail. It must remain a single dock, not become a generic wrapper for every section.

## Do's and Don'ts

### Do:

- **Do** use the exact repository emblem and wordmark assets.
- **Do** let real artwork lead, with scrims sized to the actual copy.
- **Do** keep primary actions pearl and playback progress gold.
- **Do** preserve keyboard focus, reduced-motion behavior, and opaque glass fallbacks.
- **Do** change navigation topology at the established wide, medium, and mobile breakpoints.

### Don't:

- **Don't** turn every card or settings row into decorative glass.
- **Don't** use neon blue, broad gold fills, or gold as the default hover color.
- **Don't** stack multiple overlapping rails beneath a hero.
- **Don't** hide real operational states to make Settings appear simpler.
- **Don't** trust a fixed sample of titles when sizing hero copy or catalog rendering.
