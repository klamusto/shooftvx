import Link from "next/link";

export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <Link href="/" className="group inline-flex items-center gap-3" aria-label="شوف تيفي — الصفحة الرئيسية">
      <span className="relative grid size-11 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-emerald-400 via-emerald-500 to-cyan-400 shadow-[0_8px_28px_rgba(16,185,129,0.35)] transition-transform duration-300 group-hover:scale-105 group-hover:rotate-3">
        <svg viewBox="0 0 24 24" className="size-6 fill-ink-950">
          <path d="M8 5.9c0-1.5 1.6-2.4 2.9-1.7l9 5.2c1.3.7 1.3 2.5 0 3.2l-9 5.2c-1.3.7-2.9-.2-2.9-1.7V5.9z" />
        </svg>
        <span className="absolute -inset-1 -z-10 rounded-2xl bg-emerald-400/40 blur-lg opacity-60 transition-opacity group-hover:opacity-100" />
      </span>
      {!compact && (
        <span className="flex flex-col leading-none">
          <span className="font-display text-2xl font-bold tracking-tight text-white">
            شوف <span className="text-gradient">تيفي</span>
          </span>
          <span className="mt-1 text-[11px] font-semibold tracking-[0.3em] text-slate-400">
            SHOOF TV
          </span>
        </span>
      )}
    </Link>
  );
}
