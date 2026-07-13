"use client";

import { useEffect, useState } from "react";
import {
  Search,
  Menu,
  X,
  Film,
  Home as HomeIcon,
  Tv,
  Bookmark,
  Settings,
} from "lucide-react";
import { useMediaStore, type RouteKey } from "@/store/media-store";
import { Logo } from "./logo";
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
  { key: "settings", label: "Settings", icon: Settings },
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

  const isActive = (key: RouteKey) =>
    route === key || (key === "settings" && route === "library");

  const navButtonClass = (active: boolean) =>
    cn(
      "group inline-flex h-9 items-center gap-2 rounded-full px-3.5 text-xs font-medium transition-all duration-200 min-[2200px]:h-11 min-[2200px]:px-4 min-[2200px]:text-sm",
      active
        ? "bg-white/14 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.12)]"
        : "text-white/58 hover:bg-white/[0.08] hover:text-white"
    );

  return (
    <header
      className={cn(
        "fixed inset-x-0 top-0 z-40 border-b border-transparent transition-[background-color,border-color,box-shadow,backdrop-filter] duration-300",
        scrolled
          ? "border-white/10 bg-[#304b58]/74 shadow-[0_16px_48px_rgba(17,37,47,0.18)] backdrop-blur-2xl"
          : "bg-gradient-to-b from-[#263f4c]/34 to-transparent"
      )}
    >
      <nav
        className="lumina-page flex min-h-16 items-center gap-3 px-4 py-3 sm:px-6 md:grid md:grid-cols-[1fr_auto_1fr] lg:px-8 min-[2200px]:min-h-20"
        aria-label="Primary"
      >
        <button
          onClick={() => setRoute("home")}
          className="flex items-center justify-self-start transition-opacity hover:opacity-80"
          aria-label="Lumina home"
        >
          <Logo size="lg" className="max-w-[46vw] min-[2200px]:text-4xl" />
        </button>

        {/* desktop nav */}
        <div className="hidden items-center gap-0.5 rounded-full bg-[var(--lumina-ink)] p-1 shadow-[0_12px_34px_rgba(8,27,36,0.22),inset_0_1px_0_rgba(255,255,255,0.06)] md:flex min-[2200px]:p-1.5">
          {NAV.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.key}
                onClick={() => setRoute(item.key)}
                className={navButtonClass(isActive(item.key))}
                aria-current={isActive(item.key) ? "page" : undefined}
              >
                <Icon className="h-4 w-4 min-[2200px]:h-5 min-[2200px]:w-5" />
                <span className="hidden lg:inline">{item.label}</span>
              </button>
            );
          })}
        </div>

        <div className="ml-auto flex items-center gap-2 justify-self-end">
          {/* desktop search */}
          <div className="relative hidden items-center sm:flex">
            <Search className="pointer-events-none absolute left-2.5 h-4 w-4 text-foreground/50" />
            <input
              value={searchQuery}
              onChange={(e) => setSearch(e.target.value)}
              onFocus={() => searchQuery.trim() && setRoute("search")}
              placeholder="Search titles…"
              className={cn(
                "h-9 rounded-full border border-white/12 bg-white/[0.09] pl-9 pr-3 text-sm text-white placeholder:text-white/42 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] backdrop-blur-xl transition-all focus:border-white/28 focus:bg-white/[0.14] focus:outline-none min-[2200px]:h-11 min-[2200px]:pl-10 min-[2200px]:text-base",
                "w-36 focus:w-56 xl:w-44 xl:focus:w-64 min-[2200px]:w-56 min-[2200px]:focus:w-72"
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
            <SheetContent side="left" className="w-72 border-white/12 bg-[#243b47]/96 p-0 backdrop-blur-2xl">
              <SheetHeader className="px-5 pt-5">
                <SheetTitle asChild>
                  <div>
                    <Logo size="lg" />
                  </div>
                </SheetTitle>
              </SheetHeader>
              <div className="thin-scrollbar max-h-[calc(100vh-100px)] overflow-y-auto px-3 py-4">
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
