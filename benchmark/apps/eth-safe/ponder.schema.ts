import { onchainTable } from "ponder";

export const safe = onchainTable("safe", (t) => ({
  id: t.text().primaryKey(),
  proxy: t.hex().notNull(),
  singleton: t.hex().notNull(),
  timestamp: t.integer().notNull(),
}));

export const safeSetup = onchainTable("safe_setup", (t) => ({
  id: t.text().primaryKey(),
  proxy: t.hex().notNull(),
  initiator: t.hex().notNull(),
  threshold: t.bigint().notNull(),
  timestamp: t.integer().notNull(),
}));

/** Any other Safe event: its arguments as JSON (bigints as decimal strings). */
export const safeEvent = onchainTable("safe_event", (t) => ({
  id: t.text().primaryKey(),
  proxy: t.hex().notNull(),
  name: t.text().notNull(),
  args: t.text().notNull(),
  timestamp: t.integer().notNull(),
}));
