/**
 * Regression tests for the night-matching bug fix.
 *
 * Run with plain node (type stripping, no node_modules needed):
 *   node scripts/test-fix.ts
 *
 * Scenarios reproduced here were observed live against the real sources
 * (siir-tv.co / sir-tv.vip listing, yassirtv.com hard pages,
 * koora-l.live game JSON, 365scores schedule).
 */

import {
  broadcastDayOf,
  broadcastDayRange,
  dedupeByKey,
  detectEndedState,
  enforceMatchParam,
  extractFromSourcePage,
  extractIdAndPartnerFromUrl,
  extractPlayerSrc,
  PLAYER_STATIC_KEY,
  flippedStatus,
  gameMatchesRow,
  isPlayerUrlValid,
  isRealMatchId,
  mapStatusLabel,
  matchKey,
  normalizeName,
  parseDataStart,
  parseSiirHtml,
  pickBest,
  playerSrcMatchesId,
} from "../src/lib/parse.ts";

let failures = 0;
let passes = 0;

function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) {
    passes += 1;
    console.log(`  ✓ ${name}`);
  } else {
    failures += 1;
    console.log(`  ✗ ${name}`, extra !== undefined ? JSON.stringify(extra) : "");
  }
}

/* ------------------------------------------------------------------ */
console.log("\n[1] siir listing — evening render (provider ?m= links present)");
{
  const html = `
  <div class="AY_Match live" id="m-5883" data-start="2026-09-27T18:55:00+00:00">
    <div class="TM_Logo"><img alt="اليمن" src="https://sir-tv.vip/yemen.webp"/></div>
    <div class="TM_Name">اليمن</div>
    <div class="TM_Logo"><img alt="قطر" src="https://sir-tv.vip/qatar.webp"/></div>
    <div class="TM_Name">قطر</div>
    <span class='MT_Time'><span>21:55</span></span>
    <span class="MT_Result"><span class="RS-goals">0</span><span class="RS-goals">0</span></span>
    <div class='MT_Stat'>مباشر</div>
    <a href="https://korat.hes-goals.mov/?m=4716556&p=87350" title="اليمن × قطر — بث مباشر | كأس الخليج"></a>
  </div>
  <div class="AY_Match" id="m-5884" data-start="2026-09-27 20:00:00">
    <div class="TM_Logo"><img alt="الكوكب المراكشي" src="https://sir-tv.vip/kac.webp"/></div>
    <div class="TM_Name">الكوكب المراكشي</div>
    <div class="TM_Logo"><img alt="حسنية أكادير" src="https://sir-tv.vip/hus.webp"/></div>
    <div class="TM_Name">حسنية أكادير</div>
    <span class='MT_Time'><span>21:00</span></span>
    <div class='MT_Stat'>لم تبدأ بعد</div>
    <a href="https://korat.hes-goals.mov/?m=4859468&p=87350" title="الدوري المغربي | الكوكب ضد حسنية"></a>
  </div>`;
  const parsed = parseSiirHtml(html);
  check("parses both matches", parsed.length === 2, parsed.length);
  const yemen = parsed.find((p) => p.homeName === "اليمن");
  const kawkab = parsed.find((p) => p.homeName === "الكوكب المراكشي");
  check("uses the ?m= id (real provider id)", yemen?.matchId === 4716556, yemen?.matchId);
  check("idSource is 'm'", yemen?.idSource === "m");
  check("partner id captured", yemen?.partnerId === "87350");
  check("live status detected", yemen?.status === "live");
  check("upcoming status detected", kawkab?.status === "upcoming");
  check("league extracted from title", yemen?.league === "كأس الخليج", yemen?.league);
  check("watch url built from the real id", yemen?.watchUrl === "https://n2.sirftv.com/hard/2908c7d4425d87350.html?match=4716556", yemen?.watchUrl);
  check("naive data-start parsed as UTC", kawkab?.startTime === "2026-09-27T20:00:00.000Z", kawkab?.startTime);
}

