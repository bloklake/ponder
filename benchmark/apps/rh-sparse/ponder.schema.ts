import { onchainTable } from "ponder";

export const pair = onchainTable("pair", (t) => ({
  address: t.hex().primaryKey(),
  token0: t.hex().notNull(),
  token1: t.hex().notNull(),
  createdAt: t.bigint().notNull(),
  syncs: t.integer().notNull(),
}));

export const nobody = onchainTable("nobody", (t) => ({
  hash: t.hex().primaryKey(),
}));

export const checkpoint = onchainTable("checkpoint", (t) => ({
  number: t.bigint().primaryKey(),
  hash: t.hex().notNull(),
}));
