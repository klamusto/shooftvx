import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

/**
 * Cached matches scraped from the source provider (tvsiir.co) and enriched
 * with live data from koora-l.live. The table acts as a smart cache:
 * rows are upserted on every scrape, and history accumulates so past days
 * remain browsable even though the source only lists today's matches.
 */
export const matchesTable = pgTable(
  "matches",
  {
    matchId: bigint("match_id", { mode: "number" }).primaryKey(),
    partnerId: text("partner_id").notNull().default("87350"),

    homeName: text("home_name").notNull(),
    awayName: text("away_name").notNull(),
    homeLogo: text("home_logo"),
    awayLogo: text("away_logo"),

    league: text("league"),
    competition: text("competition"),
    roundName: text("round_name"),

    startTime: timestamp("start_time", { withTimezone: true }).notNull(),

    status: text("status").notNull().default("upcoming"), // live | upcoming | finished
    statusLabel: text("status_label"), // مباشر / بعد قليل / لم تبدأ بعد / انتهت
    live: boolean("live").notNull().default(false),

    homeScore: integer("home_score"),
    awayScore: integer("away_score"),
    gameTime: text("game_time"), // e.g. 64'

    sourceUrl: text("source_url"), // provider match link
    watchUrl: text("watch_url"), // hard watch page
    playerSrc: text("player_src"), // resolved iframe src
    playerState: text("player_state"), // live | ended | unavailable (last resolution)
    playerResolvedAt: timestamp("player_resolved_at", { withTimezone: true }),

    gameJson: jsonb("game_json").$type<Record<string, unknown>>(),
    detailsJson: jsonb("details_json").$type<Record<string, unknown>>(),
    /** Goalscorers scraped from the source listing: { home: string[], away: string[] } */
    scorersJson: jsonb("scorers_json").$type<{ home: string[]; away: string[] } | null>(),

    firstSeen: timestamp("first_seen", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("matches_start_time_idx").on(t.startTime),
    index("matches_status_idx").on(t.status),
  ],
);

export type MatchRow = typeof matchesTable.$inferSelect;
export type NewMatchRow = typeof matchesTable.$inferInsert;