/* ------------------------------------------------------------------ */
console.log("\n[2] siir listing — night render (SEO links only, no ?m=)");
{
  const html = `
  <div class="AY_Match" id="m-5902" data-start="2026-09-27T20:00:00Z">
    <div class="TM_Logo"><img alt="الكوكب المراكشي" src="https://sir-tv.vip/kac.webp"/></div>
    <div class="TM_Name">الكوكب المراكشي</div>
    <div class="TM_Logo"><img alt="حسنية أكادير" src="https://sir-tv.vip/hus.webp"/></div>
    <div class="TM_Name">حسنية أكادير</div>
    <span class='MT_Time'><span>21:00</span></span>
    <div class='MT_Stat'>مباشر</div>
    <a href="https://sir-tv.vip/matches/watch-%d8%a7%d9%84%d9%83%d9%88%d9%83%d8%a8-vs-%d8%ad%d8%b3%d9%86%d9%8a%d8%a9-2026-09-27/" title="الدوري المغربي | بث الكوكب المراكشي ضد حسنية أكادير"></a>
  </div>`;
  const parsed = parseSiirHtml(html);
  check("match still parsed", parsed.length === 1, parsed.length);
  check("falls back to the block id", parsed[0]?.matchId === 5902, parsed[0]?.matchId);
  check("idSource flags the fallback", parsed[0]?.idSource === "block");
  check("block id is not a real provider id", !isRealMatchId(parsed[0]?.matchId ?? 0));
  check("real provider id is recognized", isRealMatchId(4859468));
}

/* ------------------------------------------------------------------ */
console.log("\n[3] siir listing — SEO link first, provider link second in the block");
{
  const html = `
  <div class="AY_Match" id="m-5910" data-start="2026-09-27T20:00:00Z">
    <div class="TM_Logo"><img alt="الكوكب المراكشي" src="a.webp"/></div>
    <div class="TM_Name">الكوكب المراكشي</div>
    <div class="TM_Logo"><img alt="حسنية أكادير" src="b.webp"/></div>
    <div class="TM_Name">حسنية أكادير</div>
    <div class='MT_Stat'>مباشر</div>
    <a href="https://sir-tv.vip/matches/watch-x-vs-y-2026-09-27/" title="الدوري المغربي"></a>
    <a href="https://korat.hes-goals.mov/?m=4859468&p=87350" title="بث مباشر"></a>
  </div>`;
  const parsed = parseSiirHtml(html);
  check("prefers the provider anchor anywhere in the block", parsed[0]?.matchId === 4859468, parsed[0]?.matchId);
  check("idSource is 'm'", parsed[0]?.idSource === "m");
}

/* ------------------------------------------------------------------ */
console.log("\n[4] siir listing — one broken block must not kill the sync");
{
  const html = `
  <div class="AY_Match" id="m-bad" data-start="قريباً">
    <div class="TM_Name">x</div>
  </div>
  <div class="AY_Match" id="m-5911" data-start="2026-09-27T20:00:00Z">
    <div class="TM_Logo"><img alt="الكوكب المراكشي" src="a.webp"/></div>
    <div class="TM_Name">الكوكب المراكشي</div>
    <div class="TM_Logo"><img alt="حسنية أكادير" src="b.webp"/></div>
    <div class="TM_Name">حسنية أكادير</div>
    <div class='MT_Stat'>مباشر</div>
    <a href="https://sir-tv.vip/matches/watch-x/" title="الدوري المغربي"></a>
  </div>`;
  let parsed: ReturnType<typeof parseSiirHtml> = [];
  let threw = false;
  try {
    parsed = parseSiirHtml(html);
  } catch {
    threw = true;
  }
  check("does not throw", !threw);
  check("healthy block still parsed", parsed.length === 1 && parsed[0]?.matchId === 5911, parsed.length);
}

