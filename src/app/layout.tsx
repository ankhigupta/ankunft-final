import type { Metadata, Viewport } from "next";
import "@fontsource-variable/atkinson-hyperlegible-next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Ankunft: an arrival planner for international students in Berlin",
  description:
    "A dependency-aware arrival plan and cited Q&A for non-EU students arriving in Berlin on a national study visa. Rules, not guesses: every step shows its source and why it is blocked.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#0b2545" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
