import { onchainTable } from "ponder";

export const pool = onchainTable("pool", (t) => ({
  address: t.hex().primaryKey(),
  kind: t.text().notNull(),
  swaps: t.integer().notNull(),
  reserve0: t.bigint(),
  reserve1: t.bigint(),
  lastTick: t.integer(),
}));

export const swap = onchainTable("swap", (t) => ({
  id: t.text().primaryKey(),
  pool: t.hex().notNull(),
  sender: t.hex().notNull(),
  recipient: t.hex().notNull(),
  amount0: t.bigint().notNull(),
  amount1: t.bigint().notNull(),
  txFrom: t.hex().notNull(),
  timestamp: t.bigint().notNull(),
}));