/* ------------------------------------------------------------------ */
console.log("\n[5] player extraction — only window.__playerSrc, always our match id");
{
  // (a) correct full URL → served as-is
  const a = extractPlayerSrc(
    `<script>window.__playerSrc='https://912acsss8af382.yasirtv.com/playerv5.php?match=4716556&key=9f39';</script>`,
    4716556,
  );
  check("valid player url returned as-is", a === "https://912acsss8af382.yasirtv.com/playerv5.php?match=4716556&key=9f39", a);

  // (b) URL pointing at a DIFFERENT match (provider default/live stream on
  // a placeholder page) → forced back to our match id
  const b = extractPlayerSrc(
    `<script>window.__playerSrc='https://912acsss8af382.yasirtv.com/playerv5.php?match=4800115&key=9f39';</script>`,
    4716556,
  );
  check("foreign match id replaced with ours", b === "https://912acsss8af382.yasirtv.com/playerv5.php?match=4716556&key=9f39", b);

  // (c) JS concatenation form
  const c = extractPlayerSrc(
    `<script>window.__playerSrc = 'https://host.yasirtv.com/playerv5.php?match=' + encodeURIComponent(m) + '&key=K';</script>`,
    4859468,
  );
  check("concat form built with our id", c === "https://host.yasirtv.com/playerv5.php?match=4859468&key=K", c);

  // (d) THE OLD BUG: a playerv5.php URL somewhere in the page with no
  // __playerSrc assignment → must return null (the old "Pattern 3"
  // appended the match id to it and produced "الرابط غير صحيح").
  const d = extractPlayerSrc(
    `<script>var adlink="https://912acsss8af382.yasirtv.com/playerv5.php?key=9f39";</script>`,
    4716556,
  );
  check("stray playerv5 url is NOT used", d === null, d);

  // (e) __playerSrc with no match param → id appended
  const e = extractPlayerSrc(
    `<script>window.__playerSrc='https://h2.yasirtv.com/playerv5.php?key=K';</script>`,
    4716556,
  );
  check("missing match param appended", e === "https://h2.yasirtv.com/playerv5.php?key=K&match=4716556", e);

  // (f) protocol-relative URL
  const f = extractPlayerSrc(
    `<script>window.__playerSrc='//h2.yasirtv.com/playerv5.php?match=4716556&key=K';</script>`,
    4716556,
  );
  check("protocol-relative url handled", f === "https://h2.yasirtv.com/playerv5.php?match=4716556&key=K", f);

  // (g) ended/placeholder page has no assignment at all
  const g = extractPlayerSrc(
    `<html><body><h1>This match has ended</h1><h2>انتهت هذه المباراة</h2></body></html>`,
    4716556,
  );
  check("ended page yields no player url", g === null, g);
}

/* ------------------------------------------------------------------ */
console.log("\n[6] provider placeholder detection");
{
  check(
    "ended markers detected (EN)",
    detectEndedState(`<html><body>Match ended — This match has ended — Full time</body></html>`),
  );
  check(
    "ended markers detected (AR)",
    detectEndedState(`<html><body>انتهى بث هذه المباراة. عد إلى جدول المباريات</body></html>`),
  );
  check(
    "missing match id notice detected",
    detectEndedState(`<html><body>لم يتم توفير رقم المباراة</body></html>`),
  );
  check(
    "live page not flagged",
    !detectEndedState(`<html><body><script>window.__playerSrc='https://x/playerv5.php?match=1&key=2';</script></body></html>`),
  );
}

