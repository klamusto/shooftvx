/* ------------------------------------------------------------------ */
/* Pure parsing / identity logic — no network, no database.            */
/* Kept dependency-free on purpose so it can be exercised with        */
/* plain `node scripts/test-fix.ts` (type-stripping) without a        */
/* node_modules install.                                              */
/* ------------------------------------------------------------------ */

export type MatchStatus = "live" | "upcoming" | "finished";
export type ParsedIdSource = "m" | "block";

/** Provider id space (365scores / koora-l / hes-goals share it). */
export const REAL_ID_MIN = 1_000_000;
/** Site block ids (`id="m-5883"`) are small per-page counters. */
export function isRealMatchId(id: number | null | undefined): boolean {
  return typeof id === "number" && Number.isFinite(id) && id >= REAL_ID_MIN;
}

export const DEFAULT_PARTNER_ID = "87350";
/** The provider's hard watch page (tvsiir.co → sirftv.com network). */
const HARD_PREFIX = "https://n2.sirftv.com/hard/2908c7d4425d";
/** Real player host — the hard page assigns window.__playerSrc on it. */
export const FALLBACK_PLAYER_HOST = "912acsss8af382.sirtv.top";
/** Static site key the provider embeds on every playerv5 URL — it is NOT
 * a per-match secret; only presence of a key is validated. */
export const PLAYER_STATIC_KEY = "9f39972b67d6ce22189507d008acwc26";
/** Old hosts that once served poisoned/broken players — never embed again. */
const POISONED_PLAYER_HOST_SUFFIXES = ["yasirtv.com"];

export interface ParsedMatch {
  matchId: number;
  partnerId: string;
  homeName: string;
  awayName: string;
  homeLogo?: string;
  awayLogo?: string;
  league?: string;
  startTime: string; // ISO (UTC)
  status: MatchStatus;
  statusLabel: string;
  homeScore?: number;
  awayScore?: number;
  /** Goalscorers as listed by the source ("name 45'"), home side first. */
  homeScorers?: string[];
  awayScorers?: string[];
  sourceUrl: string;
  watchUrl: string;
  /** "m" — id read from the source's ?m= link (trustworthy).
   *  "block" — fallback to the html block counter id (NOT trustworthy). */
  idSource: ParsedIdSource;
}

export function buildWatchUrl(matchId: number, partnerId: string): string {
  return `${HARD_PREFIX}${partnerId}.html?match=${matchId}`;
}

export function fallbackPlayerSrc(matchId: number): string {
  return `https://${FALLBACK_PLAYER_HOST}/playerv5.php?match=${encodeURIComponent(
    String(matchId),
  )}&key=${PLAYER_STATIC_KEY}`;
}

/* ------------------------------------------------------------------ */
/* Arabic-aware name normalization                                     */
/* ------------------------------------------------------------------ */

const ARABIC_TASHKEEL = /[\u064B-\u065F\u0670\u0640]/g; // harakat + tatweel

/** Normalize a team name for identity comparisons. Display names are kept
 * verbatim; this is only used for matching/dedup keys. */
