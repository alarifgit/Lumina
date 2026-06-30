import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { Providers } from "@/components/providers";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Lumina — Your Personal Cinema",
  description:
    "A premium streaming front-end for your personal movie & TV library. Browse, search, and play your media with rich metadata.",
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
    icon: "/brand/logo-mark.png",
    apple: "/brand/logo-mark.png",
  },
  openGraph: {
    title: "Lumina — Your Personal Cinema",
    description: "A premium streaming front-end for your personal media library.",
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
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        <Providers>{children}</Providers>
        <Toaster />
      </body>
    </html>
  );
}