/* ------------------------------------------------------------------ */
console.log("\n[7] player url validation helpers");
{
  check("matching id accepted", playerSrcMatchesId("https://h/playerv5.php?match=4716556&key=K", 4716556));
  check("mismatched id rejected", !playerSrcMatchesId("https://h/playerv5.php?match=4800115&key=K", 4716556));
  check("missing id rejected", !playerSrcMatchesId("https://h/playerv5.php?key=K", 4716556));
  check("protocol-relative accepted", playerSrcMatchesId("//h/playerv5.php?match=4716556", 4716556));
  const fixed = enforceMatchParam("https://h/playerv5.php?match=WRONG&key=K&match=4716556", 4716556);
  check("double match param collapsed to ours", fixed === "https://h/playerv5.php?match=4716556&key=K", fixed);
  check("garbage url rejected", enforceMatchParam("not a url", 1) === null);

  // isPlayerUrlValid: rejects block IDs, rejects dummy fallback key
  check("valid live player URL accepted", isPlayerUrlValid("https://h/playerv5.php?match=4716556&key=realToken123", 4716556));
  check("block ID rejected", !isPlayerUrlValid("https://h/playerv5.php?match=7503&key=realToken123", 7503));
  check("static dummy fallback key rejected", !isPlayerUrlValid(`https://912acsss8af382.yasirtv.com/playerv5.php?match=4716556&key=${PLAYER_STATIC_KEY}`, 4716556));
  check("poisoned yasirtv host rejected", !isPlayerUrlValid("https://912acsss8af382.yasirtv.com/playerv5.php?match=4716556&key=K", 4716556));
  check("real sirftv player accepted", isPlayerUrlValid(`https://912acsss8af382.sirtv.top/playerv5.php?match=4716556&key=${PLAYER_STATIC_KEY}`, 4716556));
  check("missing key rejected", !isPlayerUrlValid("https://h/playerv5.php?match=4716556", 4716556));
}

/* ------------------------------------------------------------------ */
console.log("\n[8] dedup prefers real provider ids over block ids");
{
  const rows = [
    {
      matchId: 5902, // block id — link broken at the provider
      homeName: "الكوكب المراكشي",
      awayName: "حسنية أكادير",
      startTime: "2026-09-27T20:00:00.000Z",
      status: "live",
      updatedAt: new Date("2026-09-27T20:30:00Z"),
    },
    {
      matchId: 4859468, // real provider id
      homeName: "الكوكب المراكشي",
      awayName: "حسنية أكادير",
      startTime: "2026-09-27T20:00:00.000Z",
      status: "finished",
      updatedAt: new Date("2026-09-27T19:00:00Z"),
    },
  ];
  const best = pickBest(rows);
  check("real id wins even when the block row looks 'fresher'", best?.matchId === 4859468, best?.matchId);
  const deduped = dedupeByKey(rows);
  check("duplicate collapsed to one row with the real id", deduped.length === 1 && deduped[0]?.matchId === 4859468);
}

/* ------------------------------------------------------------------ */
console.log("\n[9] name normalization + match keys");
{
  check("alef variants collapse", normalizeName("الأهلي") === normalizeName("الاهلي"));
  check("ta-marbuta collapses", normalizeName("نهضة بركان") === normalizeName("نهضه بركان"));
  check("yaa/alef maqsura collapse", normalizeName("مستقبل") === normalizeName("مستقبٌل".replace("ٌ", "")));
  check("latin case folded", normalizeName("Wydad AC") === normalizeName("wydad ac"));
  check(
    "match key tolerant to spelling + 15-minute drift",
    matchKey({ homeName: "الكوكب المراكشي", awayName: "حسنية أكادير", startTime: "2026-09-27T20:00:00.000Z" }) ===
      matchKey({ homeName: "الكوكب المراكشى", awayName: "حسنيه أكادير", startTime: "2026-09-27T20:15:00.000Z" }),
  );
  check(
    "match key differs for different fixtures",
    matchKey({ homeName: "أ", awayName: "ب", startTime: "2026-09-27T20:00:00.000Z" }) !==
      matchKey({ homeName: "ج", awayName: "د", startTime: "2026-09-27T20:00:00.000Z" }),
  );
}

/* ------------------------------------------------------------------ */
console.log("\n[10] data-start parsing");
{
  check("zoned offset", parseDataStart("2026-09-27T18:55:00+03:00") === "2026-09-27T15:55:00.000Z", parseDataStart("2026-09-27T18:55:00+03:00"));
  check("Z suffix", parseDataStart("2026-09-27T15:55:00Z") === "2026-09-27T15:55:00.000Z");
  check("naive space form → UTC", parseDataStart("2026-09-27 15:55") === "2026-09-27T15:55:00.000Z", parseDataStart("2026-09-27 15:55"));
  check("naive seconds form → UTC", parseDataStart("2026-09-27 15:55:00") === "2026-09-27T15:55:00.000Z");
  check("garbage rejected", parseDataStart("قريباً") === null);
  check("empty rejected", parseDataStart("") === null);
  check("date-only rejected", parseDataStart("2026-09-27") === null);
}

