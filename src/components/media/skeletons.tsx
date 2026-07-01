import { cn } from "@/lib/utils";

export function MediaCardSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn("w-[130px] shrink-0 sm:w-[160px] md:w-[175px] lg:w-[190px]", className)}>
      <div className="aspect-[2/3] animate-pulse rounded-lg bg-foreground/10" />
    </div>
  );
}

export function ContentRowSkeleton({ count = 7 }: { count?: number }) {
  return (
    <section className="py-2">
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
    <div className="relative h-[58vh] min-h-[380px] w-full animate-pulse bg-foreground/10" />
  );
}

export function GridSkeleton({ count = 18 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="w-full">
          <div className="aspect-[2/3] animate-pulse rounded-lg bg-foreground/10" />
        </div>
      ))}
    </div>
  );
}
