import Link from "next/link";
import type { MatchView } from "@/lib/types";
import { formatClock } from "@/lib/format";
import { TeamLogo } from "@/components/team-logo";
import { Countdown } from "@/components/countdown";

export function StatusBadge({ match }: { match: MatchView }) {
  if (match.status === "live") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-red-500/30 bg-red-500/12 px-2.5 py-1 text-[11px] font-bold text-red-300">
        <span className="live-dot size-1.5 rounded-full bg-red-500 shadow-[0_0_8px_rgba(239,68,68,1)]" />
        {match.gameTime ? `مباشر · ${match.gameTime}` : "مباشر"}
      </span>
    );
  }
  if (match.status === "finished") {
    return (
      <span className="inline-flex items-center rounded-full border border-slate-500/25 bg-slate-500/10 px-2.5 py-1 text-[11px] font-bold text-slate-400">
        انتهت
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-400/25 bg-amber-400/10 px-2.5 py-1 text-[11px] font-bold text-amber-300">
      <span className="size-1.5 rounded-full bg-amber-400" />
      {match.statusLabel ?? "قادمة"}
    </span>
  );
}

export function ScorersRow({
  homeScorers,
  awayScorers,
}: {
  homeScorers: string[];
  awayScorers: string[];
}) {
  if (homeScorers.length === 0 && awayScorers.length === 0) return null;
  return (
    <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-center text-[10px] leading-4 text-slate-400 sm:text-[11px]">
      <div className="min-w-0 space-y-0.5">
        {homeScorers.slice(0, 4).map((s, i) => (
          <p key={i} className="truncate">
            ⚽ {s}
          </p>
        ))}
      </div>
      <div className="min-w-0 space-y-0.5">
        {awayScorers.slice(0, 4).map((s, i) => (
          <p key={i} className="truncate">
            ⚽ {s}
          </p>
        ))}
      </div>
    </div>
  );
}

export function MatchCard({ match, index = 0 }: { match: MatchView; index?: number }) {
  const live = match.status === "live";
  const hasScore =
    typeof match.homeScore === "number" && typeof match.awayScore === "number";

  return (
    <Link
      href={`/watch/${match.id}`}
      style={{ animationDelay: `${Math.min(index, 8) * 60}ms` }}
      className={`group relative flex flex-col overflow-hidden rounded-3xl p-5 transition-all duration-300 animate-rise hover:-translate-y-1.5 ${
        live
          ? "glass border-red-500/25 shadow-[0_0_45px_rgba(239,68,68,0.10)] hover:shadow-[0_18px_60px_rgba(239,68,68,0.22)]"
          : "glass hover:border-emerald-400/25 hover:shadow-[0_18px_60px_rgba(16,185,129,0.16)]"
      }`}
    >
      {/* hover glow */}
      <span className="pointer-events-none absolute -top-20 left-1/2 size-48 -translate-x-1/2 rounded-full bg-emerald-400/12 opacity-0 blur-3xl transition-opacity duration-500 group-hover:opacity-100" />

      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-[11px] font-semibold text-slate-400">
          {match.competition ?? match.league ?? "مباراة اليوم"}
        </span>
        <StatusBadge match={match} />
      </div>

      <div className="mt-4 grid grid-cols-[1fr_auto_1fr] items-center gap-2">
        {/* home */}
        <div className="flex min-w-0 flex-col items-center gap-2.5">
          <TeamLogo
            src={match.homeLogo}
            alt={match.homeName}
            className="size-14 transition-transform duration-300 group-hover:scale-110 sm:size-16"
          />
          <p className="w-full truncate text-center text-[13px] font-bold text-slate-100 sm:text-sm">
            {match.homeName}
          </p>
        </div>

        {/* center */}
        <div className="flex flex-col items-center gap-1 px-1">
          {live && hasScore ? (
            <>
              <span className="tabular font-display text-3xl font-bold tracking-wider text-white sm:text-4xl">
                {match.homeScore}
                <span className="mx-1.5 text-slate-500">-</span>
                {match.awayScore}
              </span>
              {match.gameTime && (
                <span className="tabular text-[11px] font-bold text-red-300">
                  {match.gameTime}
                </span>
              )}
            </>
          ) : match.status === "finished" && hasScore ? (
            <span className="tabular font-display text-3xl font-bold tracking-wider text-slate-200 sm:text-4xl">
              {match.homeScore}
              <span className="mx-1.5 text-slate-600">-</span>
              {match.awayScore}
            </span>
          ) : (
            <span className="flex flex-col items-center gap-1">
              <span className="tabular font-display text-2xl font-bold text-white sm:text-3xl">
                {formatClock(match.startTime)}
              </span>
              <Countdown target={match.startTime} />
            </span>
          )}
        </div>

        {/* away */}
        <div className="flex min-w-0 flex-col items-center gap-2.5">
          <TeamLogo
            src={match.awayLogo}
            alt={match.awayName}
            className="size-14 transition-transform duration-300 group-hover:scale-110 sm:size-16"
          />
          <p className="w-full truncate text-center text-[13px] font-bold text-slate-100 sm:text-sm">
            {match.awayName}
          </p>
        </div>
      </div>

      {hasScore && (match.status === "live" || match.status === "finished") && (
        <ScorersRow
          homeScorers={match.homeScorers ?? []}
          awayScorers={match.awayScorers ?? []}
        />
      )}

      <div className="mt-5 flex items-center justify-center gap-2 border-t border-white/6 pt-3.5">
        {live ? (
          <span className="text-xs font-bold text-red-300">▶ اضغط للمشاهدة المباشرة</span>
        ) : (
          <span className="text-xs font-semibold text-slate-400 transition-colors group-hover:text-emerald-300">
            اضغط لمشاهدة المباراة
          </span>
        )}
        <svg
          viewBox="0 0 24 24"
          className="size-4 fill-none stroke-current text-slate-500 transition-all duration-300 group-hover:-translate-x-0.5 group-hover:text-emerald-300"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M19 12H5" />
          <path d="m12 19-7-7 7-7" />
        </svg>
      </div>
    </Link>
  );
}

export function MatchCardSkeleton() {
  return (
    <div className="glass flex flex-col gap-4 rounded-3xl p-5">
      <div className="flex items-center justify-between">
        <div className="shimmer h-3.5 w-24 rounded-full" />
        <div className="shimmer h-5 w-16 rounded-full" />
      </div>
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
        <div className="flex flex-col items-center gap-2.5">
          <div className="shimmer size-14 rounded-full sm:size-16" />
          <div className="shimmer h-3 w-16 rounded-full" />
        </div>
        <div className="shimmer h-8 w-16 rounded-xl" />
        <div className="flex flex-col items-center gap-2.5">
          <div className="shimmer size-14 rounded-full sm:size-16" />
          <div className="shimmer h-3 w-16 rounded-full" />
        </div>
      </div>
      <div className="shimmer h-3.5 w-full rounded-full" />
    </div>
  );
}
