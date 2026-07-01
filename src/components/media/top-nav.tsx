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
  Library,
  ChevronDown,
  LayoutGrid,
} from "lucide-react";
import { useMediaStore, type RouteKey } from "@/store/media-store";
import { Logo, ThemeToggle } from "./logo";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { useGenres } from "@/lib/queries";
import { cn } from "@/lib/utils";

const NAV: { key: RouteKey; label: string; icon: typeof HomeIcon }[] = [
  { key: "home", label: "Home", icon: HomeIcon },
  { key: "movies", label: "Movies", icon: Film },
  { key: "tv", label: "TV Shows", icon: Tv },
];

export function TopNav() {
  const route = useMediaStore((s) => s.route);
  const setRoute = useMediaStore((s) => s.setRoute);
  const setGenreFilter = useMediaStore((s) => s.setGenreFilter);
  const genreFilter = useMediaStore((s) => s.genreFilter);
  const searchQuery = useMediaStore((s) => s.searchQuery);
  const setSearch = useMediaStore((s) => s.setSearch);
  const { data: genres } = useGenres();
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const isActive = (key: RouteKey) => route === key;
  const isCategoryActive = route === "category";

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

          {/* Categories dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className={cn(
                  "relative inline-flex items-center gap-1 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                  isCategoryActive
                    ? "text-foreground"
                    : "text-foreground/60 hover:text-foreground"
                )}
              >
                <LayoutGrid className="h-4 w-4" />
                Categories
                <ChevronDown className="h-3.5 w-3.5 opacity-60" />
                {isCategoryActive && (
                  <span className="absolute inset-x-3 -bottom-px h-0.5 rounded-full bg-primary" />
                )}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="start"
              className="max-h-[70vh] w-56 overflow-y-auto thin-scrollbar"
            >
              <DropdownMenuLabel>Browse by genre</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => setRoute("movies")}
                className="cursor-pointer"
              >
                <Film className="mr-2 h-4 w-4" /> All Movies
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => setRoute("tv")}
                className="cursor-pointer"
              >
                <Tv className="mr-2 h-4 w-4" /> All TV Shows
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              {(genres ?? []).map((g) => (
                <DropdownMenuItem
                  key={g}
                  onClick={() => setGenreFilter(g)}
                  className={cn(
                    "cursor-pointer justify-between",
                    isCategoryActive && genreFilter === g && "bg-primary/10 text-primary"
                  )}
                >
                  {g}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          <button
            onClick={() => setRoute("mylist")}
            className={cn(
              "relative rounded-md px-3 py-2 text-sm font-medium transition-colors",
              isActive("mylist")
                ? "text-foreground"
                : "text-foreground/60 hover:text-foreground"
            )}
          >
            My List
            {isActive("mylist") && (
              <span className="absolute inset-x-3 -bottom-px h-0.5 rounded-full bg-primary" />
            )}
          </button>

          <button
            onClick={() => setRoute("library")}
            className={cn(
              "relative rounded-md px-3 py-2 text-sm font-medium transition-colors",
              isActive("library")
                ? "text-foreground"
                : "text-foreground/60 hover:text-foreground"
            )}
          >
            Library
            {isActive("library") && (
              <span className="absolute inset-x-3 -bottom-px h-0.5 rounded-full bg-primary" />
            )}
          </button>
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
                  {[...NAV, { key: "mylist" as const, label: "My List", icon: Bookmark }, { key: "library" as const, label: "Library", icon: Library }].map((item) => {
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
                {/* mobile categories */}
                <div className="mt-4">
                  <p className="px-3 pb-1 text-xs font-bold uppercase tracking-wider text-foreground/40">
                    Categories
                  </p>
                  <div className="flex flex-wrap gap-1.5 px-3">
                    {(genres ?? []).slice(0, 16).map((g) => (
                      <button
                        key={g}
                        onClick={() => {
                          setGenreFilter(g);
                          setMobileOpen(false);
                        }}
                        className="rounded-full bg-foreground/8 px-2.5 py-1 text-xs text-foreground/70 transition-colors hover:bg-primary/15 hover:text-primary"
                      >
                        {g}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </nav>
    </header>
  );
}
