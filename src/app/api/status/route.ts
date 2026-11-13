import { db } from "@/db";
import { matchesTable } from "@/db/schema";
import { fetchText, parseSiirHtml } from "@/lib/source";
import { sql } from "drizzle-orm";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Self-diagnostic endpoint — open /api/status in the browser on Vercel to
 * see exactly where the pipeline breaks (env → db → table → source).
 */
export async function GET() {
  const checks: Record<string, unknown> = {
    now: new Date().toISOString(),
    databaseUrlSet: Boolean(process.env.DATABASE_URL),
    databaseUrlHost: process.env.DATABASE_URL
      ? (() => {
          try {
            return new URL(process.env.DATABASE_URL).host;
          } catch {
            return "unparseable";
          }
        })()
      : null,
    siteUrl:
      process.env.NEXT_PUBLIC_SITE_URL ??
      process.env.NEXT_PUBLIC_VERCEL_URL ??
      process.env.VERCEL_URL ??
      "not-set",
  };

  // 1) Can we even reach Postgres?
  try {
    await db.execute(sql`select 1`);
    checks.dbConnect = "ok";
  } catch (err) {
    checks.dbConnect = "failed";
    checks.dbError = err instanceof Error ? err.message : String(err);
    return Response.json({ ok: false, stage: "dbConnect", checks }, { status: 500 });
  }

  // 2) Does the matches table exist / is it reachable?
  try {
    const res = await db.execute(sql`select count(*)::int as n from matches`);
    checks.tableExists = "ok";
    checks.rowCount = (res as unknown as { rows?: { n: number }[] }).rows?.[0]?.n ?? 0;
  } catch (err) {
    checks.tableExists = "missing";
    checks.tableError = err instanceof Error ? err.message : String(err);
  }

  // 3) Can this datacenter fetch the source site?
  try {
    const html = await fetchText("https://tvsiir.co/", 12_000, 0);
    const parsed = parseSiirHtml(html);
    checks.sourceFetch = "ok";
    checks.sourceBytes = html.length;
    checks.sourceParsed = parsed.length;
  } catch (err) {
    checks.sourceFetch = "blocked-or-failed";
    checks.sourceError = err instanceof Error ? err.message : String(err);
  }

  // 4) Sample rows
  try {
    const sample = await db.select({ id: matchesTable.matchId, home: matchesTable.homeName }).from(matchesTable).limit(3);
    checks.sampleRows = sample;
  } catch {
    checks.sampleRows = [];
  }

  return Response.json({ ok: true, checks });
}
