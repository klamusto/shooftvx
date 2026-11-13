"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { MatchesResponse, MatchView } from "@/lib/types";
import { formatArabicDate, timeAgo } from "@/lib/format";
import { MatchCard, MatchCardSkeleton } from "@/components/match-card";

type Filter = "all" | "live" | "upcoming" | "finished";

const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "الكل" },
  { key: "live", label: "مباشر الآن" },
  { key: "upcoming", label: "قادمة" },
  { key: "finished", label: "انتهت" },
];

const DAY_OFFSETS: { offset: number; label: string }[] = [
  { offset: -1, label: "أمس" },
  { offset: 0, label: "اليوم" },
  { offset: 1, label: "غداً" },
];

const POLL_MS = 45_000;

function dayISO(offset: number): string {
  return new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
}

export function MatchesExplorer() {
  const [data, setData] = useState<MatchesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [auto, setAuto] = useState(true);
  const [dayOffset, setDayOffset] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const busyRef = useRef(false);

  const load = useCallback(async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setRefreshing(true);
    try {
      const qs = dayOffset !== 0 ? `?date=${dayISO(dayOffset)}` : "";
      const res = await fetch(`/api/matches${qs}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as MatchesResponse;
      setData(json);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "تعذر جلب المباريات");
    } finally {
      busyRef.current = false;
      setLoading(false);
      setRefreshing(false);
    }
  }, [dayOffset]);

  const refresh = useCallback(() => {
    load();
  }, [load]);

  // Initial load + polling (paused while tab hidden, smarter + lighter).
  useEffect(() => {
    let ignore = false;
    const fetchMatches = async (isRefresh = false) => {
      if (busyRef.current) return;
      busyRef.current = true;
      if (isRefresh) setRefreshing(true);
      try {
        const qs = dayOffset !== 0 ? `?date=${dayISO(dayOffset)}` : "";
        const res = await fetch(`/api/matches${qs}`, { cache: "no-store" });
        if (ignore) return;
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as MatchesResponse;
        if (ignore) return;
        setData(json);
        setError(null);
      } catch (err) {
        if (ignore) return;
        setError(err instanceof Error ? err.message : "تعذر جلب المباريات");
      } finally {
        if (!ignore) {
          busyRef.current = false;
          setLoading(false);
          setRefreshing(false);
        }
      }
    };

    fetchMatches(false);
    const startTimer = () => {
      if (timerRef.current) return;
      timerRef.current = setInterval(() => {
        if (document.visibilityState === "visible" && auto) fetchMatches(true);
      }, POLL_MS);
    };
    const stopTimer = () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        startTimer();
        if (auto) fetchMatches(true);
      } else {
        stopTimer();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    if (auto) startTimer();
    return () => {
      ignore = true;
      stopTimer();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [auto, dayOffset]);

  const counts = data?.counts ?? { all: 0, live: 0, upcoming: 0, finished: 0 };

  const filtered = useMemo(() => {
    if (!data) return [];
    let list = data.matches;
    if (filter !== "all") list = list.filter((m) => m.status === filter);
    const q = query.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (m) =>
          m.homeName.toLowerCase().includes(q) ||
          m.awayName.toLowerCase().includes(q) ||
          (m.league ?? "").toLowerCase().includes(q) ||
          (m.competition ?? "").toLowerCase().includes(q),
      );
    }
    return list;
  }, [data, filter, query]);

  const liveMatches = useMemo(
    () => data?.matches.filter((m) => m.status === "live") ?? [],
    [data],
  );

  return (
    <section id="matches" className="mx-auto w-full max-w-7xl scroll-mt-24 px-4 sm:px-6">
      {/* Live ticker */}
      {liveMatches.length > 0 && (
        <div className="glass mb-6 flex items-center gap-3 overflow-hidden rounded-2xl py-2.5">
          <span className="flex shrink-0 items-center gap-1.5 ps-4 text-xs font-bold text-red-300">
            <span className="live-dot size-2 rounded-full bg-red-500 shadow-[0_0_10px_rgba(239,68,68,1)]" />
            مباشر
          </span>
          <div className="relative flex-1 overflow-hidden" dir="ltr">
            <div className="ticker-track flex w-max items-center gap-8">
              {[...liveMatches, ...liveMatches].map((m, i) => (
                <Link
                  key={`${m.id}-${i}`}
                  href={`/watch/${m.id}`}
                  className="flex items-center gap-2 whitespace-nowrap text-xs font-semibold text-slate-200 hover:text-emerald-300"
                  dir="rtl"
                >
                  <span>{m.homeName}</span>
                  <span className="tabular rounded-md bg-white/8 px-1.5 py-0.5 font-display font-bold text-white">
                    {m.homeScore ?? 0} - {m.awayScore ?? 0}
                  </span>
                  <span>{m.awayName}</span>
                  {m.gameTime && <span className="tabular text-red-300">{m.gameTime}</span>}
                </Link>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Controls */}
      <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-col items-start gap-2.5 sm:flex-row sm:items-center">
          {/* Day switcher */}
          <div className="glass flex items-center gap-1 rounded-full p-1">
            {DAY_OFFSETS.map((d) => {
              const active = dayOffset === d.offset;
              return (
                <button
                  key={d.offset}
                  onClick={() => setDayOffset(d.offset)}
                  className={`rounded-full px-4 py-1.5 text-xs font-bold transition-all duration-200 ${
                    active
                      ? "bg-gradient-to-l from-emerald-500 to-cyan-500 text-ink-950 shadow-[0_4px_18px_rgba(16,185,129,0.35)]"
                      : "text-slate-400 hover:text-white"
                  }`}
                >
                  {d.label}
                </button>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center gap-2">
          {FILTERS.map((f) => {
            const active = filter === f.key;
            const n =
              f.key === "all"
                ? counts.all
                : f.key === "live"
                  ? counts.live
                  : f.key === "upcoming"
                    ? counts.upcoming
                    : counts.finished;
            return (
              <button
                key={f.key}
                onClick={() => setFilter(f.key)}
                className={`relative flex items-center gap-2 rounded-full px-4 py-2 text-sm font-bold transition-all duration-200 ${
                  active
                    ? "bg-gradient-to-l from-emerald-500 to-emerald-600 text-ink-950 shadow-[0_6px_24px_rgba(16,185,129,0.35)]"
                    : "glass text-slate-300 hover:border-white/20 hover:text-white"
                }`}
              >
                {f.key === "live" && n > 0 && (
                  <span className="live-dot size-1.5 rounded-full bg-red-500" />
                )}
                {f.label}
                <span
                  className={`tabular rounded-full px-1.5 text-[11px] ${
                    active ? "bg-ink-950/20" : "bg-white/8"
                  }`}
                >
                  {n}
                </span>
              </button>
            );
          })}
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          <div className="relative flex-1 lg:w-64">
            <svg
              viewBox="0 0 24 24"
              className="pointer-events-none absolute right-3.5 top-1/2 size-4 -translate-y-1/2 fill-none stroke-slate-400"
              strokeWidth="2.2"
              strokeLinecap="round"
            >
              <circle cx="11" cy="11" r="7" />
              <path d="m21 21-4.3-4.3" />
            </svg>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="ابحث عن فريق أو دوري…"
              className="w-full rounded-full border border-white/8 bg-white/4 py-2.5 pe-4 ps-10 text-sm text-white placeholder:text-slate-500 outline-none transition-all focus:border-emerald-400/50 focus:bg-white/6 focus:shadow-[0_0_0_3px_rgba(16,185,129,0.12)]"
            />
          </div>

          <button
            onClick={() => setAuto((v) => !v)}
            title="تحديث تلقائي"
            className={`glass rounded-full px-3 py-2.5 text-[11px] font-bold transition-all ${
              auto ? "text-emerald-300" : "text-slate-500"
            }`}
          >
            {auto ? "تلقائي ✓" : "يدوي"}
          </button>

          <button
            onClick={refresh}
            disabled={refreshing || loading}
            className="glass flex items-center gap-2 rounded-full px-4 py-2.5 text-sm font-bold text-white transition-all hover:border-emerald-400/40 hover:text-emerald-300 disabled:opacity-60"
          >
            <svg
              viewBox="0 0 24 24"
              className={`size-4 fill-none stroke-current ${refreshing ? "animate-spin" : ""}`}
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M21 12a9 9 0 1 1-2.64-6.36" />
              <path d="M21 3v6h-6" />
            </svg>
            تحديث
          </button>
        </div>
      </div>

      {/* Meta line */}
      {data && (
        <p className="mb-5 flex items-center gap-2 text-xs text-slate-500">
          <span className="inline-block size-1.5 rounded-full bg-emerald-400" />
          {formatArabicDate(new Date())} · {counts.all} مباراة
          <span className="text-slate-700">·</span>
          آخر تحديث {timeAgo(data.generatedAt)}
          {data.syncError && <span className="text-amber-400/80">(تعذر تحديث المصدر — عرض المخزن مؤقتاً)</span>}
        </p>
      )}

      {/* Content */}
      {loading && !data ? (
        <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <MatchCardSkeleton key={i} />
          ))}
        </div>
      ) : error && !data ? (
        <div className="glass mx-auto flex max-w-lg flex-col items-center gap-4 rounded-3xl p-10 text-center">
          <span className="grid size-16 place-items-center rounded-2xl bg-red-500/10 text-3xl">📡</span>
          <h3 className="text-lg font-bold text-white">تعذر الاتصال بالمصدر</h3>
          <p className="text-sm leading-6 text-slate-400">
            لم نتمكن من جلب المباريات الآن. تأكد من الاتصال وحاول مجدداً.
            <br />
            <span className="text-xs text-slate-500">افتح <a href="/api/status" target="_blank" rel="noreferrer" className="text-emerald-400 underline">/api/status</a> لتشخيص المشكلة.</span>
          </p>
          <button
            onClick={refresh}
            className="rounded-full bg-gradient-to-l from-emerald-500 to-cyan-500 px-6 py-2.5 text-sm font-bold text-ink-950 transition-transform hover:scale-105"
          >
            إعادة المحاولة
          </button>
        </div>
      ) : filtered.length === 0 ? (
        <div className="glass mx-auto flex max-w-lg flex-col items-center gap-4 rounded-3xl p-10 text-center">
          <span className="grid size-16 place-items-center rounded-2xl bg-white/5 text-3xl">⚽</span>
          <h3 className="text-lg font-bold text-white">لا توجد مباريات هنا</h3>
          <p className="text-sm text-slate-400">
            {query
              ? "لم نجد نتائج مطابقة لبحثك."
              : filter === "live"
                ? "لا توجد مباريات مباشرة الآن — عد لاحقاً."
                : dayOffset === 0
                  ? "لم تظهر مباريات في هذا التصنيف بعد."
                  : "لا توجد مباريات في هذا اليوم."}
          </p>
        </div>
      ) : (
        <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map((m: MatchView, i: number) => (
            <MatchCard key={m.id} match={m} index={i} />
          ))}
        </div>
      )}
    </section>
  );
}
