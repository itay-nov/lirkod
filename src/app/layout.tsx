import type { Metadata } from "next";
import { he } from "@/lib/i18n/he";
import "./globals.css";

export const metadata: Metadata = {
  title: he.common.appName,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="he" dir="rtl">
      <body>{children}</body>
    </html>
  );
}
