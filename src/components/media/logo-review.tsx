"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

/* ─────────────────────────────────────────────────────────────────────
   Lumina logo mockups — each integrates the sun/play icon INTO the
   wordmark (like famous brand logos). Review and pick your favourite.
   ───────────────────────────────────────────────────────────────────── */

const GOLD_GRAD = "url(#lumina-gold-grad)";

function GoldGradient() {
  return (
    <defs>
      <linearGradient id="lumina-gold-grad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#FFF7E0" />
        <stop offset="40%" stopColor="#FCD34D" />
        <stop offset="100%" stopColor="#F59E0B" />
      </linearGradient>
      <radialGradient id="lumina-sun-grad" cx="50%" cy="50%" r="50%">
        <stop offset="0%" stopColor="#FFFBEB" />
        <stop offset="50%" stopColor="#FCD34D" />
        <stop offset="100%" stopColor="#F59E0B" />
      </radialGradient>
    </defs>
  );
}

/** Mockup 1: "Sunrise L" — the L is a sun rising over a horizon */
function MockupSunriseL({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 280 70" className={className} fill="none" xmlns="http://www.w3.org/2000/svg">
      <GoldGradient />
      {/* Sun disc forming the top of the L */}
      <circle cx="32" cy="32" r="22" fill={GOLD_GRAD} />
      {/* Sun rays */}
      {Array.from({ length: 7 }).map((_, i) => {
        const a = -90 + (i - 3) * 22;
        const rad = (a * Math.PI) / 180;
        const x1 = 32 + Math.cos(rad) * 24;
        const y1 = 32 + Math.sin(rad) * 24;
        const x2 = 32 + Math.cos(rad) * 30;
        const y2 = 32 + Math.sin(rad) * 30;
        return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="#F59E0B" strokeWidth="2.5" strokeLinecap="round" />;
      })}
      {/* Horizon line = horizontal stroke of L */}
      <rect x="14" y="54" width="40" height="5" rx="2.5" fill={GOLD_GRAD} />
      {/* Play triangle in the sun */}
      <path d="M27 24 L40 32 L27 40 Z" fill="#1A0F00" opacity="0.85" />
      {/* "umina" wordmark */}
      <text x="62" y="48" fontFamily="system-ui, sans-serif" fontSize="36" fontWeight="800" fill={GOLD_GRAD} letterSpacing="-1.5">
        umina
      </text>
    </svg>
  );
}

/** Mockup 2: "Eclipse" — a sun disc behind/overlapping the "Lu" */
function MockupEclipse({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 300 70" className={className} fill="none" xmlns="http://www.w3.org/2000/svg">
      <GoldGradient />
      {/* Large sun disc behind the text, partially eclipsed */}
      <circle cx="55" cy="35" r="38" fill="url(#lumina-sun-grad)" opacity="0.9" />
      {/* Sun rays radiating */}
      {Array.from({ length: 12 }).map((_, i) => {
        const a = i * 30;
        const rad = (a * Math.PI) / 180;
        const x1 = 55 + Math.cos(rad) * 40;
        const y1 = 35 + Math.sin(rad) * 40;
        const x2 = 55 + Math.cos(rad) * 48;
        const y2 = 35 + Math.sin(rad) * 48;
        return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="#F59E0B" strokeWidth="2" strokeLinecap="round" opacity={i % 2 ? 0.6 : 1} />;
      })}
      {/* The wordmark sits over the sun */}
      <text x="12" y="48" fontFamily="system-ui, sans-serif" fontSize="34" fontWeight="900" fill="#0A0A0A" letterSpacing="-1">
        Lumina
      </text>
      {/* Play triangle cut into the L (negative space) */}
      <path d="M20 24 L34 32 L20 40 Z" fill={GOLD_GRAD} />
    </svg>
  );
}

