import type { Metadata, Viewport } from "next";
import { Barlow_Condensed, IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import type { ReactNode } from "react";
import { Providers } from "./providers";
import "./globals.css";

const display = Barlow_Condensed({ subsets: ["latin"], weight: ["200", "300", "600"], variable: "--font-display" });
const mono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "600"], variable: "--font-mono" });
const sans = IBM_Plex_Sans({ subsets: ["latin"], weight: ["400", "600"], variable: "--font-sans" });

export const metadata: Metadata = {
  title: "Squeek Markets",
  description: "Call what a real hamster does tonight. YES/NO pools in testnet SQK, settled only from SqueekCore on Sepolia.",
  // Proves to Squeekchain Genesis that this site belongs to the project. It is rechecked daily, so keep it.
  other: { "squeekchain-project": "39be84c3-d662-4eef-9544-44af49447781" },
};
export const viewport: Viewport = { themeColor: "#0a0a0c", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${mono.variable} ${sans.variable}`}>
      <body><Providers>{children}</Providers></body>
    </html>
  );
}
