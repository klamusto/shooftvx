"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { MatchesResponse, WatchResponse } from "@/lib/types";
import { formatClock } from "@/lib/format";
import { Logo } from "@/components/logo";
import { TeamLogo } from "@/components/team-logo";
import { StatusBadge } from "@/components/match-card";
import { Countdown } from "@/components/countdown";
import { MatchDetailsPanel } from "@/components/match-details-panel";

export function WatchClient({ matchId }: { matchId: string }) {
  const [data, setData] = useState<WatchResponse | null>(null);
  const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [related, setRelated] = useState<MatchesResponse | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const [armed, setArmed] = useState(true); // click-to-play shield
  const [shared, setShared] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const share = useCallback(async () => {
    const url = window.location.href;
    const match = data?.match ?? null;
    try {
      if (navigator.share) {
        await navigator.share({
          title: match
            ? `${match.homeName} ضد ${match.awayName} — شوف تيفي`
            : "شوف تيفي",
          url,
        });
        return;
      }
      await navigator.clipboard.writeText(url);
      setShared(true);
      setTimeout(() => setShared(false), 2000);
    } catch {
      // ignore share cancel
    }
  }, [data]);

  const handleRetry = useCallback(() => {
    setPhase("loading");
    setData(null);
    setArmed(true);
    setRetryKey((k) => k + 1);
  }, []);

  useEffect(() => {
    let ignore = false;
    const fetchWatch = async () => {
      try {
        const res = await fetch(`/api/watch/${encodeURIComponent(matchId)}`, {
          cache: "no-store",
        });
        if (ignore) return;
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as WatchResponse;
        if (ignore) return;
        setData(json);
        setPhase("ready");
        setErrorMsg(null);
      } catch (err) {
        if (ignore) return;
        setErrorMsg(err instanceof Error ? err.message : "تعذر تحميل البث");
        setPhase("error");
      }
    };

    fetchWatch();
    // Live scoreboard: refresh every 30s while the page is open. This also
    // flips waiting/unavailable states into the player at kickoff.
    pollRef.current = setInterval(() => {
      if (document.visibilityState === "visible") fetchWatch();
    }, 30_000);
    return () => {
      ignore = true;
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [matchId, retryKey]);

  useEffect(() => {
    fetch("/api/matches", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: MatchesResponse | null) => setRelated(j))
      .catch(() => setRelated(null));
  }, []);

  const m = data?.match ?? null;
  const live = m?.status === "live";
  const finished = m?.status === "finished";
  const playerState = data?.playerState ?? "unavailable";

  const others = useMemo(() => {
    if (!related) return [];
    return related.matches.filter((x) => x.id !== Number(matchId)).slice(0, 6);
  }, [related, matchId]);

  const gameTimeDisplay =
    data?.game?.gameTimeDisplay ?? m?.gameTime ?? null;

  return (
    <main className="relative min-h-screen">
      {/* Ambient background */}
      <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
        <div className="absolute -top-40 right-[10%] size-[34rem] rounded-full bg-emerald-500/12 blur-[130px]" />
        <div className="absolute bottom-0 left-[5%] size-[28rem] rounded-full bg-indigo-500/10 blur-[130px]" />
        <div className="absolute inset-0 field-grid" />
      </div>

      {/* Top bar */}
      <header className="sticky top-0 z-40 border-b border-white/6 bg-ink-950/80 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6">
          <Logo />
          <Link
            href="/"
            className="glass flex items-center gap-2 rounded-full px-4 py-2 text-sm font-bold text-white transition-all hover:border-emerald-400/40 hover:text-emerald-300"
          >
            <svg viewBox="0 0 24 24" className="size-4 fill-none stroke-current" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z" />
            </svg>
            المباريات
          </Link>
        </div>
      </header>

      <div className="mx-auto grid w-full max-w-7xl gap-6 px-4 py-8 sm:px-6 lg:grid-cols-[1fr_320px]">
        {/* Player column */}
        <div className="flex flex-col gap-5">
          {phase === "loading" && (
            <div className="glass flex aspect-video w-full flex-col items-center justify-center gap-4 rounded-3xl">
              <div className="relative size-16">
                <span className="absolute inset-0 animate-spin rounded-full border-4 border-white/10 border-t-emerald-400" />
                <span className="absolute inset-3 animate-spin rounded-full border-4 border-white/5 border-t-cyan-400 [animation-direction:reverse] [animation-duration:1.2s]" />
              </div>
              <p className="text-sm font-semibold text-slate-400">جارٍ تجهيز البث…</p>
            </div>
          )}

          {phase === "ready" && playerState === "live" && data?.playerSrc && (
            <div className="animate-rise overflow-hidden rounded-3xl border border-white/10 bg-black shadow-[0_0_80px_rgba(16,185,129,0.14)]">
              <div className="flex items-center justify-between gap-2 border-b border-white/8 bg-ink-900/90 px-4 py-3">
                <span className="flex items-center gap-2 text-xs font-bold text-slate-300">
                  <span className={`size-2 rounded-full ${live ? "live-dot bg-red-500" : "bg-emerald-400"}`} />
                  {live ? "بث مباشر — جودة عالية" : "المشغل جاهز"}
                  <span className="hidden items-center gap-1 rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2 py-0.5 text-[10px] text-emerald-300 sm:flex">
                    🛡️ حماية من النوافذ المنبثقة
                  </span>
                </span>
                <div className="flex items-center gap-2">
                  <button
                    onClick={share}
                    className="rounded-full border border-white/10 px-3 py-1 text-[11px] font-bold text-slate-400 transition-colors hover:border-emerald-400/40 hover:text-emerald-300"
                  >
                    {shared ? "✓ تم النسخ" : "مشاركة 🔗"}
                  </button>
                  <a
                    href={data.watchUrl ?? undefined}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="rounded-full border border-white/10 px-3 py-1 text-[11px] font-bold text-slate-400 transition-colors hover:border-emerald-400/40 hover:text-emerald-300"
                  >
                    فتح في نافذة جديدة ↗
                  </a>
                </div>
              </div>
              <div className="relative aspect-video w-full bg-black">
                <iframe
                  key={data.playerSrc}
                  src={data.playerSrc}
                  className="absolute inset-0 size-full"
                  allowFullScreen
                  allow="autoplay; fullscreen; encrypted-media; picture-in-picture; xr-spatial-tracking"
                  referrerPolicy="no-referrer"
                  title="مشغل المباراة"
                  sandbox="allow-scripts allow-same-origin allow-presentation"
                />
                {armed && (
                  <button
                    onClick={() => setArmed(false)}
                    className="group absolute inset-0 z-10 flex flex-col items-center justify-center gap-4 bg-gradient-to-b from-ink-950/70 via-ink-950/40 to-ink-950/70 backdrop-blur-[2px]"
                    aria-label="اضغط لتشغيل البث"
                  >
                    <span className="relative grid size-20 place-items-center rounded-full bg-gradient-to-br from-emerald-400 to-cyan-400 shadow-[0_0_60px_rgba(16,185,129,0.55)] transition-transform duration-300 group-hover:scale-110">
                      <span className="absolute inset-0 animate-ping rounded-full bg-emerald-400/40" />
                      <svg viewBox="0 0 24 24" className="relative size-8 fill-ink-950">
                        <path d="M8 5.9c0-1.5 1.6-2.4 2.9-1.7l9 5.2c1.3.7 1.3 2.5 0 3.2l-9 5.2c-1.3.7-2.9-.2-2.9-1.7V5.9z" />
                      </svg>
                    </span>
                    <span className="text-lg font-bold text-white">اضغط للمشاهدة</span>
                    <span className="text-xs text-slate-300">
                      🛡️ نوافذ الإعلانات المنبثقة محجوبة تلقائياً
                    </span>
                  </button>
                )}
              </div>
            </div>
          )}

          {phase === "ready" && playerState === "waiting" && m && (
            <div className="glass flex aspect-video w-full flex-col items-center justify-center gap-5 rounded-3xl p-8 text-center">
              <span className="grid size-16 place-items-center rounded-2xl bg-amber-400/10 text-3xl">⏳</span>
              <h3 className="text-lg font-bold text-white">لم تبدأ المباراة بعد</h3>
              <div className="flex flex-col items-center gap-2">
                <span className="tabular font-display text-4xl font-bold text-white">
                  {formatClock(m.startTime)}
                </span>
                <Countdown target={m.startTime} />
              </div>
              <p className="max-w-sm text-sm leading-6 text-slate-400">
                {m.homeName} ضد {m.awayName} — سيظهر البث هنا تلقائياً عند انطلاق المباراة،
                لا حاجة لتحديث الصفحة.
              </p>
            </div>
          )}

          {phase === "ready" && playerState === "ended" && (
            <div className="glass flex aspect-video w-full flex-col items-center justify-center gap-5 rounded-3xl p-8 text-center">
              <span className="grid size-16 place-items-center rounded-2xl bg-slate-500/10 text-3xl">🏆</span>
              <h3 className="text-lg font-bold text-white">انتهت هذه المباراة</h3>
              <p className="max-w-sm text-sm leading-6 text-slate-400">
                انتهى بث هذه المباراة ولم يعد متوفراً لدى المصدر.
                {m && (live || finished) ? " يمكنك مراجعة النتيجة النهائية بالأسفل." : ""}
              </p>
              <div className="flex flex-wrap items-center justify-center gap-3">
                <Link
                  href="/"
                  className="glass rounded-full px-6 py-2.5 text-sm font-bold text-white hover:border-emerald-400/40"
                >
                  مباريات اليوم
                </Link>
                <button
                  onClick={handleRetry}
                  className="rounded-full border border-white/10 px-6 py-2.5 text-sm font-bold text-slate-300 transition-colors hover:border-emerald-400/40 hover:text-emerald-300"
                >
                  إعادة المحاولة
                </button>
              </div>
            </div>
          )}

          {phase === "ready" && playerState === "unavailable" && (
            <div className="glass flex aspect-video w-full flex-col items-center justify-center gap-5 rounded-3xl p-8 text-center">
              <span className="relative grid size-16 place-items-center rounded-2xl bg-emerald-500/10 text-3xl">
                <span className="absolute inset-0 animate-ping rounded-2xl bg-emerald-500/10" />
                📡
              </span>
              <h3 className="text-lg font-bold text-white">جارٍ تجهيز البث…</h3>
              <p className="max-w-sm text-sm leading-6 text-slate-400">
                لم يتوفر بث لهذه المباراة لدى المصدر بعد. نعيد المحاولة تلقائياً كل ٣٠ ثانية —
                إذا كانت المباراة على وشك البدء فسيظهر البث هنا مباشرة.
              </p>
              <div className="flex flex-wrap items-center justify-center gap-3">
                <button
                  onClick={handleRetry}
                  className="rounded-full bg-gradient-to-l from-emerald-500 to-cyan-500 px-6 py-2.5 text-sm font-bold text-ink-950 transition-transform hover:scale-105"
                >
                  إعادة المحاولة الآن
                </button>
                {data?.watchUrl && (
                  <a
                    href={data.watchUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="glass rounded-full px-6 py-2.5 text-sm font-bold text-white hover:border-emerald-400/40"
                  >
                    فتح من المصدر ↗
                  </a>
                )}
              </div>
            </div>
          )}

          {phase === "error" && (
            <div className="glass flex aspect-video w-full flex-col items-center justify-center gap-4 rounded-3xl p-8 text-center">
              <span className="grid size-16 place-items-center rounded-2xl bg-red-500/10 text-3xl">🛰️</span>
              <h3 className="text-lg font-bold text-white">تعذر تشغيل البث</h3>
              <p className="max-w-sm text-sm leading-6 text-slate-400">
                حدث خطأ أثناء تجهيز البث ({errorMsg}). يمكنك إعادة المحاولة أو مشاهدة المباراة من المصدر مباشرة.
              </p>
              <div className="flex flex-wrap items-center justify-center gap-3">
                <button
                  onClick={handleRetry}
                  className="rounded-full bg-gradient-to-l from-emerald-500 to-cyan-500 px-6 py-2.5 text-sm font-bold text-ink-950 transition-transform hover:scale-105"
                >
                  إعادة المحاولة
                </button>
                {data?.watchUrl && (
                  <a
                    href={data.watchUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="glass rounded-full px-6 py-2.5 text-sm font-bold text-white hover:border-emerald-400/40"
                  >
                    فتح من المصدر ↗
                  </a>
                )}
              </div>
            </div>
          )}

          {/* Scoreboard strip */}
          {m && (
            <div className="glass animate-rise overflow-hidden rounded-3xl">
              <div className="flex items-center justify-between gap-2 border-b border-white/6 bg-white/2 px-5 py-3">
                <span className="flex items-center gap-2 text-xs font-bold text-slate-300">
                  <svg viewBox="0 0 24 24" className="size-4 fill-none stroke-emerald-400" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="9" />
                    <path d="M12 7v5l3 2" />
                  </svg>
                  {m.competition ?? m.league ?? "مباراة اليوم"}
                  {data?.game?.roundName && <span className="text-slate-500">· {data.game.roundName} {data.game.roundName && data.game.seasonNum ? "" : ""}</span>}
                </span>
                <StatusBadge match={m} />
              </div>

              <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 px-5 py-6">
                <div className="flex flex-col items-center gap-3">
                  <TeamLogo src={m.homeLogo} alt={m.homeName} className="size-16 sm:size-20" />
                  <p className="text-center text-sm font-bold text-white sm:text-base">{m.homeName}</p>
                </div>

                <div className="flex flex-col items-center gap-1 px-2">
                  {live || finished ? (
                    <>
                      <span className="tabular font-display text-4xl font-bold tracking-wider text-white sm:text-5xl">
                        {m.homeScore ?? 0}
                        <span className="mx-2 text-slate-600">-</span>
                        {m.awayScore ?? 0}
                      </span>
                      <span className="tabular mt-1 text-sm font-bold text-red-300">
                        {live ? (gameTimeDisplay ? `د ${gameTimeDisplay}` : "مباشر") : "انتهت"}
                      </span>
                    </>
                  ) : (
                    <span className="flex flex-col items-center gap-1.5">
                      <span className="tabular font-display text-3xl font-bold text-white sm:text-4xl">
                        {formatClock(m.startTime)}
                      </span>
                      <span className="text-xs font-semibold text-slate-400">{m.statusLabel ?? "قادمة"}</span>
                    </span>
                  )}
                </div>

                <div className="flex flex-col items-center gap-3">
                  <TeamLogo src={m.awayLogo} alt={m.awayName} className="size-16 sm:size-20" />
                  <p className="text-center text-sm font-bold text-white sm:text-base">{m.awayName}</p>
                </div>
              </div>

              {(live || finished) &&
                ((m.homeScorers?.length ?? 0) > 0 || (m.awayScorers?.length ?? 0) > 0) && (
                <div className="grid grid-cols-2 gap-x-4 border-t border-white/6 bg-white/2 px-5 py-3 text-[11px] text-slate-400">
                  <div className="space-y-1 text-center sm:text-start">
                    {m.homeScorers?.slice(0, 6).map((s, i) => (
                      <p key={i} className="truncate">
                        ⚽ {s}
                      </p>
                    ))}
                  </div>
                  <div className="space-y-1 text-center sm:text-end">
                    {m.awayScorers?.slice(0, 6).map((s, i) => (
                      <p key={i} className="truncate">
                        {s} ⚽
                      </p>
                    ))}
                  </div>
                </div>
              )}

              {data?.game?.statusText && live && (
                <p className="border-t border-white/6 bg-white/2 px-5 py-3 text-center text-xs font-bold text-slate-400">
                  حالة المباراة: {data.game.statusText}
                </p>
              )}
            </div>
          )}

          {/* Match details: lineups / stats / standings — scraped from the
              same data sources the original watch page uses */}
          <MatchDetailsPanel details={data?.details ?? null} />
        </div>

        {/* Sidebar */}
        <aside className="flex flex-col gap-4">
          <div className="glass rounded-3xl p-5">
            <h3 className="mb-4 flex items-center gap-2 text-sm font-bold text-white">
              <span className="grid size-7 place-items-center rounded-lg bg-emerald-500/15 text-emerald-300">
                <svg viewBox="0 0 24 24" className="size-4 fill-none stroke-current" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M15.5 17.5 12 21l-3.5-3.5M8.5 6.5 12 3l3.5 3.5M3 12h18M7 6h10M7 18h10" />
                </svg>
              </span>
              مباريات اليوم
            </h3>
            {others.length === 0 ? (
              <div className="space-y-3">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="shimmer h-20 rounded-2xl" />
                ))}
              </div>
            ) : (
              <div className="space-y-3">
                {others.map((x) => (
                  <Link
                    key={x.id}
                    href={`/watch/${x.id}`}
                    className="group flex items-center justify-between gap-2 rounded-2xl border border-white/6 bg-white/3 p-3 transition-all hover:border-emerald-400/30 hover:bg-white/5"
                  >
                    <div className="flex min-w-0 items-center gap-2.5">
                      <TeamLogo src={x.homeLogo} alt={x.homeName} className="size-9" />
                      <div className="min-w-0">
                        <p className="truncate text-xs font-bold text-slate-200">
                          {x.homeName} <span className="text-slate-500">ضد</span> {x.awayName}
                        </p>
                        <p className="truncate text-[10px] text-slate-500">
                          {x.league ?? x.competition ?? "مباراة اليوم"}
                        </p>
                      </div>
                    </div>
                    {x.status === "live" ? (
                      <span className="flex shrink-0 items-center gap-1.5 text-[11px] font-bold text-red-300">
                        <span className="live-dot size-1.5 rounded-full bg-red-500" />
                        {x.homeScore ?? 0}-{x.awayScore ?? 0}
                      </span>
                    ) : (
                      <span className="tabular shrink-0 text-xs font-bold text-slate-300">
                        {formatClock(x.startTime)}
                      </span>
                    )}
                  </Link>
                ))}
              </div>
            )}
          </div>

          <div className="glass rounded-3xl p-5 text-center">
            <p className="text-2xl">🎯</p>
            <h4 className="mt-2 text-sm font-bold text-white">جودة عالية بدون تقطيع</h4>
            <p className="mt-1.5 text-xs leading-5 text-slate-400">
              إذا توقف البث اضغط زر التحديث أو جرّب فتح المشغل في نافذة جديدة.
            </p>
          </div>
        </aside>
      </div>
    </main>
  );
}
