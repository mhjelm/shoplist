import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Fraunces, Newsreader } from "next/font/google";
import "./globals.css";
import { getUserPreferences } from "@/lib/preferences";
import ServiceWorkerRegister from "@/components/ServiceWorkerRegister";
import SyncProvider from "@/components/SyncProvider";
import ConflictBanner from "@/components/ConflictBanner";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
  axes: ["opsz"],
});

const newsreader = Newsreader({
  variable: "--font-newsreader",
  subsets: ["latin"],
  style: ["normal", "italic"],
});

export const metadata: Metadata = {
  title: "Shopping List",
  description: "Family shopping lists",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "Shoplist" },
  icons: { icon: '/icon-192.png' },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0a" },
  ],
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const { theme, high_contrast, reduce_motion } = await getUserPreferences();
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${fraunces.variable} ${newsreader.variable} h-full antialiased ${theme === 'dark' ? 'dark' : ''} ${theme === 'shoplist' ? 'shoplist' : ''} ${theme === 'polar' ? 'polar' : ''} ${theme === 'dusk' ? 'dusk' : ''} ${theme === 'editorial' ? 'editorial' : ''} ${high_contrast ? 'hc' : ''} ${reduce_motion ? 'reduce-motion' : ''}`}
    >
      <body className="min-h-full flex flex-col bg-white dark:bg-gray-950 text-gray-900 dark:text-gray-100">
        <ConflictBanner />
        {children}
        <SyncProvider />
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
