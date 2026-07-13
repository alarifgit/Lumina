import { cn } from "@/lib/utils";

export function MediaCardSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn("w-[clamp(142px,38vw,172px)] shrink-0 sm:w-[clamp(172px,22vw,210px)] lg:w-[clamp(210px,12.5vw,420px)]", className)}>
      <div className="aspect-[2/3] animate-pulse rounded-lg bg-white/10" />
      <div className="mt-2.5 h-4 w-4/5 animate-pulse rounded bg-white/10" />
      <div className="mt-2 h-3 w-2/5 animate-pulse rounded bg-white/[0.07]" />
    </div>
  );
}

export function ContentRowSkeleton({ count = 7 }: { count?: number }) {
  return (
    <section className="lumina-page py-2">
      <div className="mb-2 px-4 sm:px-6 lg:px-8">
        <div className="h-6 w-40 animate-pulse rounded bg-foreground/10" />
      </div>
      <div className="flex gap-3 overflow-hidden px-4 pb-2 sm:gap-4 sm:px-6 lg:px-8">
        {Array.from({ length: count }).map((_, i) => (
          <MediaCardSkeleton key={i} />
        ))}
      </div>
    </section>
  );
}

export function HeroSkeleton() {
  return (
    <div className="lumina-page grid gap-4 px-4 pt-20 sm:px-6 lg:grid-cols-[1.08fr_0.92fr] lg:items-end lg:px-8">
      <div className="min-h-[360px] animate-pulse rounded-lg bg-white/10 lg:min-h-[400px] xl:min-h-[clamp(500px,28vw,760px)]" />
      <div className="hidden min-h-[360px] animate-pulse rounded-lg bg-white/[0.07] xl:block xl:min-h-[clamp(430px,24vw,680px)]" />
    </div>
  );
}

export function GridSkeleton({ count = 18 }: { count?: number }) {
  return (
    <div className="lumina-media-grid">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="w-full">
          <div className="aspect-[2/3] animate-pulse rounded-lg bg-white/10" />
          <div className="mt-2.5 h-4 w-4/5 animate-pulse rounded bg-white/10" />
          <div className="mt-2 h-3 w-2/5 animate-pulse rounded bg-white/[0.07]" />
        </div>
      ))}
    </div>
  );
}
