"use client";

import { useEffect, useState } from "react";

export function LiveClock() {
  const [now, setNow] = useState<Date | null>(() =>
    typeof window !== "undefined" ? new Date() : null,
  );

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const time = now
    ? new Intl.DateTimeFormat("ar", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: true,
      }).format(now)
    : "--:--:--";

  return (
    <span className="tabular hidden items-center gap-2 rounded-full border border-white/10 bg-white/4 px-3 py-2 text-xs font-bold text-slate-300 sm:flex" dir="ltr">
      <svg viewBox="0 0 24 24" className="size-3.5 fill-none stroke-emerald-400" strokeWidth="2.2" strokeLinecap="round">
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </svg>
      {time}
    </span>
  );
}
