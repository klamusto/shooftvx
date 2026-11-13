"use client";

import { useState } from "react";

const FALLBACK = `data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#334155"/><stop offset="1" stop-color="#1e293b"/></linearGradient></defs><circle cx="32" cy="32" r="30" fill="url(#g)" stroke="#475569" stroke-width="2"/><path d="M32 14l2.6 8.1h8.5l-6.9 5 2.7 8.1-6.9-5-6.9 5 2.7-8.1-6.9-5h8.5z" fill="#64748b"/></svg>`,
)}`;

export function TeamLogo({
  src,
  alt,
  className = "",
}: {
  src?: string | null;
  alt: string;
  className?: string;
}) {
  const [broken, setBroken] = useState(false);
  const useSrc = !broken && src ? src : FALLBACK;
  return (
    <span className={`relative inline-flex shrink-0 items-center justify-center rounded-full bg-ink-800 ring-1 ring-white/10 ${className}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={useSrc}
        alt={alt}
        loading="lazy"
        onError={() => setBroken(true)}
        className="size-full rounded-full object-contain p-[12%]"
      />
    </span>
  );
}
