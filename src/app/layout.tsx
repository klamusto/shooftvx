import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "شوف تيفي Shoof TV — بث مباشر لمباريات اليوم",
    template: "%s — شوف تيفي",
  },
  description:
    "شوف تيفي Shoof TV: شاهد مباريات اليوم بث مباشر بجودة عالية وبدون تقطيع. جدول المباريات، النتائج المباشرة، والقنوات الناقلة في مكان واحد.",
  keywords: [
    "مباريات اليوم",
    "بث مباشر",
    "شوف تيفي",
    "shoof tv",
    "كورة",
    "مباريات مباشرة",
  ],
  applicationName: "Shoof TV",
  openGraph: {
    title: "شوف تيفي Shoof TV — بث مباشر لمباريات اليوم",
    description: "شاهد مباريات اليوم بث مباشر بجودة عالية وبدون تقطيع.",
    type: "website",
    locale: "ar_AR",
  },
};

export const viewport: Viewport = {
  themeColor: "#04060d",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ar" dir="rtl">
      <body className="min-h-screen bg-ink-950 font-sans antialiased">{children}</body>
    </html>
  );
}
