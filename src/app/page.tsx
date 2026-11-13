import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { MatchesExplorer } from "@/components/matches-explorer";
import { formatArabicDate } from "@/lib/format";
import { broadcastDayOf, listMatchesByDay } from "@/lib/source";

export const dynamic = "force-dynamic";

async function todayCounts(): Promise<{ live: number; total: number }> {
  try {
    const rows = await listMatchesByDay(broadcastDayOf());
    return {
      live: rows.filter((r) => r.live).length,
      total: rows.length,
    };
  } catch {
    return { live: 0, total: 0 };
  }
}

async function Hero() {
  const counts = await todayCounts();
  return (
    <section className="relative overflow-hidden pt-16">
      {/* Ambient orbs */}
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute -top-24 left-[8%] size-[30rem] animate-float rounded-full bg-emerald-500/14 blur-[120px]" />
        <div className="absolute top-10 right-[6%] size-[26rem] animate-float-slow rounded-full bg-cyan-500/10 blur-[110px]" />
        <div className="absolute bottom-0 left-1/2 size-[22rem] -translate-x-1/2 rounded-full bg-indigo-500/10 blur-[120px]" />
        <div className="absolute inset-0 field-grid" />
      </div>

      <div className="mx-auto flex max-w-7xl flex-col items-center px-4 pb-12 pt-14 text-center sm:px-6 sm:pt-20">
        <span className="animate-rise glass mb-6 flex items-center gap-2 rounded-full px-4 py-2 text-xs font-bold text-emerald-300">
          <svg viewBox="0 0 24 24" className="size-3.5 fill-current">
            <path d="M13 2 3 14h7l-1 8 10-12h-7l1-8z" />
          </svg>
          {formatArabicDate(new Date())} · تحديث تلقائي للمباريات والنتائج
        </span>

        <h1
          className="animate-rise font-display text-4xl font-bold leading-[1.25] text-white sm:text-6xl sm:leading-[1.2]"
          style={{ animationDelay: "80ms" }}
        >
          شاهد مباريات اليوم
          <br />
          <span className="text-gradient">بث مباشر بجودة عالية</span>
        </h1>

        <p
          className="animate-rise mt-5 max-w-2xl text-sm leading-7 text-slate-400 sm:text-base sm:leading-8"
          style={{ animationDelay: "160ms" }}
        >
          جميع مباريات اليوم في مكان واحد — اضغط على أي مباراة وابدأ المشاهدة فوراً.
          الجدول والنتائج والأهداف تتحدث لحظياً وبشكل تلقائي.
        </p>

        <div
          className="animate-rise mt-8 flex flex-wrap items-center justify-center gap-3"
          style={{ animationDelay: "240ms" }}
        >
          <a
            href="#matches"
            className="group flex items-center gap-2.5 rounded-full bg-gradient-to-l from-emerald-500 to-cyan-500 px-7 py-3.5 text-sm font-bold text-ink-950 shadow-[0_10px_40px_rgba(16,185,129,0.4)] transition-all duration-300 hover:scale-[1.04] hover:shadow-[0_14px_50px_rgba(16,185,129,0.55)]"
          >
            <svg viewBox="0 0 24 24" className="size-4.5 fill-current transition-transform group-hover:scale-110">
              <path d="M8 5.9c0-1.5 1.6-2.4 2.9-1.7l9 5.2c1.3.7 1.3 2.5 0 3.2l-9 5.2c-1.3.7-2.9-.2-2.9-1.7V5.9z" />
            </svg>
            تصفح المباريات
          </a>
          {counts.live > 0 ? (
            <a
              href="#matches"
              className="flex items-center gap-2.5 rounded-full border border-red-500/30 bg-red-500/10 px-6 py-3.5 text-sm font-bold text-red-300 transition-all hover:bg-red-500/15"
            >
              <span className="live-dot size-2.5 rounded-full bg-red-500 shadow-[0_0_12px_rgba(239,68,68,1)]" />
              {counts.live} مباشر الآن — شاهد فوراً
            </a>
          ) : (
            <span className="glass flex items-center gap-2.5 rounded-full px-6 py-3.5 text-sm font-bold text-slate-200">
              <span className="live-dot size-2.5 rounded-full bg-red-500 shadow-[0_0_12px_rgba(239,68,68,1)]" />
              النتائج تحدث مباشرة
            </span>
          )}
        </div>

        {/* Stats strip */}
        <div
          className="animate-rise mt-12 grid w-full max-w-3xl grid-cols-3 gap-3"
          style={{ animationDelay: "320ms" }}
        >
          {[
            { icon: "⚽", title: `${counts.total} مباراة اليوم`, sub: "جدول كامل ومحدّث" },
            { icon: "📺", title: "مشغل مدمج", sub: "بدون إعلانات مزعجة" },
            { icon: "⚡", title: "تحديث تلقائي", sub: "كل 45 ثانية" },
          ].map((s) => (
            <div
              key={s.title}
              className="glass rounded-2xl px-4 py-4 transition-all duration-300 hover:-translate-y-1 hover:border-emerald-400/25"
            >
              <p className="text-xl">{s.icon}</p>
              <p className="mt-1.5 text-sm font-bold text-white">{s.title}</p>
              <p className="mt-0.5 text-[11px] text-slate-500">{s.sub}</p>
            </div>
          ))}
        </div>
      </div>

      {/* divider */}
      <div className="pointer-events-none relative mx-auto h-10 max-w-7xl px-6">
        <div className="absolute inset-x-6 top-1/2 h-px bg-gradient-to-l from-transparent via-emerald-400/30 to-transparent" />
      </div>
    </section>
  );
}

export default async function HomePage() {
  const counts = await todayCounts();
  return (
    <main className="relative min-h-screen">
      <div className="pointer-events-none fixed inset-0 -z-10 bg-[radial-gradient(ellipse_80%_60%_at_50%_-10%,rgba(16,185,129,0.07),transparent)]" />
      <SiteHeader liveCount={counts.live} />
      <Hero />
      <div className="pb-10">
        <MatchesExplorer />
      </div>
      <SiteFooter />
    </main>
  );
}
