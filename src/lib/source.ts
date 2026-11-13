import { db } from "@/db";
import { matchesTable, type MatchRow, type NewMatchRow } from "@/db/schema";
import type {
  KooraGame,
  MatchDetails,
  MatchStatus,
  MatchView,
  ParsedMatch,
  StandingRow,
} from "@/lib/types";
import {
  broadcastDayOf,
  broadcastDayRange,
  buildWatchUrl,
  dedupeByKey,
  detectEndedState,
  extractFromSourcePage,
  extractIdAndPartnerFromUrl,
  extractPlayerSrc,
  fallbackPlayerSrc,
  flippedStatus,
  gameMatchesRow,
  isPlayerUrlValid,
  isRealMatchId,
  matchKey,
  normalizeName,
  parseSiirHtml,
  playerSrcMatchesId,
} from "@/lib/parse";
import { and, desc, eq, gte, lt, lte } from "drizzle-orm";

/* ------------------------------------------------------------------ */
/* Re-exports — the pure parsing/identity logic lives in @/lib/parse   */
/* so it can be tested standalone (scripts/test-fix.ts).               */
/* ------------------------------------------------------------------ */

export {
  broadcastDayOf,
  broadcastDayRange,
  buildWatchUrl,
  decodeEntities,
  dedupeByKey,
  detectEndedState,
  extractFromSourcePage,
  extractIdAndPartnerFromUrl,
  extractPlayerSrc,
  fallbackPlayerSrc,
  flippedStatus,
  gameMatchesRow,
  isPlayerUrlValid,
  isRealMatchId,
  matchKey,
  normalizeName,
  parseSiirHtml,
  playerSrcMatchesId,
} from "@/lib/parse";
export type { ParsedIdSource, ExtractedSourcePage } from "@/lib/parse";

/* ------------------------------------------------------------------ */
/* Constants                                                           */
/* ------------------------------------------------------------------ */

const SIir_URL = "https://tvsiir.co/";
const KOORA_BASE = "https://www.koora-l.live";
/** Same data koora-l proxies, used only to recover real match ids when
 * the source stops exposing its ?m= links (happens late at night). */
const SCORES_GAMES_URL = "https://webws.365scores.com/web/games/";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";

const MATCH_SCRAPE_TTL_MS = 45_000; // re-scrape the list at most every 45s
const PLAYER_CACHE_TTL_MS = 30 * 60_000; // valid player URLs cached 30 min
const PLAYER_ENDED_TTL_MS = 10 * 60_000; // "ended" verdicts re-checked every 10 min
const PLAYER_RETRY_TTL_MS = 75_000; // "no player yet" re-checked aggressively
const GAME_CACHE_TTL_MS = 30_000; // live game JSON cached 30s

/** Twin = a DB row for the same fixture (same teams, kickoff within this
 * window). 90 minutes absorbs small data-start drift between scrapes. */
const TWIN_KICKOFF_WINDOW_MS = 90 * 60_000;
const TWIN_LOOKBACK_MS = 36 * 60 * 60_000;

/* ------------------------------------------------------------------ */
/* Self-healing: create/patch the table if it is missing or old        */
/* ------------------------------------------------------------------ */

let dbReady = false;

export async function ensureDbReady(): Promise<void> {
  if (dbReady) return;
  await db.execute("select 1 from matches limit 1").catch(async () => {
    await db.execute(`
      CREATE TABLE IF NOT EXISTS matches (
        match_id BIGINT PRIMARY KEY,
        partner_id TEXT NOT NULL DEFAULT '87350',
        home_name TEXT NOT NULL,
        away_name TEXT NOT NULL,
        home_logo TEXT,
        away_logo TEXT,
        league TEXT,
        competition TEXT,
        round_name TEXT,
        start_time TIMESTAMPTZ NOT NULL,
        status TEXT NOT NULL DEFAULT 'upcoming',
        status_label TEXT,
        live BOOLEAN NOT NULL DEFAULT FALSE,
        home_score INT,
        away_score INT,
        game_time TEXT,
        source_url TEXT,
        watch_url TEXT,
        player_src TEXT,
        player_state TEXT,
        player_resolved_at TIMESTAMPTZ,
        game_json JSONB,
        details_json JSONB,
        first_seen TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS matches_start_time_idx ON matches(start_time);
      CREATE INDEX IF NOT EXISTS matches_status_idx ON matches(status);
      CREATE INDEX IF NOT EXISTS matches_home_away_idx ON matches(home_name, away_name, start_time);
    `);
  });
  // Live migration for databases created before player_state / scorers_json existed.
  await db
    .execute("ALTER TABLE matches ADD COLUMN IF NOT EXISTS player_state TEXT")
    .catch(() => {});
  await db
    .execute("ALTER TABLE matches ADD COLUMN IF NOT EXISTS scorers_json JSONB")
    .catch(() => {});
  // Purge any stale/poisoned player URLs (old yasirtv.com hosts) or block-id players
  await db
    .execute(`
      UPDATE matches 
      SET player_src = NULL, player_state = 'unavailable', player_resolved_at = NULL 
      WHERE player_src LIKE '%yasirtv.com%' 
         OR (match_id < 1000000 AND player_src IS NOT NULL)
    `)
    .catch(() => {});
  dbReady = true;
}

/* ------------------------------------------------------------------ */
/* Smart fetch: timeout + one retry                                    */
/* ------------------------------------------------------------------ */

