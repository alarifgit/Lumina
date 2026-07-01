"use client";

import { useEffect, useState } from "react";
import { Search, Menu, X, Film, Home as HomeIcon, Tv, Bookmark, Library } from "lucide-react";
import { useMediaStore, type RouteKey } from "@/store/media-store";
import { Logo, ThemeToggle } from "./logo";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

const NAV: { key: RouteKey; label: string; icon: typeof HomeIcon }[] = [
  { key: "home", label: "Home", icon: HomeIcon },
  { key: "movies", label: "Movies", icon: Film },
  { key: "tv", label: "TV Shows", icon: Tv },
  { key: "mylist", label: "My List", icon: Bookmark },
  { key: "library", label: "Library", icon: Library },
];

export function TopNav() {
  const route = useMediaStore((s) => s.route);
  const setRoute = useMediaStore((s) => s.setRoute);
  const searchQuery = useMediaStore((s) => s.searchQuery);
  const setSearch = useMediaStore((s) => s.setSearch);
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const isActive = (key: RouteKey) => {
    if (key === "movies") return route === "movies";
    if (key === "tv") return route === "tv";
    return route === key;
  };

  return (
    <header
      className={cn(
        "fixed inset-x-0 top-0 z-40 transition-all duration-300",
        scrolled
          ? "border-b border-border/60 bg-background/85 backdrop-blur-xl"
          : "bg-gradient-to-b from-background/80 to-transparent"
      )}
    >
      <nav className="flex h-16 items-center gap-3 px-4 sm:px-6 lg:px-8" aria-label="Primary">
        <button
          onClick={() => setRoute("home")}
          className="flex items-center transition-opacity hover:opacity-80"
          aria-label="Lumina home"
        >
          <Logo />
        </button>

        {/* desktop nav */}
        <div className="ml-4 hidden items-center gap-1 md:flex">
          {NAV.map((item) => (
            <button
              key={item.key}
              onClick={() => setRoute(item.key)}
              className={cn(
                "relative rounded-md px-3 py-2 text-sm font-medium transition-colors",
                isActive(item.key)
                  ? "text-foreground"
                  : "text-foreground/60 hover:text-foreground"
              )}
            >
              {item.label}
              {isActive(item.key) && (
                <span className="absolute inset-x-3 -bottom-px h-0.5 rounded-full bg-primary" />
              )}
            </button>
          ))}
        </div>

        <div className="ml-auto flex items-center gap-2">
          {/* desktop search */}
          <div className="relative hidden items-center sm:flex">
            <Search className="pointer-events-none absolute left-2.5 h-4 w-4 text-foreground/50" />
            <input
              value={searchQuery}
              onChange={(e) => setSearch(e.target.value)}
              onFocus={() => searchQuery.trim() && setRoute("search")}
              placeholder="Search titles…"
              className={cn(
                "h-9 rounded-full border border-border/60 bg-foreground/5 pl-9 pr-3 text-sm text-foreground placeholder:text-foreground/40 transition-all focus:border-primary/50 focus:bg-foreground/8 focus:outline-none focus:ring-1 focus:ring-primary/30",
                "w-40 focus:w-64"
              )}
              aria-label="Search"
            />
            {searchQuery && (
              <button
                onClick={() => setSearch("")}
                className="absolute right-2 text-foreground/50 hover:text-foreground"
                aria-label="Clear search"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>

          <ThemeToggle />

          {/* avatar */}
          <div className="hidden h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-primary to-amber-700 text-sm font-bold text-primary-foreground sm:flex">
            L
          </div>

          {/* mobile menu */}
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetTrigger asChild>
              <button
                className="inline-flex h-9 w-9 items-center justify-center rounded-md text-foreground hover:bg-foreground/10 md:hidden"
                aria-label="Open menu"
              >
                <Menu className="h-5 w-5" />
              </button>
            </SheetTrigger>
            <SheetContent side="left" className="w-72 bg-background p-0">
              <SheetHeader className="px-5 pt-5">
                <SheetTitle asChild>
                  <div>
                    <Logo />
                  </div>
                </SheetTitle>
              </SheetHeader>
              <div className="px-3 py-4">
                <div className="relative mb-4 flex items-center sm:hidden">
                  <Search className="pointer-events-none absolute left-2.5 h-4 w-4 text-foreground/50" />
                  <input
                    value={searchQuery}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search titles…"
                    className="h-10 w-full rounded-lg border border-border/60 bg-foreground/5 pl-9 pr-3 text-sm focus:border-primary/50 focus:outline-none"
                    aria-label="Search"
                  />
                </div>
                <nav className="flex flex-col gap-1">
                  {NAV.map((item) => {
                    const Icon = item.icon;
                    return (
                      <button
                        key={item.key}
                        onClick={() => {
                          setRoute(item.key);
                          setMobileOpen(false);
                        }}
                        className={cn(
                          "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                          isActive(item.key)
                            ? "bg-primary/15 text-primary"
                            : "text-foreground/70 hover:bg-foreground/10 hover:text-foreground"
                        )}
                      >
                        <Icon className="h-4 w-4" />
                        {item.label}
                      </button>
                    );
                  })}
                </nav>
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </nav>
    </header>
  );
}