/** Mockup 3: "Play-i" — the i is a sun with a play-triangle stem */
function MockupPlayI({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 250 70" className={className} fill="none" xmlns="http://www.w3.org/2000/svg">
      <GoldGradient />
      {/* "Lum" in gradient text */}
      <text x="0" y="48" fontFamily="system-ui, sans-serif" fontSize="36" fontWeight="800" fill={GOLD_GRAD} letterSpacing="-1.5">
        Lum
      </text>
      {/* The "i" — dot is a sun, stem is a play triangle */}
      <g transform="translate(118, 0)">
        {/* Sun dot */}
        <circle cx="6" cy="14" r="8" fill="url(#lumina-sun-grad)" />
        {/* Tiny rays around the dot */}
        {Array.from({ length: 6 }).map((_, i) => {
          const a = i * 60;
          const rad = (a * Math.PI) / 180;
          return <line key={i} x1={6 + Math.cos(rad) * 9} y1={14 + Math.sin(rad) * 9} x2={6 + Math.cos(rad) * 12} y2={14 + Math.sin(rad) * 12} stroke="#F59E0B" strokeWidth="1.5" strokeLinecap="round" />;
        })}
        {/* Play-triangle stem */}
        <path d="M0 28 L14 36 L0 44 Z" fill={GOLD_GRAD} />
      </g>
      {/* "na" in gradient text */}
      <text x="138" y="48" fontFamily="system-ui, sans-serif" fontSize="36" fontWeight="800" fill={GOLD_GRAD} letterSpacing="-1.5">
        na
      </text>
    </svg>
  );
}

/** Mockup 4: "Aperture" — a sun/aperture icon overlapping the first letter */
function MockupAperture({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 280 70" className={className} fill="none" xmlns="http://www.w3.org/2000/svg">
      <GoldGradient />
      {/* Aperture/sun icon overlapping where the L would be */}
      <g transform="translate(35, 35)">
        {/* Outer ring */}
        <circle r="28" fill="none" stroke={GOLD_GRAD} strokeWidth="3" />
        {/* 8 aperture blades = sun rays + play shapes */}
        {Array.from({ length: 8 }).map((_, i) => {
          const a = i * 45;
          return (
            <polygon
              key={i}
              points="0,-26 4,-12 -4,-12"
              fill={GOLD_GRAD}
              transform={`rotate(${a})`}
              opacity={i % 2 ? 0.65 : 1}
            />
          );
        })}
        {/* Play triangle center */}
        <path d="M-6 -8 L8 0 L-6 8 Z" fill="#1A0F00" opacity="0.85" />
      </g>
      {/* "umina" — the L is replaced by the aperture */}
      <text x="72" y="48" fontFamily="system-ui, sans-serif" fontSize="36" fontWeight="800" fill={GOLD_GRAD} letterSpacing="-1.5">
        umina
      </text>
    </svg>
  );
}

/** Mockup 5: "Sunset" — a sun setting behind the full wordmark with a glow */
function MockupSunset({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 300 80" className={className} fill="none" xmlns="http://www.w3.org/2000/svg">
      <GoldGradient />
      {/* Glow behind the wordmark */}
      <ellipse cx="150" cy="45" rx="130" ry="28" fill="url(#lumina-sun-grad)" opacity="0.18" />
      {/* Sun disc centered behind "min" */}
      <circle cx="150" cy="40" r="30" fill="url(#lumina-sun-grad)" opacity="0.85" />
      {/* Sun rays */}
      {Array.from({ length: 9 }).map((_, i) => {
        const a = -90 + (i - 4) * 18;
        const rad = (a * Math.PI) / 180;
        const x1 = 150 + Math.cos(rad) * 32;
        const y1 = 40 + Math.sin(rad) * 32;
        const x2 = 150 + Math.cos(rad) * 42;
        const y2 = 40 + Math.sin(rad) * 42;
        return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="#F59E0B" strokeWidth="2.5" strokeLinecap="round" opacity={Math.abs(i - 4) < 3 ? 1 : 0.5} />;
      })}
      {/* Wordmark in front, dark with gradient play triangle as the dot of i */}
      <text x="0" y="52" fontFamily="system-ui, sans-serif" fontSize="38" fontWeight="900" fill="#0A0A0A" letterSpacing="-1.5">
        Lumina
      </text>
      {/* The dot of the i is a play triangle */}
      <path d="M120 18 L128 24 L120 30 Z" fill={GOLD_GRAD} />
    </svg>
  );
}

