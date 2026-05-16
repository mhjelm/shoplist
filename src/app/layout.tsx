import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
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

export const metadata: Metadata = {
  title: "Shopping List",
  description: "Family shopping lists",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "Shoplist" },
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
  const { theme, high_contrast } = await getUserPreferences();
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased ${theme === 'dark' ? 'dark' : ''} ${high_contrast ? 'hc' : ''}`}
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
