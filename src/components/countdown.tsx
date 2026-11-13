"use client";

import { useEffect, useState } from "react";

function pad(n: number) {
  return String(n).padStart(2, "0");
}

export function Countdown({ target }: { target: string }) {
  const [left, setLeft] = useState<number>(() => Date.parse(target) - Date.now());

  useEffect(() => {
    const t = setInterval(() => {
      setLeft(Date.parse(target) - Date.now());
    }, 1000);
    return () => clearInterval(t);
  }, [target]);

  if (left <= 0) {
    return (
      <span className="tabular inline-flex items-center gap-1.5 text-[11px] font-bold text-red-300">
        <span className="live-dot size-1.5 rounded-full bg-red-500" />
        ستبدأ الآن
      </span>
    );
  }

  const h = Math.floor(left / 3_600_000);
  const m = Math.floor((left % 3_600_000) / 60_000);
  const s = Math.floor((left % 60_000) / 1000);

  return (
    <span className="tabular inline-flex items-center gap-1.5 text-[11px] font-bold text-amber-300">
      <svg viewBox="0 0 24 24" className="size-3 fill-none stroke-current" strokeWidth="2.4" strokeLinecap="round">
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </svg>
      تبدأ بعد {pad(h)}:{pad(m)}:{pad(s)}
    </span>
  );
}
