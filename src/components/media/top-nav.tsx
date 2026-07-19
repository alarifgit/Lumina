"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Search,
  Menu,
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
  const browseTarget = useMediaStore((s) => s.browseTarget);
  const setRoute = useMediaStore((s) => s.setRoute);
  const searchQuery = useMediaStore((s) => s.searchQuery);
  const openSearch = useMediaStore((s) => s.openSearch);
  const selectedMediaId = useMediaStore((s) => s.selectedMediaId);
  const watchMediaId = useMediaStore((s) => s.watchMediaId);
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  const openSearchView = useCallback(() => {
    setMobileOpen(false);
    openSearch();
    window.setTimeout(() => window.dispatchEvent(new Event("lumina:focus-search")), 0);
  }, [openSearch]);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    const onShortcut = (event: KeyboardEvent) => {
      if (selectedMediaId || watchMediaId) return;

      const target = event.target instanceof HTMLElement ? event.target : null;
      const isEditable =
        !!target &&
        (target.isContentEditable ||
          target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT");
      const slash = event.key === "/" && !event.ctrlKey && !event.metaKey && !event.altKey;
      const commandK = (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k";

      if ((!slash && !commandK) || (slash && isEditable)) return;
      event.preventDefault();
      openSearchView();
    };

    window.addEventListener("keydown", onShortcut);
    return () => window.removeEventListener("keydown", onShortcut);
  }, [openSearchView, selectedMediaId, watchMediaId]);

  const isActive = (key: RouteKey) =>
    route === key ||
    (key === "settings" && route === "library") ||
    (route === "browse" && key === "movies" && browseTarget?.type === "MOVIE") ||
    (route === "browse" && key === "tv" && browseTarget?.type === "TV");

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
          {/* desktop search launcher — SearchView owns the editable field */}
          <button
            type="button"
            onClick={openSearchView}
            className="hidden h-9 w-40 items-center gap-2 rounded-full border border-white/12 bg-white/[0.09] px-3 text-left text-sm text-white/56 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] backdrop-blur-xl transition-colors hover:border-white/20 hover:bg-white/[0.13] hover:text-white/78 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70 sm:inline-flex xl:w-48 min-[2200px]:h-11 min-[2200px]:w-60 min-[2200px]:text-base"
            aria-label="Search your library"
          >
            <Search className="h-4 w-4 shrink-0" />
            <span className="min-w-0 flex-1 truncate">
              {route === "search" && searchQuery ? searchQuery : "Search library…"}
            </span>
            <kbd className="hidden rounded border border-white/12 bg-[var(--lumina-ink)]/34 px-1.5 py-0.5 text-[10px] font-medium text-white/42 xl:inline">
              /
            </kbd>
          </button>

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
                <button
                  type="button"
                  onClick={openSearchView}
                  className="mb-4 flex h-10 w-full items-center gap-2.5 rounded-lg border border-white/12 bg-white/[0.06] px-3 text-sm text-white/64 transition-colors hover:bg-white/[0.1] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70 sm:hidden"
                  aria-label="Search your library"
                >
                  <Search className="h-4 w-4" />
                  <span className="truncate">
                    {route === "search" && searchQuery ? searchQuery : "Search library…"}
                  </span>
                </button>
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
