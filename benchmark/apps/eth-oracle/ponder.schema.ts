import { onchainTable } from "ponder";

export const price = onchainTable("price", (t) => ({
  block: t.bigint().primaryKey(),
  timestamp: t.bigint().notNull(),
  roundId: t.bigint().notNull(),
  answer: t.bigint().notNull(),
  updatedAt: t.bigint().notNull(),
}));
