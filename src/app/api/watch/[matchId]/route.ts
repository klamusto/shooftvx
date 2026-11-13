import {
  buildWatchUrl,
  ensurePlayerCached,
  fetchCachedDetails,
  fetchCachedGame,
  getMatchById,
  isRealMatchId,
  rowToView,
} from "@/lib/source";
import type { MatchDetails, PlayerState, WatchResponse } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/** How long before kickoff we start probing the provider for a player.
 * The provider usually provisions the stream only around kickoff. */
const PRE_KICKOFF_PROBE_MS = 15 * 60_000;

export async function GET(
  _request: Request,
  ctx: { params: Promise<{ matchId: string }> },
) {
  const { matchId } = await ctx.params;
  const id = Number(matchId);
  if (!Number.isFinite(id) || id <= 0) {
    return Response.json({ error: "invalid match id" }, { status: 400 });
  }

  let row = await getMatchById(id);
  const partnerId = row?.partnerId ?? "87350";
  const watchUrl = row?.watchUrl ?? buildWatchUrl(id, partnerId);

  const kickoff = row ? row.startTime.getTime() : null;
  const now = Date.now();

  let playerSrc: string | null = null;
  let playerState: PlayerState;

  if (row?.status === "finished") {
    // Never embed a player for a finished match: the provider has no
    // replay, and a stale/shared stream URL would play whatever is live
    // right now instead of this match.
    playerState = "ended";
  } else if (
    row &&
    row.status === "upcoming" &&
    kickoff !== null &&
    now < kickoff - PRE_KICKOFF_PROBE_MS
  ) {
    // Upcoming and kickoff is far away — show the countdown state and
    // skip hammering the provider (it would answer "no broadcast" anyway).
    playerState = "waiting";
  } else {
    // Live, around kickoff, or an unknown id — resolve the player now.
    try {
      const res = await ensurePlayerCached({
        matchId: id,
        partnerId,
        playerSrc: row?.playerSrc ?? null,
        playerResolvedAt: row?.playerResolvedAt ?? null,
        playerState: row?.playerState ?? null,
        status: row?.status ?? null,
        sourceUrl: row?.sourceUrl ?? null,
      });
      if (res.playerSrc) {
        playerState = "live";
        playerSrc = res.playerSrc;
      } else if (res.state === "ended") {
        // The provider shows its "ended" placeholder for finished matches
        // AND for matches that have not started / are not covered. Only
        // surface "ended" when the match really must be over.
        const reallyOver =
          row?.status === "finished" ||
          !row ||
          (kickoff !== null && now > kickoff + 180 * 60_000);
        playerState = reallyOver ? "ended" : "unavailable";
      } else {
        playerState = "unavailable";
      }
    } catch {
      playerSrc = null;
      playerState = "unavailable";
    }

    // If the row was rekeyed from a block ID to a real ID, reload the row
    if (!isRealMatchId(id)) {
      const refreshed = await getMatchById(id);
      if (refreshed) {
        row = refreshed;
      }
    }
  }

  const effectiveId = row?.matchId ?? id;
  const [game] = await Promise.allSettled([fetchCachedGame(effectiveId)]);
  const gameJson = game.status === "fulfilled" ? game.value : null;

  // Match details (lineups / stats / standings) — same data the source
  // watch page renders under the player.
  let details: MatchDetails | null = null;
  try {
    const status: "live" | "upcoming" | "finished" =
      row?.status === "live" || row?.status === "finished"
        ? row.status
        : "upcoming";
    details = await fetchCachedDetails(effectiveId, status);
  } catch {
    details = null;
  }

  const view = row ? rowToView(row) : null;

  const body: WatchResponse = {
    matchId: effectiveId,
    playerSrc,
    playerState,
    watchUrl: row?.watchUrl ?? watchUrl,
    sourceUrl: row?.sourceUrl ?? null,
    match: view,
    game: gameJson,
    details,
    resolved: Boolean(playerSrc),
  };

  return Response.json(body, { headers: { "Cache-Control": "no-store" } });
}