export async function fetchText(
  url: string,
  timeoutMs = 15_000,
  retries = 1,
): Promise<string> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent": UA,
          Accept: "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
          "Accept-Language": "ar,en;q=0.8",
        },
        signal: AbortSignal.timeout(timeoutMs),
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      return await res.text();
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("fetch failed");
}

/* ------------------------------------------------------------------ */
/* Koora-l.live game JSON enrichment                                   */
/* ------------------------------------------------------------------ */

export async function fetchKooraGame(matchId: number): Promise<KooraGame | null> {
  try {
    const res = await fetch(`${KOORA_BASE}/game/${encodeURIComponent(matchId)}`, {
      headers: { "User-Agent": UA, Accept: "application/json" },
      signal: AbortSignal.timeout(8_000),
      cache: "no-store",
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { game?: KooraGame };
    return json.game ?? null;
  } catch {
    return null;
  }
}

function applyGameEnrichment(row: {
  homeScore: number | null;
  awayScore: number | null;
  status: MatchStatus;
  statusLabel: string | null;
  gameTime: string | null;
  competition: string | null;
  roundName: string | null;
}, game: KooraGame): void {
  const home = game.homeCompetitor?.score;
  const away = game.awayCompetitor?.score;
  if (typeof home === "number" && typeof away === "number") {
    row.homeScore = home;
    row.awayScore = away;
  }
  if (game.gameTimeDisplay) row.gameTime = game.gameTimeDisplay;
  if (game.competitionDisplayName) row.competition = game.competitionDisplayName;
  if (game.roundName) row.roundName = game.roundName;

  const text = game.statusText ?? "";
  if (/انته|نهائي/.test(text)) {
    row.status = "finished";
    row.statusLabel = "انتهت";
  } else if (/شوط|استراحة|بين الشوطين/.test(text)) {
    row.status = "live";
    row.statusLabel = text.includes("استراحة") ? "استراحة" : "مباشر";
  } else if (typeof game.statusGroup === "number" && game.statusGroup >= 2) {
    row.status = "live";
    if (!row.statusLabel || row.statusLabel === "لم تبدأ بعد") row.statusLabel = "مباشر";
  }
}

/* ------------------------------------------------------------------ */
/* Real-id recovery via the 365scores schedule (koora-l data)          */
/*                                                                     */
/* Late at night the source stops exposing ?m= provider links and the  */
/* scraper falls back to html block ids, which the streaming provider  */
/* does not know → "الرابط غير صحيح". We recover the real id by        */
/* matching the fixture (Arabic team names + kickoff) against the     */
/* koora-l game for schedule candidates.                               */
/* ------------------------------------------------------------------ */

interface ScheduleGame {
  id: number;
  startTime: string;
}

let scheduleCache: { fetchedAt: number; games: ScheduleGame[] } | null = null;
const SCHEDULE_TTL_MS = 10 * 60_000;
const resolveRetryAfter = new Map<string, number>();
const RESOLVE_RETRY_MS = 15 * 60_000;

function dmy(d: Date): string {
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}/${d.getUTCFullYear()}`;
}

async function fetchDaySchedule(): Promise<ScheduleGame[] | null> {
  if (scheduleCache && Date.now() - scheduleCache.fetchedAt < SCHEDULE_TTL_MS) {
    return scheduleCache.games;
  }
  try {
    const yesterday = new Date(Date.now() - 24 * 60 * 60_000);
    const dayAfterTomorrow = new Date(Date.now() + 48 * 60 * 60_000);
    const url =
      `${SCORES_GAMES_URL}?appTypeId=5&langId=1&showOdds=false&sports=1` +
      `&startDate=${dmy(yesterday)}&endDate=${dmy(dayAfterTomorrow)}&timezoneName=UTC`;
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "application/json" },
      signal: AbortSignal.timeout(12_000),
      cache: "no-store",
    });
    if (!res.ok) return scheduleCache?.games ?? null;
    const json = (await res.json()) as {
      games?: Array<{
        id?: number;
        sportId?: number;
        startTime?: string;
      }>;
    };
    const games: ScheduleGame[] = (json.games ?? [])
      .filter((g) => typeof g.id === "number" && g.sportId === 1 && g.startTime)
      .map((g) => ({ id: g.id as number, startTime: g.startTime as string }));
    scheduleCache = { fetchedAt: Date.now(), games };
    return games;
  } catch {
    return scheduleCache?.games ?? null;
  }
}

/** Resolve the real provider (365scores/koora) match id for a fixture we
 * only know by name + kickoff. Returns null when unsure — never guesses. */
export async function resolveRealMatchId(
  m: Pick<ParsedMatch, "homeName" | "awayName" | "startTime">,
  kooraBudget: { left: number },
): Promise<{ id: number; game: KooraGame } | null> {
  const kickoff = Date.parse(m.startTime);
  if (!Number.isFinite(kickoff)) return null;
  const key = `${normalizeName(m.homeName)}|${normalizeName(m.awayName)}|${m.startTime.slice(0, 13)}`;
  const retryAt = resolveRetryAfter.get(key);
  if (retryAt && Date.now() < retryAt) return null;

  const schedule = await fetchDaySchedule();
  if (!schedule || schedule.length === 0) return null;

  // The source's data-start comes from the same feed, so the correct game
  // normally shares the exact kickoff. Check nearest first, and allow a
  // wide window only as timezone-shift insurance.
  const candidates = schedule
    .map((g) => ({ g, dt: Math.abs(Date.parse(g.startTime) - kickoff) }))
    .filter((c) => Number.isFinite(c.dt) && c.dt <= 4 * 60 * 60_000)
    .sort((a, b) => a.dt - b.dt)
    .slice(0, 8);

  for (const { g } of candidates) {
    if (kooraBudget.left <= 0) break;
    kooraBudget.left -= 1;
    const game = await fetchKooraGame(g.id);
    if (!game) continue;
    if (
      gameMatchesRow(game, {
        homeName: m.homeName,
        awayName: m.awayName,
        startTime: m.startTime,
      })
    ) {
      resolveRetryAfter.delete(key);
      return { id: g.id, game };
    }
  }
  resolveRetryAfter.set(key, Date.now() + RESOLVE_RETRY_MS);
  return null;
}

/* ------------------------------------------------------------------ */
/* Sync pipeline: scrape source → resolve identities → upsert → enrich */
/* ------------------------------------------------------------------ */

let lastSyncAt = 0;
let syncInFlight: Promise<void> | null = null;

export function shouldSync(ttlMs = MATCH_SCRAPE_TTL_MS): boolean {
  return Date.now() - lastSyncAt > ttlMs;
}

export async function syncMatches(): Promise<void> {
  if (syncInFlight) return syncInFlight;
  syncInFlight = (async () => {
    await ensureDbReady();
    await doSync();
  })().finally(() => {
    syncInFlight = null;
  });
  return syncInFlight;
}

/** Find DB rows for the same fixture (same normalized teams, kickoff
 * within the twin window) whose id is not part of the current parse. */
async function findTwinRows(m: ParsedMatch, excludeIds: Set<number>): Promise<MatchRow[]> {
  const kickoff = Date.parse(m.startTime);
  if (!Number.isFinite(kickoff)) return [];
  const rows = await db
    .select()
    .from(matchesTable)
    .where(
      and(
        gte(matchesTable.startTime, new Date(kickoff - TWIN_LOOKBACK_MS)),
        lte(matchesTable.startTime, new Date(kickoff + TWIN_LOOKBACK_MS)),
      ),
    )
    .limit(300);
  return rows.filter(
    (r) =>
      !excludeIds.has(r.matchId) &&
      Math.abs(r.startTime.getTime() - kickoff) <= TWIN_KICKOFF_WINDOW_MS &&
      normalizeName(r.homeName) === normalizeName(m.homeName) &&
      normalizeName(r.awayName) === normalizeName(m.awayName),
  );
}

/** A stale row (usually keyed by a block id) is being replaced by the real
 * provider id — carry over anything worth keeping, then delete it. */
export async function mergeAndDeleteTwin(twinId: number, targetId: number): Promise<void> {
  const twinRows = await db
    .select()
    .from(matchesTable)
    .where(eq(matchesTable.matchId, twinId))
    .limit(1);
  const twin = twinRows[0];
  if (!twin) return;
  const targetRows = await db
    .select()
    .from(matchesTable)
    .where(eq(matchesTable.matchId, targetId))
    .limit(1);
  const target = targetRows[0];
  if (target) {
    const patch: Partial<NewMatchRow> = {};
    if (twin.competition && !target.competition) patch.competition = twin.competition;
    if (twin.roundName && !target.roundName) patch.roundName = twin.roundName;
    if (twin.gameTime && !target.gameTime) patch.gameTime = twin.gameTime;
    if (twin.gameJson && !target.gameJson) patch.gameJson = twin.gameJson;
    if (twin.detailsJson && !target.detailsJson) patch.detailsJson = twin.detailsJson;
    if (twin.scorersJson && !target.scorersJson) patch.scorersJson = twin.scorersJson;
    if (Object.keys(patch).length) {
      await db
        .update(matchesTable)
        .set(patch)
        .where(eq(matchesTable.matchId, targetId));
    }
  }
  await db.delete(matchesTable).where(eq(matchesTable.matchId, twinId));
}

/** When a match was originally saved under a temporary block ID, and we later
 * discover its real provider ID, we migrate the row to the real ID. */
export async function rekeyMatchRow(
  oldId: number,
  newId: number,
  partnerId?: string,
  sourceUrl?: string | null,
): Promise<void> {
  if (oldId === newId || !isRealMatchId(newId)) return;
  const oldRows = await db
    .select()
    .from(matchesTable)
    .where(eq(matchesTable.matchId, oldId))
    .limit(1);
  const old = oldRows[0];
  if (!old) return;

  const partner = partnerId || old.partnerId;
  const newWatchUrl = buildWatchUrl(newId, partner);

  await db
    .insert(matchesTable)
    .values({
      matchId: newId,
      partnerId: partner,
      homeName: old.homeName,
      awayName: old.awayName,
      homeLogo: old.homeLogo,
      awayLogo: old.awayLogo,
      league: old.league,
      competition: old.competition,
      roundName: old.roundName,
      startTime: old.startTime,
      status: old.status,
      statusLabel: old.statusLabel,
      live: old.live,
      homeScore: old.homeScore,
      awayScore: old.awayScore,
      gameTime: old.gameTime,
      sourceUrl: sourceUrl || old.sourceUrl,
      watchUrl: newWatchUrl,
      gameJson: old.gameJson,
      detailsJson: old.detailsJson,
      scorersJson: old.scorersJson,
      firstSeen: old.firstSeen,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: matchesTable.matchId,
      set: {
        partnerId: partner,
        homeName: old.homeName,
        awayName: old.awayName,
        homeLogo: old.homeLogo,
        awayLogo: old.awayLogo,
        league: old.league,
        competition: old.competition,
        roundName: old.roundName,
        startTime: old.startTime,
        status: old.status,
        statusLabel: old.statusLabel,
        live: old.live,
        homeScore: old.homeScore,
        awayScore: old.awayScore,
        gameTime: old.gameTime,
        sourceUrl: sourceUrl || old.sourceUrl,
        watchUrl: newWatchUrl,
        updatedAt: new Date(),
      },
    });

  await db.delete(matchesTable).where(eq(matchesTable.matchId, oldId));
}

async function doSync(): Promise<void> {
  const html = await fetchText(SIir_URL, 15_000, 1);
  const parsed = parseSiirHtml(html);
  lastSyncAt = Date.now();

  const now = Date.now();
  const parsedIds = new Set(parsed.map((m) => m.matchId));
  const carriedIds = new Set<number>();
  const effectiveMap = new Map<number, number>(); // parsed id -> db row id
  const kooraBudget = { left: 30 };

  for (const m of parsed) {
    // The source listing lags at night — if kickoff has passed, the match
    // is live regardless of what the listing says. This is what lets the
    // watch page start resolving a player at kickoff instead of waiting.
    const flipped = flippedStatus(m.status, m.startTime, now);
    if (flipped === "live" && m.status === "upcoming") {
      m.status = "live";
      m.statusLabel = "مباشر";
    }

    let effectiveId = m.matchId;
    let resolvedGame: KooraGame | null = null;

    const twins = await findTwinRows(m, parsedIds);
    const realTwin = twins.find((t) => isRealMatchId(t.matchId));

    if (m.idSource === "m") {
      // The source exposes the real provider id — trust it unconditionally.
      effectiveId = m.matchId;
    } else if (realTwin) {
      // Block id, but an earlier scrape already knows the real id.
      effectiveId = realTwin.matchId;
      carriedIds.add(realTwin.matchId);
    } else {
      // Try resolving from m.sourceUrl if available (e.g. SEO watch page)
      let resolvedFromSource = false;
      if (m.sourceUrl && (m.sourceUrl.includes("/matches/") || m.sourceUrl.includes("/watch-"))) {
        try {
          const sourceHtml = await fetchText(m.sourceUrl, 5_000, 0);
          const ext = extractFromSourcePage(sourceHtml);
          if (ext.matchId && isRealMatchId(ext.matchId)) {
            effectiveId = ext.matchId;
            carriedIds.add(ext.matchId);
            resolvedFromSource = true;
            if (ext.partnerId) m.partnerId = ext.partnerId;
          }
        } catch {
          // ignore
        }
      }

      if (!resolvedFromSource) {
        // Unknown identity — try to recover the real id from the scores feed.
        const resolved = await resolveRealMatchId(m, kooraBudget);
        if (resolved) {
          effectiveId = resolved.id;
          resolvedGame = resolved.game;
          carriedIds.add(resolved.id);
        } else {
          effectiveId = m.matchId; // last resort: block id (degrades gracefully)
        }
      }
    }
    effectiveMap.set(m.matchId, effectiveId);

    const values: NewMatchRow = {
      matchId: effectiveId,
      partnerId: m.partnerId,
      homeName: m.homeName,
      awayName: m.awayName,
      homeLogo: m.homeLogo,
      awayLogo: m.awayLogo,
      league: m.league,
      startTime: new Date(m.startTime),
      status: m.status,
      statusLabel: m.statusLabel,
      live: m.status === "live",
      homeScore: m.homeScore,
      awayScore: m.awayScore,
      sourceUrl: m.sourceUrl,
      watchUrl: buildWatchUrl(effectiveId, m.partnerId),
      scorersJson:
        m.homeScorers || m.awayScorers
          ? { home: m.homeScorers ?? [], away: m.awayScorers ?? [] }
          : null,
      updatedAt: new Date(),
    };
    if (resolvedGame) {
      // Verified koora game — apply immediately (scores/competition).
      const r = {
        homeScore: m.homeScore ?? null,
        awayScore: m.awayScore ?? null,
        status: m.status,
        statusLabel: m.statusLabel,
        gameTime: null as string | null,
        competition: null as string | null,
        roundName: null as string | null,
      };
      applyGameEnrichment(r, resolvedGame);
      values.status = r.status;
      values.statusLabel = r.statusLabel;
      values.live = r.status === "live";
      values.homeScore = r.homeScore;
      values.awayScore = r.awayScore;
      values.gameTime = r.gameTime;
      values.competition = r.competition;
      values.roundName = r.roundName;
      values.gameJson = resolvedGame as Record<string, unknown>;
    }

    await db
      .insert(matchesTable)
      .values(values)
      .onConflictDoUpdate({
        target: matchesTable.matchId,
        set: {
          partnerId: values.partnerId,
          homeName: values.homeName,
          awayName: values.awayName,
          homeLogo: values.homeLogo,
          awayLogo: values.awayLogo,
          league: values.league,
          startTime: values.startTime,
          status: values.status,
          statusLabel: values.statusLabel,
          live: values.live,
          homeScore: values.homeScore,
          awayScore: values.awayScore,
          sourceUrl: values.sourceUrl,
          watchUrl: values.watchUrl,
          scorersJson: values.scorersJson,
          competition: values.competition,
          roundName: values.roundName,
          gameTime: values.gameTime,
          gameJson: values.gameJson,
          updatedAt: values.updatedAt,
        },
      });

    // If a stale block-id row (or an older rotated id) still exists for
    // this fixture, fold it into the surviving identity and delete it.
    if (isRealMatchId(effectiveId)) {
      for (const t of twins) {
        if (t.matchId !== effectiveId) {
          await mergeAndDeleteTwin(t.matchId, effectiveId);
        }
      }
    }
  }

  // Layer 2 of dedup: purge stale duplicate rows in the scraped window
  // (e.g. rows keyed by block ids from scrapes where m= was missing).
  await purgeDuplicateRows(parsed, carriedIds);

  // Enrich live matches (bounded concurrency) with koora-l data.
  const live = parsed.filter((m) => m.status === "live").slice(0, 8);
  await Promise.allSettled(
    live.map(async (m) => {
      const effectiveId = effectiveMap.get(m.matchId) ?? m.matchId;
      const effectiveRows = await db
        .select()
        .from(matchesTable)
        .where(eq(matchesTable.matchId, effectiveId))
        .limit(1);
      const row = effectiveRows[0];
      if (!row) return;
      // Prefer the real koora id cached in gameJson (identity may have
      // been carried over from a block-id listing), but verify — old rows
      // may hold a poisoned game id from before this guard existed.
      const cachedGame = row.gameJson as { id?: number } | null;
      let kooraId = cachedGame?.id ?? effectiveId;
      let game = await fetchKooraGame(kooraId);
      let verified =
        !!game &&
        gameMatchesRow(game, {
          homeName: row.homeName,
          awayName: row.awayName,
          startTime: row.startTime,
        });
      if (!verified && kooraId !== effectiveId) {
        // The cached game id no longer checks out — retry with the row id.
        kooraId = effectiveId;
        const alt = await fetchKooraGame(kooraId);
        if (
          alt &&
          gameMatchesRow(alt, {
            homeName: row.homeName,
            awayName: row.awayName,
            startTime: row.startTime,
          })
        ) {
          game = alt;
          verified = true;
        }
      }
      if (!verified || !game) return;
      const r = {
        homeScore: row.homeScore,
        awayScore: row.awayScore,
        status: row.status as MatchStatus,
        statusLabel: row.statusLabel,
        gameTime: row.gameTime,
        competition: row.competition,
        roundName: row.roundName,
      };
      applyGameEnrichment(r, game);
      await db
        .update(matchesTable)
        .set({
          homeScore: r.homeScore,
          awayScore: r.awayScore,
          status: r.status,
          statusLabel: r.statusLabel,
          live: r.status === "live",
          gameTime: r.gameTime,
          competition: r.competition,
          roundName: r.roundName,
          gameJson: game as Record<string, unknown>,
          updatedAt: new Date(),
        })
        .where(eq(matchesTable.matchId, effectiveId));
    }),
  );
}

async function purgeDuplicateRows(
  parsed: ParsedMatch[],
  carriedIds: Set<number> = new Set(),
): Promise<void> {
  if (!parsed.length) return;
  const times = parsed.map((m) => Date.parse(m.startTime));
  const min = new Date(Math.min(...times) - 60 * 60 * 1000);
  const max = new Date(Math.max(...times) + 60 * 60 * 1000);
  const rows = await db
    .select()
    .from(matchesTable)
    .where(and(gte(matchesTable.startTime, min), lte(matchesTable.startTime, max)));
  if (rows.length <= 1) return;

  const preferred = new Set([
    ...parsed.map((m) => m.matchId),
    ...carriedIds,
  ]);
  const deduped = dedupeByKey(rows, preferred);
  const keep = new Set(deduped.map((r) => r.matchId));

  for (const r of rows) {
    if (keep.has(r.matchId)) continue;
    const key = matchKey(r);
    const winner = deduped.find((d) => matchKey(d) === key);
    if (winner && winner.matchId !== r.matchId) {
      // Merge enrichment from the outgoing row so the surviving identity
      // keeps competition/game data it might not have re-fetched yet.
      const patch: Partial<NewMatchRow> = {};
      if (r.competition && !winner.competition) patch.competition = r.competition;
      if (r.roundName && !winner.roundName) patch.roundName = r.roundName;
      if (r.gameTime && !winner.gameTime) patch.gameTime = r.gameTime;
      if (r.gameJson && !winner.gameJson) patch.gameJson = r.gameJson;
      if (r.detailsJson && !winner.detailsJson) patch.detailsJson = r.detailsJson;
      if (r.scorersJson && !winner.scorersJson) patch.scorersJson = r.scorersJson;
      if (Object.keys(patch).length) {
        await db
          .update(matchesTable)
          .set(patch)
          .where(eq(matchesTable.matchId, winner.matchId));
      }
    }
    await db.delete(matchesTable).where(eq(matchesTable.matchId, r.matchId));
  }
}

/* ------------------------------------------------------------------ */
/* Queries                                                             */
/* ------------------------------------------------------------------ */

export async function listMatchesByDay(dateISO: string) {
  await ensureDbReady();
  const { start: dayStart, end: dayEnd } = broadcastDayRange(dateISO);
  const rows = await db
    .select()
    .from(matchesTable)
    .where(and(gte(matchesTable.startTime, dayStart), lt(matchesTable.startTime, dayEnd)))
    .orderBy(matchesTable.startTime);
  // Layer 3 of dedup: never let duplicated identities reach the UI.
  return dedupeByKey(rows);
}

export async function getMatchById(matchId: number) {
  const rows = await db
    .select()
    .from(matchesTable)
    .where(eq(matchesTable.matchId, matchId))
    .limit(1);
  return rows[0] ?? null;
}

export async function getMatchHistory(daysBack = 7) {
  const since = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000);
  const rows = await db
    .select({
      startTime: matchesTable.startTime,
    })
    .from(matchesTable)
    .where(gte(matchesTable.startTime, since))
    .orderBy(desc(matchesTable.startTime));
  const byDay = new Map<string, number>();
  for (const r of rows) {
    const key = broadcastDayOf(r.startTime);
    byDay.set(key, (byDay.get(key) ?? 0) + 1);
  }
  return [...byDay.entries()].map(([date, count]) => ({ date, count }));
}

/* ------------------------------------------------------------------ */
/* Player resolution                                                   */
/* ------------------------------------------------------------------ */

export interface PlayerResolution {
  playerSrc: string | null;
  /** "live" — a verified player URL for THIS match.
   *  "ended" — the provider says there is no broadcast for this match.
   *  "unavailable" — provider reachable but no player extracted. */
  state: "live" | "ended" | "unavailable";
}

export async function resolvePlayerSrc(
  matchId: number,
  partnerId: string,
  sourceUrl?: string | null,
): Promise<PlayerResolution & { watchUrl: string }> {
  // If matchId is NOT a real match ID, we cannot resolve via hard watchUrl
  if (!isRealMatchId(matchId)) {
    // If sourceUrl is available, try fetching sourceUrl
    if (sourceUrl) {
      try {
        const sourceHtml = await fetchText(sourceUrl, 8_000, 1);
        const extracted = extractFromSourcePage(sourceHtml);
        if (extracted.matchId && isRealMatchId(extracted.matchId)) {
          const realWatchUrl = buildWatchUrl(extracted.matchId, extracted.partnerId || partnerId);
          const hardHtml = await fetchText(realWatchUrl, 10_000, 1);
          const pSrc = extractPlayerSrc(hardHtml, extracted.matchId);
          if (pSrc && isPlayerUrlValid(pSrc, extracted.matchId)) {
            return { playerSrc: pSrc, state: "live", watchUrl: realWatchUrl };
          }
        }
        if (extracted.playerSrc && isRealMatchId(matchId) && isPlayerUrlValid(extracted.playerSrc, matchId)) {
          return { playerSrc: extracted.playerSrc, state: "live", watchUrl: sourceUrl };
        }
      } catch {
        // ignore
      }
    }
    return {
      playerSrc: null,
      state: "unavailable",
      watchUrl: buildWatchUrl(matchId, partnerId),
    };
  }

  const watchUrl = buildWatchUrl(matchId, partnerId);
  try {
    const html = await fetchText(watchUrl, 12_000, 1);
    const extracted = extractPlayerSrc(html, matchId);
    if (extracted && isPlayerUrlValid(extracted, matchId)) {
      return { playerSrc: extracted, state: "live", watchUrl };
    }
    // No player embedded. If the provider's placeholder says the broadcast
    // is over / not available, surface that state instead of guessing.
    if (detectEndedState(html)) {
      return { playerSrc: null, state: "ended", watchUrl };
    }
    return { playerSrc: null, state: "unavailable", watchUrl };
  } catch {
    // Provider unreachable (network hiccup) — return unavailable so user sees clean UI with retry,
    // NEVER return a broken fallback player iframe with hardcoded dummy keys!
    return { playerSrc: null, state: "unavailable", watchUrl };
  }
}

export interface PlayerCacheRow {
  matchId: number;
  partnerId: string;
  playerSrc: string | null;
  playerResolvedAt: Date | null;
  playerState?: string | null;
  /** Row status — "ended" verdicts are trusted long only for finished matches. */
  status?: string | null;
  sourceUrl?: string | null;
}

function playerCacheTtlMs(state: string | null | undefined, status?: string | null): number {
  if (state === "live") return PLAYER_CACHE_TTL_MS;
  if (state === "ended") {
    // For a finished match the verdict is stable; otherwise the provider
    // shows the same placeholder before kickoff / while provisioning, and
    // caching it long would delay the stream appearing.
    return status === "finished" ? PLAYER_ENDED_TTL_MS : PLAYER_RETRY_TTL_MS;
  }
  return PLAYER_RETRY_TTL_MS; // unavailable / unknown
}

export async function ensurePlayerCached(
  row: PlayerCacheRow,
): Promise<PlayerResolution> {
  const ttl = playerCacheTtlMs(row.playerState, row.status);
  const fresh =
    row.playerResolvedAt && Date.now() - row.playerResolvedAt.getTime() < ttl;
  if (fresh) {
    // Valid, id-verified player URL → serve it.
    if (isPlayerUrlValid(row.playerSrc, row.matchId)) {
      return { playerSrc: row.playerSrc, state: "live" };
    }
    // A cached "no player" verdict that is still fresh.
    if (!row.playerSrc && (row.playerState === "ended" || row.playerState === "unavailable")) {
      return { playerSrc: null, state: row.playerState };
    }
    // Anything else (e.g. a poisoned URL for a different match id) falls
    // through and is re-resolved right away.
  }

  let currentId = row.matchId;
  let currentPartner = row.partnerId;
  let currentSourceUrl = row.sourceUrl ?? null;

  // If this row has a block id (< 1_000_000), try to recover the real ID before resolving!
  if (!isRealMatchId(currentId)) {
    const fullRow = await getMatchById(currentId);
    if (fullRow) {
      currentSourceUrl = fullRow.sourceUrl;
      // 1. Try recovering from sourceUrl
      if (currentSourceUrl) {
        try {
          const sourceHtml = await fetchText(currentSourceUrl, 8_000, 1);
          const ext = extractFromSourcePage(sourceHtml);
          if (ext.matchId && isRealMatchId(ext.matchId)) {
            const partner = ext.partnerId || currentPartner;
            await rekeyMatchRow(currentId, ext.matchId, partner, currentSourceUrl);
            currentId = ext.matchId;
            currentPartner = partner;
          }
        } catch {
          // ignore
        }
      }

      // 2. Try recovering from 365scores schedule
      if (!isRealMatchId(currentId)) {
        const resolved = await resolveRealMatchId(
          {
            homeName: fullRow.homeName,
            awayName: fullRow.awayName,
            startTime: fullRow.startTime.toISOString(),
          },
          { left: 10 },
        );
        if (resolved && isRealMatchId(resolved.id)) {
          await rekeyMatchRow(currentId, resolved.id, currentPartner, currentSourceUrl);
          currentId = resolved.id;
        }
      }
    }
  }

  const res = await resolvePlayerSrc(currentId, currentPartner, currentSourceUrl);
  try {
    await db
      .update(matchesTable)
      .set({
        playerSrc: res.playerSrc,
        playerState: res.state,
        playerResolvedAt: new Date(),
      })
      .where(eq(matchesTable.matchId, currentId));
  } catch {
    // cache write is best effort
  }
  return { playerSrc: res.playerSrc, state: res.state };
}

export async function fetchCachedGame(matchId: number): Promise<KooraGame | null> {
  const row = await getMatchById(matchId);
  let game = (row?.gameJson as KooraGame | undefined) ?? null;
  // Ignore poisoned caches (a game JSON for a different match).
  if (row && game && !gameMatchesRow(game, row)) game = null;
  const fresh = row && Date.now() - row.updatedAt.getTime() < GAME_CACHE_TTL_MS;
  if (fresh && game) return game;
  const live = await fetchKooraGame(matchId);
  if (!live) return game;
  // koora returns *some* game for nearly any id — make sure it is ours.
  if (row && !gameMatchesRow(live, row)) return game;
  if (row) {
    await db
      .update(matchesTable)
      .set({ gameJson: live as Record<string, unknown>, updatedAt: new Date() })
      .where(eq(matchesTable.matchId, matchId));
  }
  return live;
}

/* ------------------------------------------------------------------ */
/* Match details — the same data the watch page pulls from             */
/* koora-l.live to render its Details / Lineups / Standings tabs.      */
/* ------------------------------------------------------------------ */

interface KooraStatsResponse {
  statistics?: Array<{
    name?: string;
    value?: string;
    competitorId?: number;
    valuePercentage?: number;
    isMajor?: boolean;
    order?: number;
  }>;
  competitions?: Array<{ id?: number; name?: string }>;
  [key: string]: unknown;
}

export async function fetchKooraStats(
  matchId: number,
): Promise<KooraStatsResponse | null> {
  try {
    const res = await fetch(`${KOORA_BASE}/stats/${encodeURIComponent(matchId)}`, {
      headers: { "User-Agent": UA, Accept: "application/json" },
      signal: AbortSignal.timeout(8_000),
      cache: "no-store",
    });
    if (!res.ok) return null;
    return (await res.json()) as KooraStatsResponse;
  } catch {
    return null;
  }
}

interface KooraStandingsResponse {
  standings?: Array<{
    rows?: Array<{
      position?: string | number;
      competitor?: { id?: number; name?: string };
      gamePlayed?: number;
      gamesWon?: number;
      gamesEven?: number;
      gamesLost?: number;
      for?: number;
      against?: number;
      points?: number;
    }>;
  }>;
  [key: string]: unknown;
}

export async function fetchKooraStandings(
  competitionId: number,
): Promise<KooraStandingsResponse | null> {
  try {
    const res = await fetch(`${KOORA_BASE}/standings/${competitionId}`, {
      headers: { "User-Agent": UA, Accept: "application/json" },
      signal: AbortSignal.timeout(8_000),
      cache: "no-store",
    });
    if (!res.ok) return null;
    return (await res.json()) as KooraStandingsResponse;
  } catch {
    return null;
  }
}

interface RawMember {
  id?: number;
  name?: string;
  shortName?: string;
  jerseyNumber?: number;
  competitorId?: number;
}

interface RawLineupMember {
  id?: number;
  status?: number;
  position?: { name?: string };
  stats?: Array<{ name?: string; value?: string }>;
}

interface RawLineups {
  formation?: string;
  members?: RawLineupMember[];
}

interface RawCompetitor {
  id?: number;
  name?: string;
  lineups?: RawLineups;
}

export function buildMatchDetails(
  game: KooraGame,
  stats: KooraStatsResponse | null,
  standings: KooraStandingsResponse | null,
): MatchDetails {
  const home = game.homeCompetitor as RawCompetitor | undefined;
  const away = game.awayCompetitor as RawCompetitor | undefined;
  const members = (game.members ?? []) as RawMember[];

  const memberById = new Map<number, RawMember>();
  for (const m of members) if (m.id != null) memberById.set(m.id, m);

  const lineup = (c: RawCompetitor | undefined) => {
    if (!c?.lineups?.members) return null;
    const players = c.lineups.members
      .filter((m) => m.status === 1 || m.status === undefined) // starters
      .slice(0, 18)
      .map((m) => {
        const info = m.id != null ? memberById.get(m.id) : undefined;
        const goals = m.stats?.find((s) => /أهداف|goals/i.test(s.name ?? ""))?.value ?? null;
        const yellow = m.stats?.filter((s) => /صفراء|yellow/i.test(s.name ?? "")).length ?? 0;
        const red = m.stats?.filter((s) => /حمراء|red/i.test(s.name ?? "")).length ?? 0;
        return {
          name: info?.name ?? info?.shortName ?? "",
          number: info?.jerseyNumber ?? null,
          position: m.position?.name ?? "",
          goals: goals ? Number(String(goals).replace(/\D/g, "")) || null : null,
          yellow,
          red,
        };
      })
      .filter((p) => p.name);
    return {
      formation: c.lineups.formation ?? null,
      players,
    };
  };

  // Stats comparison: pick major rows present for both teams.
  const statRows: MatchDetails["stats"] = [];
  if (stats?.statistics && home?.id != null && away?.id != null) {
    const homeId = home.id;
    const awayId = away.id;
    const byName = new Map<string, Map<number, { value: string; pct: number }>>();
    for (const s of stats.statistics) {
      if (!s.name || s.competitorId == null || !s.value) continue;
      let map = byName.get(s.name);
      if (!map) {
        map = new Map();
        byName.set(s.name, map);
      }
      map.set(s.competitorId, { value: s.value, pct: s.valuePercentage ?? 0 });
    }
    const names: string[] = [];
    for (const [name, map] of byName) {
      if (map.has(homeId) && map.has(awayId)) names.push(name);
      if (names.length >= 10) break;
    }
    for (const name of names) {
      const h = byName.get(name)?.get(homeId);
      const a = byName.get(name)?.get(awayId);
      if (!h || !a) continue;
      statRows.push({
        name,
        home: h.value,
        away: a.value,
        homePct: h.pct,
        awayPct: a.pct,
      });
    }
  }

  // Standings: first table, top rows, highlight the two teams.
  const standingRows: StandingRow[] = [];
  const table = standings?.standings?.[0];
  if (table?.rows && (home?.id != null || away?.id != null)) {
    for (const r of table.rows.slice(0, 14)) {
      const name = r.competitor?.name ?? "";
      if (!name) continue;
      const isMatchTeam =
        (home?.id != null && r.competitor?.id === home.id) ||
        (away?.id != null && r.competitor?.id === away.id);
      standingRows.push({
        position: Number(r.position ?? 0),
        name,
        played: Number(r.gamePlayed ?? 0),
        won: Number(r.gamesWon ?? 0),
        drawn: Number(r.gamesEven ?? 0),
        lost: Number(r.gamesLost ?? 0),
        gf: Number(r.for ?? 0),
        ga: Number(r.against ?? 0),
        points: Number(r.points ?? 0),
        isMatchTeam,
      });
    }
  }

  const venue = (game.venue as { name?: string } | undefined)?.name ?? null;
  const officials = Array.isArray(game.officials) ? game.officials : [];
  const referee =
    (officials[0] as { name?: string } | undefined)?.name ?? null;

  return {
    venue,
    referee,
    kickoff: game.startTime ?? null,
    roundName: game.roundName ?? null,
    competition: game.competitionDisplayName ?? null,
    home: lineup(home),
    away: lineup(away),
    stats: statRows,
    standings: standingRows,
  };
}

const DETAILS_TTL_LIVE_MS = 60_000;
const DETAILS_TTL_MS = 10 * 60_000;

export async function fetchCachedDetails(
  matchId: number,
  status: MatchStatus,
): Promise<MatchDetails | null> {
  const row = await getMatchById(matchId);
  const cached = row?.detailsJson
    ? (row.detailsJson as unknown as MatchDetails)
    : undefined;
  const ttl = status === "live" ? DETAILS_TTL_LIVE_MS : DETAILS_TTL_MS;
  const fresh =
    cached && row && Date.now() - row.updatedAt.getTime() < ttl;
  if (fresh && cached) return cached;

  const game = await fetchKooraGame(matchId);
  if (!game) return cached ?? null;
  // Never build details from a game that is not actually this match.
  if (row && !gameMatchesRow(game, row)) return cached ?? null;

  const [stats, standings] = await Promise.all([
    fetchKooraStats(matchId),
    typeof game.competitionId === "number"
      ? fetchKooraStandings(game.competitionId)
      : Promise.resolve(null),
  ]);

  const details = buildMatchDetails(game, stats, standings);
  if (row) {
    await db
      .update(matchesTable)
      .set({ detailsJson: details as unknown as Record<string, unknown> })
      .where(eq(matchesTable.matchId, matchId));
  }
  return details;
}

export const SOURCE_LABEL = "tvsiir.co";

/* ------------------------------------------------------------------ */
/* View mapping (shared by the API routes)                             */
/* ------------------------------------------------------------------ */

export function rowToView(row: {
  matchId: number;
  homeName: string;
  awayName: string;
  homeLogo: string | null;
  awayLogo: string | null;
  league: string | null;
  competition: string | null;
  startTime: Date;
  status: string;
  statusLabel: string | null;
  homeScore: number | null;
  awayScore: number | null;
  gameTime: string | null;
  scorersJson?: { home: string[]; away: string[] } | null;
  watchUrl: string | null;
}): MatchView {
  return {
    id: row.matchId,
    homeName: row.homeName,
    awayName: row.awayName,
    homeLogo: row.homeLogo,
    awayLogo: row.awayLogo,
    league: row.league,
    competition: row.competition,
    startTime: row.startTime.toISOString(),
    status: (row.status === "live" || row.status === "finished"
      ? row.status
      : "upcoming") as MatchView["status"],
    statusLabel: row.statusLabel,
    homeScore: row.homeScore,
    awayScore: row.awayScore,
    gameTime: row.gameTime,
    homeScorers: row.scorersJson?.home ?? [],
    awayScorers: row.scorersJson?.away ?? [],
    watchUrl: row.watchUrl ?? `/watch/${row.matchId}`,
  };
}