export function normalizeName(name: string | null | undefined): string {
  if (!name) return "";
  return name
    .replace(ARABIC_TASHKEEL, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ئ/g, "ي")
    .replace(/ؤ/g, "و")
    .replace(/ة/g, "ه")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function timeBucket(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return iso.slice(0, 16);
  const bucket = Math.floor(t / (30 * 60 * 1000)) * 30 * 60 * 1000;
  return new Date(bucket).toISOString().slice(0, 16);
}

export interface DedupKeyable {
  homeName: string;
  awayName: string;
  startTime: Date | string;
}

/** Dedup key: normalized teams + kickoff rounded to a 30-minute bucket so
 * small listing drift (a shifted data-start, a spelling variant) still
 * collapses to the same identity. */
export function matchKey(m: DedupKeyable): string {
  const t =
    typeof m.startTime === "string" ? m.startTime : m.startTime.toISOString();
  return `${normalizeName(m.homeName)}|${normalizeName(m.awayName)}|${timeBucket(t)}`;
}

/* ------------------------------------------------------------------ */
/* Deduplication                                                       */
/* ------------------------------------------------------------------ */

const STATUS_PRIORITY: Record<string, number> = {
  live: 4,
  upcoming: 3,
  finished: 2,
};

export interface DedupRow extends DedupKeyable {
  matchId: number;
  status: string;
  competition?: string | null;
  league?: string | null;
  updatedAt?: Date | null;
}

export function pickBest<T extends DedupRow>(rows: T[], preferredIds?: Set<number>): T {
  return [...rows].sort((a, b) => {
    if (preferredIds) {
      const pa = preferredIds.has(a.matchId) ? 1 : 0;
      const pb = preferredIds.has(b.matchId) ? 1 : 0;
      if (pa !== pb) return pb - pa;
    }
    // Real provider ids always beat block-id fallbacks: block ids produce
    // broken watch links ("الرابط غير صحيح") on the provider's player.
    const ra = isRealMatchId(a.matchId) ? 1 : 0;
    const rb = isRealMatchId(b.matchId) ? 1 : 0;
    if (ra !== rb) return rb - ra;
    const ps = (STATUS_PRIORITY[b.status] ?? 0) - (STATUS_PRIORITY[a.status] ?? 0);
    if (ps) return ps;
    const ea = a.competition || a.league ? 1 : 0;
    const eb = b.competition || b.league ? 1 : 0;
    if (ea !== eb) return eb - ea;
    const ta = a.updatedAt?.getTime() ?? 0;
    const tb = b.updatedAt?.getTime() ?? 0;
    return tb - ta;
  })[0];
}

export function dedupeByKey<T extends DedupRow>(rows: T[], preferredIds?: Set<number>): T[] {
  const groups = new Map<string, T[]>();
  for (const r of rows) {
    const key = matchKey(r);
    const arr = groups.get(key);
    if (arr) arr.push(r);
    else groups.set(key, [r]);
  }
  const out: T[] = [];
  for (const group of groups.values()) {
    out.push(pickBest(group, preferredIds));
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Kickoff time parsing                                                */
/* ------------------------------------------------------------------ */

/** Parse the source `data-start` attribute into a UTC ISO string.
 * Accepts "YYYY-MM-DD HH:mm[:ss]", ISO strings with Z, or with an offset.
 * Naive timestamps are treated as UTC — the source feeds them to its own
 * client-side JS which renders visitor-local times, so they must already
 * be absolute. Returns null for anything unparseable (block is skipped
 * instead of poisoning the whole sync). */
export function parseDataStart(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = raw.trim().replace(" ", "T");
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s)) return null;
  let normalized = s;
  if (!/(Z|[+-]\d{2}:?\d{2})$/.test(normalized)) {
    normalized += "Z";
  }
  const t = Date.parse(normalized);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

/* ------------------------------------------------------------------ */
/* HTML parsing — tvsiir.co match blocks                              */
/* ------------------------------------------------------------------ */

const HTML_ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#039;": "'",
  "&nbsp;": " ",
};

export function decodeEntities(text: string): string {
  return text.replace(/&(amp|lt|gt|quot|#039|nbsp);/g, (m) => HTML_ENTITIES[m] ?? m);
}

function clean(text: string): string {
  return decodeEntities(text)
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractTitleLeague(title: string): string | undefined {
  const leagueMatch = title.match(/(?:الدوري|دوري|كأس|كاس|الكأس|البطولة)[^()（(,:—–-]*/);
  return leagueMatch ? leagueMatch[0].trim() : undefined;
}

export function mapStatusLabel(label: string): { status: MatchStatus; statusLabel: string } {
  if (/مباشر|شوط|استراحة|بين الشوطين|ترجيح|الآن/.test(label)) {
    return { status: "live", statusLabel: label.includes("استراحة") ? "استراحة" : "مباشر" };
  }
  if (/انته/.test(label)) return { status: "finished", statusLabel: "انتهت" };
  if (/بعد قليل|لم تبدأ|قريب/.test(label)) return { status: "upcoming", statusLabel: label };
  return { status: "upcoming", statusLabel: label || "لم تبدأ بعد" };
}

export function extractIdAndPartnerFromUrl(rawUrl: string): {
  id: number | null;
  partnerId: string | null;
} {
  if (!rawUrl) return { id: null, partnerId: null };
  const decoded = decodeEntities(rawUrl);

  const mParam = decoded.match(/[?&](?:m|match|match_id|id|game|mid)=(\d+)/i);
  let id: number | null = mParam ? Number(mParam[1]) : null;

  if (!id) {
    const pathMatch = decoded.match(/\/(?:game|match|event)\/(\d{6,})/i);
    if (pathMatch) id = Number(pathMatch[1]);
  }

  const pParam = decoded.match(/[?&](?:p|partner|partner_id)=(\w+)/i);
  let partnerId: string | null = pParam ? pParam[1] : null;

  if (!partnerId) {
    const hardMatch = decoded.match(/hard\/[a-f0-9]{12}(\w+)\.html/i);
    if (hardMatch) partnerId = hardMatch[1];
  }

  return { id, partnerId };
}

export interface AnchorInfo {
  href: string;
  title: string | null;
  mId: number | null;
  partnerId: string | null;
}

export function collectAnchors(slice: string): AnchorInfo[] {
  const anchors: AnchorInfo[] = [];
  const tagRe = /<a\s+([^>]*)>/g;
  let tag: RegExpExecArray | null;
  while ((tag = tagRe.exec(slice)) !== null) {
    const attrs = tag[1];
    const hrefMatch = attrs.match(/href\s*=\s*["']([^"']*)["']/i);
    if (!hrefMatch) continue;
    const href = decodeEntities(hrefMatch[1]);
    const titleMatch = attrs.match(/title\s*=\s*["']([^"']*)["']/i);
    const title = titleMatch ? decodeEntities(titleMatch[1]) : null;
    const { id, partnerId } = extractIdAndPartnerFromUrl(href);
    anchors.push({
      href,
      title,
      mId: id,
      partnerId,
    });
  }
  return anchors;
}

export function parseSiirHtml(html: string): ParsedMatch[] {
  const out: ParsedMatch[] = [];

  // Real source markup:
  // <div class="AY_Match live" id="m-5883" data-start="...">
  //   <div class="TM_Logo"><img alt="ليتشي" src="..."/></div>
  //   <div class="TM_Name">ليتشي</div>
  //   <span class='MT_Time'><span>17:30</span></span>
  //   <span class="MT_Result"><span class="RS-goals">0</span>...<span class="RS-goals">4</span></span>
  //   <div class='MT_Stat'>مباشر</div>
  //   <a href="https://korat.hes-goals.mov/?m=4732725&p=87350" title="..."></a>
  // </div>
  //
  // At night the source often swaps the provider link for an internal SEO
  // page (/matches/watch-... with no ?m= param). In that case we fall back
  // to the block counter id and flag it (idSource "block") so the sync can
  // try to recover the real provider id.
  const blockRe =
    /<div([^>]*\bid\s*=\s*["']m-(\d+)["'][^>]*)>([\s\S]*?)(?=<div[^>]*\bid\s*=\s*["']m-\d+["']|$)/g;

  let block: RegExpExecArray | null;
  while ((block = blockRe.exec(html)) !== null) {
    try {
      const parsed = parseBlock(block[1], Number(block[2]), block[3]);
      if (parsed) out.push(parsed);
    } catch {
      // One broken block must never kill the whole sync (that used to
      // freeze the entire match list for the rest of the night).
    }
  }

  // Layer 1 of dedup: the source can list the same match twice (multiple
  // widgets / rotated ids). Prefer entries whose id comes from the real
  // m= param over block-id fallbacks.
  const realIds = new Set(
    out.filter((m) => m.idSource === "m").map((m) => m.matchId),
  );
  return dedupeByKey(out, realIds);
}

function parseBlock(attrs: string, blockId: number, slice: string): ParsedMatch | null {
  if (!Number.isFinite(blockId) || blockId <= 0) return null;

  const startRaw = attrs.match(/data-start\s*=\s*["']([^"']*)["']/i);
  const startISO = parseDataStart(startRaw?.[1]);
  if (!startISO) return null; // cannot place this match in time — skip it

  // Teams: TM_Logo img + TM_Name div (two occurrences).
  const teams: { name: string; logo?: string }[] = [];
  const imgRe = /<div[^>]*class=["']TM_Logo["'][^>]*>\s*<img([^>]*)>/g;
  const nameRe = /<div[^>]*class=["']TM_Name["'][^>]*>([^<]*)<\/div>/g;
  let imgMatch: RegExpExecArray | null;
  while ((imgMatch = imgRe.exec(slice)) !== null) {
    const a = imgMatch[1];
    const alt = a.match(/alt=["']([^"']*)["']/i);
    const src = a.match(/src=["']([^"']*)["']/i);
    teams.push({
      name: alt ? decodeEntities(alt[1]) : "",
      logo: src ? decodeEntities(src[1]) : undefined,
    });
  }
  const names: string[] = [];
  let nMatch: RegExpExecArray | null;
  while ((nMatch = nameRe.exec(slice)) !== null) {
    names.push(clean(nMatch[1]));
  }
  if (teams.length < 2) return null;
  for (let i = 0; i < 2 && i < names.length; i++) {
    if (names[i]) teams[i].name = names[i];
  }
  if (!teams[0].name || !teams[1].name) return null;

  // Check data attributes or onclick for real provider id
  const blockMatch = attrs.match(/data-(?:match|id|m|game|mid|match-id)\s*=\s*["'](\d+)["']/i);
  const blockDataId = blockMatch ? Number(blockMatch[1]) : null;

  // Links: prefer any anchor carrying a real provider id
  const anchors = collectAnchors(slice);
  const providerAnchor =
    anchors.find((a) => a.mId !== null && isRealMatchId(a.mId)) ??
    anchors.find((a) => a.mId !== null && a.mId > 0) ??
    null;
  const titleAnchor =
    anchors.find((a) => (a.title ?? "").trim().length > 0) ?? null;

  const realCandidateId =
    providerAnchor?.mId ??
    (blockDataId && isRealMatchId(blockDataId) ? blockDataId : null);
  const isReal = realCandidateId !== null && isRealMatchId(realCandidateId);
  const id = realCandidateId ?? blockId;
  const partnerId = providerAnchor?.partnerId ?? DEFAULT_PARTNER_ID;
  const sourceUrl = providerAnchor?.href ?? titleAnchor?.href ?? anchors[0]?.href ?? "";
  const league = extractTitleLeague(titleAnchor?.title ?? "");

  // Clock + score + status.
  const statMatch = slice.match(/class=["']MT_Stat["'][^>]*>([^<]*)/);
  const statusLabel = statMatch ? clean(statMatch[1]) : "";

  // Goalscorers: <div class="MT_Scorers"><div class="SC_Home_Group">
  //   <span class="SC_Scorer">name <span dir="ltr">45'</span></span>…
  const scorers: { home: string[]; away: string[] } = { home: [], away: [] };
  const scorerGroupRe =
    /<div[^>]*class=["']SC_(Home|Away)_Group["'][^>]*>([\s\S]*?)(?=<div[^>]*class=["']SC_(?:Home|Away)_Group["']|<\/div>\s*<\/div>|$)/gi;
  let sGroup: RegExpExecArray | null;
  while ((sGroup = scorerGroupRe.exec(slice)) !== null) {
    const side = sGroup[1].toLowerCase() === "home" ? "home" : "away";
    const scorerRe = /class=["']SC_Scorer["'][^>]*>([\s\S]*?)<\/span>/gi;
    let scorer: RegExpExecArray | null;
    while ((scorer = scorerRe.exec(sGroup[2])) !== null) {
      const name = clean(scorer[1]);
      if (name) scorers[side].push(name);
    }
  }

  const goals: number[] = [];
  const goalRe = /class=["'][^"']*RS-goals[^"']*["'][^>]*>(\d+)</g;
  let gMatch: RegExpExecArray | null;
  while ((gMatch = goalRe.exec(slice)) !== null && goals.length < 2) {
    goals.push(Number(gMatch[1]));
  }

  const base = {
    matchId: id,
    partnerId,
    homeName: teams[0].name,
    awayName: teams[1].name,
    homeLogo: teams[0].logo,
    awayLogo: teams[1].logo,
    league,
    startTime: startISO,
    sourceUrl,
    watchUrl: buildWatchUrl(id, partnerId),
    idSource: isReal ? ("m" as const) : ("block" as const),
  };
  if (scorers.home.length || scorers.away.length) {
    Object.assign(base, {
      homeScorers: scorers.home,
      awayScorers: scorers.away,
    });
  }

  if (goals.length === 2) {
    const mapped = mapStatusLabel(statusLabel || "");
    // Fall back to clock-based inference when the label is empty.
    let status = mapped.status;
    let label = mapped.statusLabel || "مجدولة";
    if (!statusLabel && Date.parse(startISO) <= Date.now()) {
      status = "live";
      label = "مباشر";
    }
    return {
      ...base,
      status,
      statusLabel: label,
      homeScore: goals[0],
      awayScore: goals[1],
    };
  }
  const mapped = mapStatusLabel(statusLabel || "لم تبدأ بعد");
  return {
    ...base,
    status: mapped.status,
    statusLabel: mapped.statusLabel,
  };
}

/* ------------------------------------------------------------------ */
/* Player URL resolution — window.__playerSrc                          */
/* ------------------------------------------------------------------ */

function unescapeUrl(s: string): string {
  return s.replace(/&amp;/g, "&").replace(/\\\//g, "/");
}

/** Force the `match` query param of a player URL to the requested id.
 * Never lets a player URL point at a different match than the one the
 * user clicked — the provider template embeds a default/live stream on
 * placeholder pages, which is what made "finished match plays the
 * current match" possible. Returns null for unparseable URLs. */
export function enforceMatchParam(rawUrl: string, matchId: number): string | null {
  try {
    let candidate = rawUrl.trim();
    if (candidate.startsWith("//")) candidate = `https:${candidate}`;
    const url = new URL(candidate);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    const current = url.searchParams.get("match");
    if (current === null || Number(current) !== matchId) {
      url.searchParams.set("match", String(matchId));
    }
    return url.toString();
  } catch {
    return null;
  }
}

/** Does this player URL point at the given match id? Used to validate
 * cached values (the DB may hold stale/poisoned URLs from old bugs). */
export function playerSrcMatchesId(rawUrl: string, matchId: number): boolean {
  try {
    let candidate = rawUrl.trim();
    if (candidate.startsWith("//")) candidate = `https:${candidate}`;
    const url = new URL(candidate);
    return Number(url.searchParams.get("match")) === matchId;
  } catch {
    return false;
  }
}

/** Validate whether a player URL is safe to embed for the given match id.
 * Rejects invalid URLs, mismatched match IDs, block IDs (< 1_000_000),
 * URLs without a key, and URLs on hosts known to serve broken players. */
export function isPlayerUrlValid(
  rawUrl: string | null | undefined,
  matchId: number,
): boolean {
  if (!rawUrl || !isRealMatchId(matchId)) return false;
  try {
    let candidate = rawUrl.trim();
    if (candidate.startsWith("//")) candidate = `https:${candidate}`;
    const url = new URL(candidate);
    if (url.protocol !== "https:" && url.protocol !== "http:") return false;
    if (POISONED_PLAYER_HOST_SUFFIXES.some((s) => url.hostname.endsWith(s))) {
      return false;
    }
    const current = url.searchParams.get("match");
    if (current === null || Number(current) !== matchId) return false;
    if (!url.searchParams.get("key")) return false;
    return true;
  } catch {
    return false;
  }
}

export interface ExtractedSourcePage {
  matchId: number | null;
  partnerId: string | null;
  playerSrc: string | null;
}

/** Extract real match ID, partner ID, and/or player URL from the HTML of
 * an internal watch / SEO page on the source site. */
export function extractFromSourcePage(html: string): ExtractedSourcePage {
  if (!html) return { matchId: null, partnerId: null, playerSrc: null };

  let matchId: number | null = null;
  let partnerId: string | null = null;
  let playerSrc: string | null = null;

  // 1. Check window.__playerSrc in scripts
  const pSrcMatch = html.match(
    /window\.__playerSrc\s*=\s*['"]((?:https?:)?\/\/[^'"]+)['"]/,
  );
  if (pSrcMatch?.[1]) {
    const unescaped = unescapeUrl(pSrcMatch[1]);
    const { id, partnerId: pId } = extractIdAndPartnerFromUrl(unescaped);
    if (id && isRealMatchId(id)) matchId = id;
    if (pId) partnerId = pId;
    playerSrc = unescaped;
  }

  // 2. Check all iframe src attributes
  const iframeRe = /<iframe\s+[^>]*src\s*=\s*["']([^"']+)["'][^>]*>/gi;
  let ifm: RegExpExecArray | null;
  while ((ifm = iframeRe.exec(html)) !== null) {
    const src = decodeEntities(ifm[1]);
    const { id, partnerId: pId } = extractIdAndPartnerFromUrl(src);
    if (id && isRealMatchId(id)) {
      if (!matchId) matchId = id;
      if (pId && !partnerId) partnerId = pId;
    }
    if (!playerSrc && (src.includes("playerv5.php") || src.includes(".sirtv.top"))) {
      playerSrc = src;
    }
  }

  // 3. Check all anchor href attributes
  const anchors = collectAnchors(html);
  for (const a of anchors) {
    if (a.mId && isRealMatchId(a.mId)) {
      if (!matchId) matchId = a.mId;
      if (a.partnerId && !partnerId) partnerId = a.partnerId;
    }
  }

  // 4. Check query params in entire text (e.g. ?m=4716556 or ?match=4716556)
  if (!matchId) {
    const rawMatch = html.match(/[?&](?:m|match)=(\d{6,})/);
    if (rawMatch) matchId = Number(rawMatch[1]);
  }

  // 5. Check hard URL pattern in entire text
  if (!partnerId) {
    const hardMatch = html.match(/hard\/[a-f0-9]{12}(\w+)\.html/i);
    if (hardMatch) partnerId = hardMatch[1];
  }

  return { matchId, partnerId, playerSrc };
}

/** Extract the iframe src for a match from the provider's hard page.
 * ONLY accepts values assigned to window.__playerSrc — never a random
 * playerv5.php URL found elsewhere in the page (that produced broken
 * "الرابط غير صحيح" players). The final URL is forced to carry the
 * requested match id. */
export function extractPlayerSrc(html: string, matchId: number): string | null {
  // Pattern 1: JS concatenation
  //   window.__playerSrc = 'https://host/playerv5.php?match=' + encodeURIComponent(m) + '&key=...'
  const concat = html.match(
    /window\.__playerSrc\s*=\s*['"]((?:https?:)?\/\/[^'"]*)['"]\s*\+\s*encodeURIComponent\([a-zA-Z]+\)\s*\+\s*['"]([^'"]*)['"]/,
  );
  if (concat?.[1] !== undefined && concat[1] !== null && concat[1] !== "") {
    const built = unescapeUrl(
      concat[1] + encodeURIComponent(String(matchId)) + concat[2],
    );
    return enforceMatchParam(built, matchId);
  }

  // Pattern 2: full pre-built URL assigned to window.__playerSrc.
  const full = html.match(
    /window\.__playerSrc\s*=\s*['"]((?:https?:)?\/\/[^'"]+)['"]/,
  );
  if (full?.[1]) {
    return enforceMatchParam(unescapeUrl(full[1]), matchId);
  }

  return null;
}

/** The provider's placeholder shown whenever no broadcast exists for the
 * requested match (finished, not started yet, unknown id, or simply not
 * covered). If we see it there is no player to embed — show a proper
 * Arabic state instead of a broken iframe. */
const ENDED_MARKERS = [
  "This match has ended",
  "انتهت هذه المباراة",
  "انتهى بث هذه المباراة",
  "لم يتم توفير رقم المباراة",
];

export function detectEndedState(html: string): boolean {
  return ENDED_MARKERS.some((marker) => html.includes(marker));
}

/* ------------------------------------------------------------------ */
/* Broadcast-day boundaries                                            */
/* ------------------------------------------------------------------ */

/** Late-night matches (anything before ~04:00 UTC, i.e. after midnight in
 * Morocco / before dawn in the Gulf) belong to the previous match day,
 * exactly like TV schedules. Without this, a 00:30 Casablanca kickoff
 * vanished from "today" the moment the UTC date rolled over. */
export const BROADCAST_DAY_START_UTC_HOUR = 3;

export function broadcastDayOf(d: Date = new Date()): string {
  const shifted = new Date(d.getTime() - BROADCAST_DAY_START_UTC_HOUR * 3_600_000);
  return shifted.toISOString().slice(0, 10);
}

export function broadcastDayRange(dateISO: string): { start: Date; end: Date } {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateISO)) {
    throw new Error(`invalid broadcast day: ${dateISO}`);
  }
  const start = new Date(
    Date.parse(`${dateISO}T00:00:00Z`) + BROADCAST_DAY_START_UTC_HOUR * 3_600_000,
  );
  return { start, end: new Date(start.getTime() + 24 * 3_600_000) };
}

/* ------------------------------------------------------------------ */
/* Status self-healing                                                 */
/* ------------------------------------------------------------------ */

/** The source listing lags at night. If the kickoff has passed the match
 * is live whether the source says so or not — otherwise the watch page
 * would wait forever and never resolve a player. */
export function flippedStatus(
  status: MatchStatus,
  startTimeISO: string,
  now: number,
): MatchStatus {
  const kickoff = Date.parse(startTimeISO);
  if (!Number.isFinite(kickoff)) return status;
  if (status === "upcoming" && now >= kickoff + 3 * 60_000) return "live";
  return status;
}

/* ------------------------------------------------------------------ */
/* Game ↔ row sanity check                                             */
/* ------------------------------------------------------------------ */

export interface GameLike {
  homeCompetitor?: { name?: string } | null;
  awayCompetitor?: { name?: string } | null;
  startTime?: string | null;
}

/** Make sure a koora-l game object really describes the DB row we are
 * about to render it for. With a wrong match id koora happily returns a
 * random old game, which used to paint a different match's scoreboard
 * under the player. */
export function gameMatchesRow(
  game: GameLike | null | undefined,
  row: { homeName: string; awayName: string; startTime: Date | string },
): boolean {
  if (!game) return false;
  const gh = game.homeCompetitor?.name;
  const ga = game.awayCompetitor?.name;
  if (!gh || !ga) return false;
  const nh = normalizeName(gh);
  const na = normalizeName(ga);
  const rh = normalizeName(row.homeName);
  const ra = normalizeName(row.awayName);
  if (!nh || !na || !rh || !ra) return false;
  const namesOk = (nh === rh && na === ra) || (nh === ra && na === rh); // tolerate inverted home/away
  const t1 = Date.parse(game.startTime ?? "");
  const t2 =
    typeof row.startTime === "string"
      ? Date.parse(row.startTime)
      : row.startTime.getTime();
  const timeOk =
    !Number.isFinite(t1) || !Number.isFinite(t2)
      ? true // cannot judge — trust the names
      : Math.abs(t1 - t2) <= 36 * 3_600_000;
  return namesOk && timeOk;
}
