# Lumina Logo / Brand Asset Pack

This pack contains exported assets from the Midnight Sapphire / Porcelain /
Brushed Gold Lumina direction. It is an asset archive, not the current
application-chrome specification.

## Current application usage

- Header / navbar: use the typographic `Lumina.` component in
  `src/components/media/logo.tsx`.
- Do not replace that compact lockup with the ornate image wordmarks or a
  glow-heavy mark unless the application design direction is intentionally
  changed.

## Optional asset usage

- App launcher / PWA icon: `app-icons/lumina-app-icon-dark-1024.png`
- Favicon: use the files in `favicons/`
- Small UI/avatar mark: `transparent/lumina-small-icon-gold-transparent-512.png`
- Dark-background promotional wordmark:
  `transparent/lumina-wordmark-gold-transparent.png`
- Light-background promotional wordmark:
  `transparent/lumina-primary-wordmark-navy-gold-transparent.png`
- Reference image for Codex: `brand-reference/lumina-selected-third-brand-image.png`

## Notes

These PNG exports are implementation-friendly. App icons are intentionally
opaque because PWA/mobile icons generally render better with a fixed
background. Transparent assets are suitable for promotional material, empty
states, loading screens, or other deliberately branded moments; they are not
the default navbar treatment.

Keep clear space generous, avoid busy artwork behind a wordmark, and prefer
Midnight Sapphire / Deep Navy backgrounds for gold exports. In the product UI,
the broader visual authority is `AGENTS.md` plus the current handoff in
`worklog.md`.