/* ------------------------------------------------------------------ */
console.log("\n[11] broadcast day (late-night matches stay on today's list)");
{
  check(
    "20:00 UTC stays on its day",
    broadcastDayOf(new Date("2026-09-27T20:00:00Z")) === "2026-09-27",
  );
  check(
    "01:30 UTC (after midnight in Morocco) belongs to the previous day",
    broadcastDayOf(new Date("2026-09-28T01:30:00Z")) === "2026-09-27",
  );
  check(
    "02:59 UTC still previous day",
    broadcastDayOf(new Date("2026-09-28T02:59:59Z")) === "2026-09-27",
  );
  check(
    "03:00 UTC starts a new day",
    broadcastDayOf(new Date("2026-09-28T03:00:00Z")) === "2026-09-28",
  );
  const r = broadcastDayRange("2026-09-27");
  check("day window starts at 03:00Z", r.start.toISOString() === "2026-09-27T03:00:00.000Z", r.start.toISOString());
  check("day window spans 24h", r.end.toISOString() === "2026-09-28T03:00:00.000Z");
  let threw = false;
  try {
    broadcastDayRange("not-a-date");
  } catch {
    threw = true;
  }
  check("invalid day rejected", threw);
}

/* ------------------------------------------------------------------ */
console.log("\n[12] status self-healing (source lags at night)");
{
  const now = Date.parse("2026-09-27T20:05:00Z");
  check(
    "upcoming past kickoff flips to live",
    flippedStatus("upcoming", "2026-09-27T20:00:00.000Z", now) === "live",
  );
  check(
    "upcoming before kickoff stays upcoming",
    flippedStatus("upcoming", "2026-09-27T20:00:00.000Z", now - 10 * 60_000) === "upcoming",
  );
  check(
    "flips to live 3+ minutes after kickoff",
    flippedStatus("upcoming", "2026-09-27T20:00:00.000Z", Date.parse("2026-09-27T20:04:00Z")) === "live",
  );
  check(
    "still upcoming 2 minutes after kickoff (grace window)",
    flippedStatus("upcoming", "2026-09-27T20:00:00.000Z", Date.parse("2026-09-27T20:02:00Z")) === "upcoming",
  );
  check(
    "live stays live",
    flippedStatus("live", "2026-09-27T20:00:00.000Z", now) === "live",
  );
}

/* ------------------------------------------------------------------ */
console.log("\n[13] koora game ↔ row guard (no foreign scoreboards)");
{
  const yemenQatarGame = {
    homeCompetitor: { name: "اليمن" },
    awayCompetitor: { name: "قطر" },
    startTime: "2026-09-27T15:55:00+00:00",
  };
  const yemenRow = { homeName: "اليمن", awayName: "قطر", startTime: "2026-09-27T15:55:00.000Z" };
  check("matching game accepted", gameMatchesRow(yemenQatarGame, yemenRow));
  const kawkabRow = { homeName: "الكوكب المراكشي", awayName: "حسنية أكادير", startTime: "2026-09-27T20:00:00.000Z" };
  check("foreign game rejected", !gameMatchesRow(yemenQatarGame, kawkabRow));
  const oldGame = {
    homeCompetitor: { name: "بارما" },
    awayCompetitor: { name: "كاتانيا" },
    startTime: "2026-04-12T13:00:00+00:00",
  };
  check("old random game rejected (koora returns these for bad ids)", !gameMatchesRow(oldGame, kawkabRow));
  const inverted = {
    homeCompetitor: { name: "قطر" },
    awayCompetitor: { name: "اليمن" },
    startTime: "2026-09-27T15:55:00+00:00",
  };
  check("home/away inversion tolerated", gameMatchesRow(inverted, yemenRow));
  const shiftedRow = { homeName: "اليمن", awayName: "قطر", startTime: "2026-09-27T18:55:00.000Z" };
  check("timezone-shifted row still accepted (within 36h)", gameMatchesRow(yemenQatarGame, shiftedRow));
  check("null game rejected", !gameMatchesRow(null, yemenRow));
}

