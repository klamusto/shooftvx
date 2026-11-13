import { TELEGRAM_URL } from "@/lib/site";

export function TelegramButton({
  compact = false,
  className = "",
}: {
  compact?: boolean;
  className?: string;
}) {
  return (
    <a
      href={TELEGRAM_URL}
      target="_blank"
      rel="noreferrer noopener"
      aria-label="قناة شوف تيفي على التلغرام"
      className={`group inline-flex items-center gap-2 rounded-full bg-gradient-to-l from-sky-500 to-cyan-400 font-bold text-ink-950 shadow-[0_8px_28px_rgba(56,189,248,0.35)] transition-all duration-300 hover:scale-[1.04] hover:shadow-[0_10px_36px_rgba(56,189,248,0.5)] ${
        compact ? "px-3 py-2 text-xs" : "px-5 py-2.5 text-sm"
      } ${className}`}
    >
      <svg viewBox="0 0 24 24" className="size-4 fill-current transition-transform duration-300 group-hover:-rotate-12">
        <path d="M21.9 4.6c.3-1.2-.9-2.2-2-1.7L2.7 9.9c-1.2.5-1.1 2.2.1 2.6l4.4 1.4 1.7 5.4c.3 1 1.5 1.4 2.3.7l2.5-2.2 4.4 3.2c.9.6 2.1.2 2.4-.8l3.4-15.6zM8.4 13.2l8.8-5.6c.3-.2.6.2.4.4l-7 6.9c-.3.3-.5.7-.6 1.1l-.4 2.4c-.1.5-.8.5-.9 0l-.8-3.6c-.1-.6.2-1.2.7-1.6z" />
      </svg>
      {compact ? "تلغرام" : "قناة التلغرام"}
    </a>
  );
}
