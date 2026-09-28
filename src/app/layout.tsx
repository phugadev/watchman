import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const sans = Geist({
  subsets: ["latin"],
  variable: "--font-geist-sans",
  display: "swap",
});

const mono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-geist-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "Watchman",
    template: "%s · Watchman",
  },
  description:
    "Self-hosted end-to-end monitoring: synthetic checks, dead-man's-switch heartbeats, incidents, and status pages.",
  applicationName: "Watchman",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  // Minima's canvas in each mode, so the browser chrome matches the page.
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f8f8f8" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0a" },
  ],
  colorScheme: "light dark",
};

/*
 * Minima keys dark mode off a `.dark` class on the root. Watchman follows the
 * reader's OS setting, so the class is set from prefers-color-scheme before
 * first paint — inline, in the head, so there is no flash of the wrong mode —
 * and kept in step if the setting changes while a dashboard is left open.
 */
const followSystemTheme = `(() => {
  const q = matchMedia("(prefers-color-scheme: dark)");
  const apply = () => document.documentElement.classList.toggle("dark", q.matches);
  apply();
  q.addEventListener("change", apply);
})();`;

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: followSystemTheme }} />
      </head>
      <body className="min-h-dvh bg-background text-foreground antialiased">{children}</body>
    </html>
  );
}
