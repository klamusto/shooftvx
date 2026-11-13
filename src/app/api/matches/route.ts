import {
  broadcastDayOf,
  getMatchHistory,
  listMatchesByDay,
  rowToView,
  shouldSync,
  SOURCE_LABEL,
  syncMatches,
} from "@/lib/source";
import type { MatchesResponse } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// Vercel Hobby caps serverless functions at 60s — give the scraper room
// to pull the source + enrich live matches without timing out.
export const maxDuration = 60;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const dateParam = url.searchParams.get("date");
  const force = url.searchParams.get("refresh") === "1";

  let syncError: string | null = null;

  if (force || shouldSync()) {
    try {
      await syncMatches();
    } catch (err) {
      syncError = err instanceof Error ? err.message : "sync failed";
    }
  }

  // The match day rolls over at 03:00 UTC so late-night games (anything
  // after midnight Arab time) stay on "today's" list instead of jumping
  // to tomorrow when the UTC date flips.
  const today = broadcastDayOf();
  const validDate = /^\d{4}-\d{2}-\d{2}$/.test(dateParam ?? "");
  const targetDate = validDate ? (dateParam as string) : today;

  let rows: Awaited<ReturnType<typeof listMatchesByDay>> = [];
  let dbError: string | null = null;
  try {
    rows = await listMatchesByDay(targetDate);
  } catch (err) {
    dbError = err instanceof Error ? err.message : "db read failed";
    rows = [];
  }

  // If the requested day has nothing (e.g. "yesterday" before any scrape ran,
  // or a brand-new DB), do one more force-sync then re-read. This covers the
  // cold-start case where the first request of the day found an empty table.
  if (rows.length === 0 && !syncError) {
    try {
      await syncMatches();
      rows = await listMatchesByDay(targetDate);
    } catch {
      // leave rows as-is
    }
  }

  // If the requested day has nothing (e.g. "yesterday" before any scrape ran),
  // gracefully fall back to whatever the DB knows.
  let usedDate = targetDate;
  if (rows.length === 0 && validDate) {
    try {
      rows = await listMatchesByDay(today);
      usedDate = today;
    } catch {
      rows = [];
    }
  }

  const matches = rows.map(rowToView);
  const counts = {
    all: matches.length,
    live: matches.filter((m) => m.status === "live").length,
    upcoming: matches.filter((m) => m.status === "upcoming").length,
    finished: matches.filter((m) => m.status === "finished").length,
  };

  let history: { date: string; count: number }[] = [];
  try {
    history = await getMatchHistory(7);
  } catch {
    history = [];
  }

  const body: MatchesResponse = {
    matches,
    generatedAt: new Date().toISOString(),
    source: SOURCE_LABEL,
    counts,
    history,
  };

  return Response.json(
    { ...body, usedDate, syncError, dbError },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}