/** Mockup 6: "Beam" — light beams emanating from behind the L, text in gradient */
function MockupBeam({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 290 70" className={className} fill="none" xmlns="http://www.w3.org/2000/svg">
      <GoldGradient />
      {/* Light beams from the left */}
      <g opacity="0.5">
        {Array.from({ length: 5 }).map((_, i) => {
          const y = 14 + i * 11;
          return <polygon key={i} points={`0,${y} 60,${y - 4} 60,${y + 4}`} fill={GOLD_GRAD} />;
        })}
      </g>
      {/* Sun disc */}
      <circle cx="55" cy="35" r="18" fill="url(#lumina-sun-grad)" />
      {/* Play triangle in the sun */}
      <path d="M50 27 L62 35 L50 43 Z" fill="#1A0F00" opacity="0.85" />
      {/* "Lumina" wordmark — L integrated with the sun, rest in gradient */}
      <text x="80" y="48" fontFamily="system-ui, sans-serif" fontSize="36" fontWeight="800" fill={GOLD_GRAD} letterSpacing="-1.5">
        Lumina
      </text>
    </svg>
  );
}

const MOCKUPS = [
  { id: "sunrise-l", name: "Sunrise L", desc: "The L is a sun rising over a horizon, with a play triangle at its core.", Comp: MockupSunriseL },
  { id: "eclipse", name: "Eclipse", desc: "A sun disc behind the wordmark, partially eclipsed. Play triangle cut into the L.", Comp: MockupEclipse },
  { id: "play-i", name: "Play-i", desc: "The letter 'i' is a sun (dot) with a play-triangle stem. Icon-as-letterform.", Comp: MockupPlayI },
  { id: "aperture", name: "Aperture", desc: "A sun/aperture hybrid replaces the L — 8 play-triangle blades around a play center.", Comp: MockupAperture },
  { id: "sunset", name: "Sunset", desc: "A sun glows behind the full wordmark. The i's dot is a play triangle.", Comp: MockupSunset },
  { id: "beam", name: "Beam", desc: "Light beams emanate from a sun disc that integrates with the L.", Comp: MockupBeam },
];

export function LogoReview() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-4 right-4 z-30 rounded-full bg-primary/15 px-4 py-2 text-xs font-bold uppercase tracking-wide text-primary backdrop-blur transition-colors hover:bg-primary/25"
      >
        Review Logos
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto thin-scrollbar border-border/60 bg-card p-0">
          <DialogTitle className="sr-only">Lumina Logo Mockups</DialogTitle>
          <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border/60 bg-card/95 p-5 backdrop-blur">
            <div>
              <h2 className="text-lg font-bold">Lumina Logo Mockups</h2>
              <p className="text-xs text-foreground/50">6 directions — each integrates the sun + play icon into the wordmark.</p>
            </div>
            <button onClick={() => setOpen(false)} className="rounded-full p-2 hover:bg-foreground/10" aria-label="Close">
              <X className="h-5 w-5" />
            </button>
          </div>
          <div className="space-y-6 p-5 sm:p-6">
            {MOCKUPS.map(({ id, name, desc, Comp }, i) => (
              <div key={id} className="overflow-hidden rounded-xl border border-border/60 bg-background">
                <div className="flex items-center gap-3 border-b border-border/60 px-4 py-2.5">
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/15 text-xs font-bold text-primary">
                    {i + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <h3 className="text-sm font-semibold">{name}</h3>
                    <p className="truncate text-xs text-foreground/50">{desc}</p>
                  </div>
                </div>
                {/* Dark preview */}
                <div className="flex items-center justify-center bg-[#0a0a0a] p-8">
                  <Comp className="h-20 w-auto max-w-full" />
                </div>
                {/* Light preview */}
                <div className="flex items-center justify-center bg-[#fafafa] p-8">
                  <Comp className="h-20 w-auto max-w-full" />
                </div>
              </div>
            ))}
            <div className="rounded-xl border border-primary/30 bg-primary/5 p-4 text-center text-sm text-foreground/70">
              Tell me which number(s) you like and I'll refine it — or describe what you'd change.
              These are SVG vectors so they scale perfectly from favicon to billboard.
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