/* ------------------------------------------------------------------ */
console.log("\n[14] status labels");
{
  check("مباشر → live", mapStatusLabel("مباشر").status === "live");
  check("انتهت → finished", mapStatusLabel("انتهت").status === "finished");
  check("لم تبدأ بعد → upcoming", mapStatusLabel("لم تبدأ بعد").status === "upcoming");
  check("بعد قليل → upcoming", mapStatusLabel("بعد قليل").status === "upcoming");
}

/* ------------------------------------------------------------------ */
console.log("\n[15] URL extraction variations (?match=, ?m=, hard pages)");
{
  const p1 = extractIdAndPartnerFromUrl("https://n2.sirftv.com/hard/2908c7d4425d87350.html?match=4716556");
  check("extracts from hard match url", p1.id === 4716556 && p1.partnerId === "87350");

  const p2 = extractIdAndPartnerFromUrl("https://korat.hes-goals.mov/?m=4859468&p=99999");
  check("extracts from m param with custom partner", p2.id === 4859468 && p2.partnerId === "99999");

  const p3 = extractIdAndPartnerFromUrl("https://example.com/playerv5.php?match=4859468&key=xyz");
  check("extracts from playerv5 match param", p3.id === 4859468);
}

/* ------------------------------------------------------------------ */
console.log("\n[16] source watch / SEO page extraction");
{
  const sourceHtml = `
  <html>
    <head><title>مشاهدة مباراة الكوكب ضد حسنية</title></head>
    <body>
      <div class="player-container">
        <iframe src="https://n2.sirftv.com/hard/2908c7d4425d87350.html?match=4859468" width="100%" height="500"></iframe>
      </div>
    </body>
  </html>`;
  const ext = extractFromSourcePage(sourceHtml);
  check("extracts real match ID from iframe in source page", ext.matchId === 4859468);
  check("extracts partner ID from iframe in source page", ext.partnerId === "87350");
}

/* ------------------------------------------------------------------ */
console.log("\n[17] end-to-end identity: evening row repaired when the real id appears");
{
  // Evening: match was first seen through a block id (SEO-only listing).
  const nightListing = `
  <div class="AY_Match" id="m-5902" data-start="2026-09-27T20:00:00Z">
    <div class="TM_Logo"><img alt="الكوكب المراكشي" src="a.webp"/></div>
    <div class="TM_Name">الكوكب المراكشي</div>
    <div class="TM_Logo"><img alt="حسنية أكادير" src="b.webp"/></div>
    <div class="TM_Name">حسنية أكادير</div>
    <div class='MT_Stat'>مباشر</div>
    <a href="https://sir-tv.vip/matches/watch-x/" title="الدوري المغربي"></a>
  </div>`;
  const nightParsed = parseSiirHtml(nightListing);
  check("night parse → block id", nightParsed[0]?.matchId === 5902 && nightParsed[0]?.idSource === "block");

  // Later the source exposes the provider link (this is the moment the old
  // carry-over logic kept the broken block id forever).
  const liveListing = nightListing.replace(
    `<a href="https://sir-tv.vip/matches/watch-x/" title="الدوري المغربي"></a>`,
    `<a href="https://korat.hes-goals.mov/?m=4859468&p=87350" title="الدوري المغربي"></a>`,
  );
  const liveParsed = parseSiirHtml(liveListing);
  check("provider link appears → real id used", liveParsed[0]?.matchId === 4859468 && liveParsed[0]?.idSource === "m");
  check(
    "watch url now points at the provider's real match",
    liveParsed[0]?.watchUrl === "https://n2.sirftv.com/hard/2908c7d4425d87350.html?match=4859468",
  );
}

/* ------------------------------------------------------------------ */
console.log(
  `\n${passes} passed, ${failures} failed${failures === 0 ? " ✅" : " ❌"}`,
);
process.exit(failures === 0 ? 0 : 1);
