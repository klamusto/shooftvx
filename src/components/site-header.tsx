"use client";

import { useEffect, useState } from "react";
import { Logo } from "@/components/logo";
import { LiveClock } from "@/components/live-clock";
import { TelegramButton } from "@/components/telegram-button";

export function SiteHeader({ liveCount = 0 }: { liveCount?: number }) {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={`fixed inset-x-0 top-0 z-50 transition-all duration-300 ${
        scrolled
          ? "border-b border-white/8 bg-ink-950/85 shadow-[0_10px_40px_rgba(0,0,0,0.45)] backdrop-blur-xl"
          : "border-b border-transparent bg-transparent"
      }`}
    >
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6">
        <Logo />

        <nav className="hidden items-center gap-2 md:flex">
          <a
            href="#matches"
            className="rounded-full px-4 py-2 text-sm font-semibold text-slate-300 transition-colors hover:bg-white/5 hover:text-white"
          >
            المباريات
          </a>
          <a
            href="#matches"
            className="rounded-full px-4 py-2 text-sm font-semibold text-slate-300 transition-colors hover:bg-white/5 hover:text-white"
          >
            بث مباشر
          </a>
        </nav>

        <div className="flex items-center gap-2.5 sm:gap-3">
          <LiveClock />
          <TelegramButton compact className="hidden md:inline-flex" />
          {liveCount > 0 ? (
            <span className="flex items-center gap-2 rounded-full border border-red-500/25 bg-red-500/10 px-3.5 py-1.5 text-xs font-bold text-red-300">
              <span className="live-dot size-2 rounded-full bg-red-500 shadow-[0_0_10px_rgba(239,68,68,0.9)]" />
              {liveCount} مباشر الآن
            </span>
          ) : (
            <span className="flex items-center gap-2 rounded-full border border-emerald-500/25 bg-emerald-500/10 px-3.5 py-1.5 text-xs font-bold text-emerald-300">
              <span className="size-2 rounded-full bg-emerald-400" />
              اليوم
            </span>
          )}
        </div>
      </div>
    </header>
  );
}
