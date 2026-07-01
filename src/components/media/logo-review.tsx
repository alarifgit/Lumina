"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

/* ─────────────────────────────────────────────────────────────────────
   Lumina logo mockups — AI-generated variations for review.
   Each combines the sun/light concept with media playback elements.
   ───────────────────────────────────────────────────────────────────── */

const MOCKUPS = [
  {
    id: "v1",
    name: "Sun Behind Wordmark",
    desc: "A golden sun formed by play-button rays glowing behind and through the bold LUMINA wordmark.",
    src: "/brand/logo-v1.png",
    aspect: "aspect-[7/4]",
  },
  {
    id: "v2",
    name: "Sun as the O",
    desc: "The letter O is a bright golden sun disc with a play triangle — the icon IS a letter.",
    src: "/brand/logo-v2.png",
    aspect: "aspect-[7/4]",
  },
  {
    id: "v3",
    name: "Sunrise Behind L",
    desc: "A radiant sun rises behind the L, with play-button-triangle rays. Paramount/Netflix feel.",
    src: "/brand/logo-v3.png",
    aspect: "aspect-[7/4]",
  },
  {
    id: "v4",
    name: "Icon Mark",
    desc: "A standalone icon: golden sun with eight play-triangle rays + contrasting play center. Netflix-N / YouTube-play level of simplicity.",
    src: "/brand/logo-v4.png",
    aspect: "aspect-square",
  },
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
              <p className="text-xs text-foreground/50">4 AI-generated directions — sun + playback icon, integrated with the wordmark.</p>
            </div>
            <button onClick={() => setOpen(false)} className="rounded-full p-2 hover:bg-foreground/10" aria-label="Close">
              <X className="h-5 w-5" />
            </button>
          </div>
          <div className="space-y-6 p-5 sm:p-6">
            {MOCKUPS.map(({ id, name, desc, src, aspect }, i) => (
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
                  <img src={src} alt={name} className={cn("max-h-32 w-auto max-w-full rounded-lg", aspect)} />
                </div>
              </div>
            ))}
            <div className="rounded-xl border border-primary/30 bg-primary/5 p-4 text-center text-sm text-foreground/70">
              Tell me which number you like and I'll refine it — adjust colors, layout, icon style, etc.
              These are high-res PNGs that can be traced to crisp SVG vectors for the final version.
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
