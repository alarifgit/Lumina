"use client";

import { Logo } from "./logo";
import { useStats } from "@/lib/queries";

export function Footer() {
  const { data: stats } = useStats();
  return (
    <footer className="mt-auto border-t border-border/60 bg-background/60">
      <div className="mx-auto flex max-w-screen-2xl flex-col items-start justify-between gap-4 px-4 py-6 sm:flex-row sm:items-center sm:px-6 lg:px-8">
        <div className="flex items-center gap-3">
          <Logo size="sm" />
          <span className="text-xs text-foreground/50">
            · Personal media library
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-foreground/50">
          <span>{stats?.mediaCount ?? "—"} titles in library</span>
          {stats?.totalRuntimeHours ? (
            <span>≈ {stats.totalRuntimeHours.toLocaleString()} hours of content</span>
          ) : null}
          {stats?.lastScan ? (
            <span>Last scan: {new Date(stats.lastScan).toLocaleDateString()}</span>
          ) : (
            <span>Add media paths in Settings</span>
          )}
        </div>
      </div>
    </footer>
  );
}
