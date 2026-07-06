import type { Metadata } from "next";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { Providers } from "@/components/providers";

export const metadata: Metadata = {
  title: "Lumina",
  description:
    "A premium, self-hosted cinema for your personal movie & TV library. Browse, search, and play your media with rich metadata.",
  keywords: [
    "Lumina",
    "media server",
    "streaming",
    "movies",
    "TV shows",
    "personal library",
    "Plex",
    "Jellyfin",
  ],
  authors: [{ name: "Lumina" }],
  icons: {
    icon: [
      {
        url: "/brand/lumina/codex-logo-pack/lumina_codex_logo_pack/favicons/favicon-32x32.png",
        sizes: "32x32",
        type: "image/png",
      },
      {
        url: "/brand/lumina/codex-logo-pack/lumina_codex_logo_pack/favicons/favicon-16x16.png",
        sizes: "16x16",
        type: "image/png",
      },
    ],
    shortcut: "/brand/lumina/codex-logo-pack/lumina_codex_logo_pack/favicons/favicon-32x32.png",
    apple: "/brand/lumina/codex-logo-pack/lumina_codex_logo_pack/favicons/apple-touch-icon.png",
  },
  openGraph: {
    title: "Lumina",
    description: "A premium, self-hosted cinema for your personal media library.",
    siteName: "Lumina",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning className="dark">
      <body className="antialiased">
        <Providers>{children}</Providers>
        <Toaster />
      </body>
    </html>
  );
}
