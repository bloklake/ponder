import { onchainTable, primaryKey } from "ponder";

export const pool = onchainTable("pool", (t) => ({
  address: t.hex().primaryKey(),
  token0: t.hex().notNull(),
  token1: t.hex().notNull(),
  reserve0: t.bigint().notNull(),
  reserve1: t.bigint().notNull(),
  balance0: t.bigint().notNull(),
  syncs: t.integer().notNull(),
}));

export const poolHourData = onchainTable(
  "pool_hour_data",
  (t) => ({
    pool: t.hex().notNull(),
    hour: t.bigint().notNull(),
    syncs: t.integer().notNull(),
    lastReserve0: t.bigint().notNull(),
    lastBalance0: t.bigint().notNull(),
    lastBlockTimestamp: t.bigint().notNull(),
  }),
  (table) => ({ pk: primaryKey({ columns: [table.pool, table.hour] }) }),
);
