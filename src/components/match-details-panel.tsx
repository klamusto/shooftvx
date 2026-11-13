"use client";

import { useState } from "react";
import type { MatchDetails } from "@/lib/types";
import { formatClock } from "@/lib/format";

type Tab = "details" | "lineups" | "stats" | "standings";

export function MatchDetailsPanel({ details }: { details: MatchDetails | null }) {
  const [tab, setTab] = useState<Tab>("details");

  const tabs: { key: Tab; label: string; icon: string }[] = [
    { key: "details", label: "تفاصيل المباراة", icon: "📋" },
    { key: "lineups", label: "التشكيلة", icon: "🧑‍🤝‍🧑" },
    { key: "stats", label: "الإحصائيات", icon: "📊" },
    { key: "standings", label: "الترتيب", icon: "🏆" },
  ];

  if (!details) {
    return (
      <section className="glass animate-rise rounded-3xl p-8 text-center">
        <p className="text-3xl">🛰️</p>
        <h3 className="mt-3 text-base font-bold text-white">معلومات المباراة</h3>
        <p className="mt-1.5 text-sm text-slate-400">
          يتم تحميل تفاصيل المباراة (التشكيلة، الإحصائيات، الترتيب)…
        </p>
      </section>
    );
  }

  const hasInfo =
    details.venue || details.referee || details.kickoff || details.roundName || details.competition;
  const hasLineups = Boolean(details.home?.players.length || details.away?.players.length);
  const hasStats = details.stats.length > 0;
  const hasStandings = details.standings.length > 0;

  return (
    <section className="glass animate-rise overflow-hidden rounded-3xl">
      {/* Tabs */}
      <div className="flex flex-wrap items-center gap-1 border-b border-white/6 bg-white/2 px-3 py-2.5">
        {tabs.map((t) => {
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`flex items-center gap-1.5 rounded-full px-4 py-2 text-xs font-bold transition-all duration-200 sm:text-sm ${
                active
                  ? "bg-gradient-to-l from-emerald-500 to-emerald-600 text-ink-950 shadow-[0_4px_18px_rgba(16,185,129,0.35)]"
                  : "text-slate-400 hover:bg-white/5 hover:text-white"
              }`}
            >
              <span className="text-sm">{t.icon}</span>
              {t.label}
            </button>
          );
        })}
      </div>

      <div className="p-5 sm:p-6">
        {/* ---- Details ---- */}
        {tab === "details" && (
          <div className="animate-rise grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {details.competition && (
              <InfoTile icon="🏟️" label="المسابقة" value={details.competition} />
            )}
            {details.roundName && (
              <InfoTile icon="🔢" label="الجولة" value={`${details.roundName}`} />
            )}
            {details.kickoff && (
              <InfoTile icon="🕐" label="موعد البداية" value={formatClock(details.kickoff)} />
            )}
            {details.venue && <InfoTile icon="📍" label="الملعب" value={details.venue} />}
            {details.referee && <InfoTile icon="🟨" label="الحكم" value={details.referee} />}
            {details.home?.formation && (
              <InfoTile icon="⚽" label="تشكيلة صاحب الأرض" value={details.home.formation} />
            )}
            {details.away?.formation && (
              <InfoTile icon="⚽" label="تشكيلة الضيف" value={details.away.formation} />
            )}
            {!hasInfo && (
              <p className="col-span-full py-8 text-center text-sm text-slate-400">
                لا توجد تفاصيل متاحة لهذه المباراة بعد.
              </p>
            )}
          </div>
        )}

        {/* ---- Lineups ---- */}
        {tab === "lineups" && (
          hasLineups ? (
            <div className="animate-rise grid gap-5 md:grid-cols-2">
              <LineupColumn title="التشكيلة الأساسية" side="home" lineup={details.home} />
              <LineupColumn title="التشكيلة الأساسية" side="away" lineup={details.away} />
            </div>
          ) : (
            <EmptyTab text="التشكيلة غير متوفرة لهذه المباراة بعد." />
          )
        )}

        {/* ---- Stats ---- */}
        {tab === "stats" && (
          hasStats ? (
            <div className="animate-rise space-y-4">
              {details.stats.map((s) => (
                <div key={s.name} className="flex items-center gap-3">
                  <span className="tabular w-14 shrink-0 text-left text-sm font-bold text-slate-200" dir="ltr">
                    {s.home}
                  </span>
                  <div className="relative h-2 flex-1 overflow-hidden rounded-full bg-white/6" dir="ltr">
                    <div
                      className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-emerald-500 to-emerald-400 transition-all duration-700"
                      style={{ width: `${Math.min(100, Math.round(s.homePct * 100))}%` }}
                    />
                  </div>
                  <span className="text-center text-xs font-bold text-slate-400">{s.name}</span>
                  <div className="relative h-2 flex-1 overflow-hidden rounded-full bg-white/6" dir="ltr">
                    <div
                      className="absolute inset-y-0 right-0 rounded-full bg-gradient-to-l from-cyan-500 to-cyan-400 transition-all duration-700"
                      style={{ width: `${Math.min(100, Math.round(s.awayPct * 100))}%` }}
                    />
                  </div>
                  <span className="tabular w-14 shrink-0 text-right text-sm font-bold text-slate-200">
                    {s.away}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <EmptyTab text="الإحصائيات غير متوفرة لهذه المباراة." />
          )
        )}

        {/* ---- Standings ---- */}
        {tab === "standings" && (
          hasStandings ? (
            <div className="animate-rise overflow-x-auto">
              <table className="w-full min-w-[560px] text-sm">
                <thead>
                  <tr className="border-b border-white/8 text-[11px] text-slate-500">
                    <th className="px-2 py-2.5 text-right font-bold">#</th>
                    <th className="px-2 py-2.5 text-right font-bold">الفريق</th>
                    <th className="px-2 py-2.5 text-center font-bold">لعب</th>
                    <th className="px-2 py-2.5 text-center font-bold">فاز</th>
                    <th className="px-2 py-2.5 text-center font-bold">تعادل</th>
                    <th className="px-2 py-2.5 text-center font-bold">خسر</th>
                    <th className="px-2 py-2.5 text-center font-bold">له</th>
                    <th className="px-2 py-2.5 text-center font-bold">عليه</th>
                    <th className="px-2 py-2.5 text-center font-bold text-emerald-300">نقاط</th>
                  </tr>
                </thead>
                <tbody>
                  {details.standings.map((r) => (
                    <tr
                      key={`${r.position}-${r.name}`}
                      className={`border-b border-white/4 transition-colors ${
                        r.isMatchTeam
                          ? "bg-emerald-500/10 font-bold text-emerald-200"
                          : "text-slate-300 hover:bg-white/3"
                      }`}
                    >
                      <td className="px-2 py-2.5 tabular">{r.position}</td>
                      <td className="px-2 py-2.5 font-bold">
                        {r.name}
                        {r.isMatchTeam && (
                          <span className="mr-2 rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] text-emerald-300">
                            المباراة
                          </span>
                        )}
                      </td>
                      <td className="px-2 py-2.5 text-center tabular">{r.played}</td>
                      <td className="px-2 py-2.5 text-center tabular">{r.won}</td>
                      <td className="px-2 py-2.5 text-center tabular">{r.drawn}</td>
                      <td className="px-2 py-2.5 text-center tabular">{r.lost}</td>
                      <td className="px-2 py-2.5 text-center tabular">{r.gf}</td>
                      <td className="px-2 py-2.5 text-center tabular">{r.ga}</td>
                      <td className="px-2 py-2.5 text-center tabular font-bold text-emerald-300">
                        {r.points}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyTab text="جدول الترتيب غير متوفر لهذه المسابقة." />
          )
        )}
      </div>
    </section>
  );
}

function InfoTile({ icon, label, value }: { icon: string; label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/6 bg-white/3 p-4 transition-colors hover:border-emerald-400/25">
      <p className="flex items-center gap-2 text-[11px] font-bold text-slate-500">
        <span>{icon}</span>
        {label}
      </p>
      <p className="mt-1.5 text-sm font-bold text-white">{value}</p>
    </div>
  );
}

function LineupColumn({
  title,
  side,
  lineup,
}: {
  title: string;
  side: "home" | "away";
  lineup: MatchDetails["home"];
}) {
  if (!lineup || lineup.players.length === 0) {
    return (
      <div className="rounded-2xl border border-white/6 bg-white/2 p-5">
        <p className="mb-3 text-sm font-bold text-slate-300">{title}</p>
        <p className="text-xs text-slate-500">التشكيلة غير معلنة بعد.</p>
      </div>
    );
  }
  return (
    <div className="rounded-2xl border border-white/6 bg-white/2 p-5">
      <div className="mb-3 flex items-center justify-between gap-2">
        <p className="text-sm font-bold text-slate-200">{title}</p>
        {lineup.formation && (
          <span className="rounded-full bg-emerald-500/15 px-3 py-1 text-[11px] font-bold text-emerald-300">
            {lineup.formation}
          </span>
        )}
      </div>
      <ul className="space-y-2">
        {lineup.players.map((p, i) => (
          <li
            key={`${side}-${i}-${p.name}`}
            className="flex items-center gap-2.5 rounded-xl bg-white/3 px-3 py-2"
          >
            <span className="tabular grid size-7 shrink-0 place-items-center rounded-lg bg-white/6 text-[11px] font-bold text-slate-300">
              {p.number ?? "•"}
            </span>
            <span className="min-w-0 flex-1 truncate text-[13px] font-bold text-slate-100">
              {p.name}
            </span>
            {p.goals != null && p.goals > 0 && (
              <span className="text-[11px] font-bold text-amber-300">⚽ {p.goals}</span>
            )}
            {p.yellow > 0 && <span className="inline-block h-3 w-2 rounded-[2px] bg-yellow-400" />}
            {p.red > 0 && <span className="inline-block h-3 w-2 rounded-[2px] bg-red-500" />}
            <span className="hidden w-20 truncate text-left text-[10px] text-slate-500 sm:block">
              {p.position}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function EmptyTab({ text }: { text: string }) {
  return (
    <div className="animate-rise py-10 text-center">
      <p className="text-3xl">📭</p>
      <p className="mt-2 text-sm text-slate-400">{text}</p>
    </div>
  );
}
