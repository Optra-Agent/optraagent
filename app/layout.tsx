import type { Metadata, Viewport } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans, IBM_Plex_Sans_Condensed } from "next/font/google";
import "./globals.css";
import { AppProviders } from "./providers";

// One licensed superfamily (IBM Plex, OFL): Condensed for the display voice, Sans for the interface,
// Mono for every number, hash and timestamp so columns align.
const sans = IBM_Plex_Sans({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-sans", display: "swap" });
const display = IBM_Plex_Sans_Condensed({ subsets: ["latin"], weight: ["500", "600", "700"], variable: "--font-display", display: "swap" });
const mono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-mono", display: "swap" });

export const metadata: Metadata = {
  title: { default: "Optra Agent | No-Code Options Trading Agents", template: "%s · Optra Agent" },
  description:
    "Build custom options agents with modular rules. Backtest strategies, control risk, and understand every decision. Paper trading today, on Robinhood Chain.",
};

export const viewport: Viewport = {
  themeColor: "#0B0C0E",
  colorScheme: "dark",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning className={`dark ${sans.variable} ${display.variable} ${mono.variable}`}>
      <body>
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
