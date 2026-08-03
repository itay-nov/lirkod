import type { Metadata } from "next";
import localFont from "next/font/local";
import { he } from "@/lib/i18n/he";
import "./globals.css";

// Heebo is designed specifically for Hebrew UI legibility (vs. a Latin
// typeface with a bolted-on Hebrew fallback), which matters for a 50+,
// low-tech-literacy audience (AGENTS.md §2). Vendored as a local variable
// font (not next/font/google) so the build never needs network access —
// see docs/decisions/0001-project-skeleton.md.
const heebo = localFont({
  src: "./fonts/Heebo-Variable.ttf",
  variable: "--font-heebo",
  weight: "100 900",
  display: "swap",
});

export const metadata: Metadata = {
  title: he.common.appName,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="he" dir="rtl" className={heebo.variable}>
      <body>{children}</body>
    </html>
  );
}
