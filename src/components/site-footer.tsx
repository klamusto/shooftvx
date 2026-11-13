import { Logo } from "@/components/logo";
import { TelegramButton } from "@/components/telegram-button";
import { TELEGRAM_URL } from "@/lib/site";

export function SiteFooter() {
  return (
    <footer className="relative mt-20 border-t border-white/6">
      <div className="pointer-events-none absolute inset-x-0 -top-px mx-auto h-px w-2/3 bg-gradient-to-l from-transparent via-emerald-400/40 to-transparent" />
      <div className="mx-auto flex max-w-7xl flex-col items-center gap-6 px-6 py-12 text-center">
        <Logo />
        <p className="max-w-xl text-sm leading-7 text-slate-400">
          شوف تيفي Shoof TV — وجهتك لمشاهدة مباريات اليوم بث مباشر بجودة عالية.
          يتم تحديث الجدول والنتائج تلقائياً من المصادر المباشرة.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-3">
          <TelegramButton />
          <a
            href={TELEGRAM_URL}
            target="_blank"
            rel="noreferrer noopener"
            className="glass rounded-full px-5 py-2.5 text-sm font-bold text-slate-300 transition-all hover:border-sky-400/40 hover:text-sky-300"
          >
            ✈️ تابعنا على التلغرام
          </a>
        </div>
        <p className="text-xs text-slate-600">
          جميع الحقوق محفوظة © {new Date().getFullYear()} شوف تيفي — Shoof TV
        </p>
      </div>
    </footer>
  );
}
