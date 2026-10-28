import { onchainTable } from "ponder";

export const counter = onchainTable("counter", (t) => ({
  id: t.integer().primaryKey(),
}));
