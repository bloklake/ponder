import { onchainTable, primaryKey } from "ponder";

export const account = onchainTable("account", (t) => ({
  address: t.hex().primaryKey(),
  balance: t.bigint().notNull(),
}));

export const allowance = onchainTable(
  "allowance",
  (t) => ({
    owner: t.hex().notNull(),
    spender: t.hex().notNull(),
    amount: t.bigint().notNull(),
  }),
  (table) => ({ pk: primaryKey({ columns: [table.owner, table.spender] }) }),
);

export const transferEvent = onchainTable("transfer_event", (t) => ({
  id: t.text().primaryKey(),
  from: t.hex().notNull(),
  to: t.hex().notNull(),
  amount: t.bigint().notNull(),
  timestamp: t.integer().notNull(),
}));

export const approvalEvent = onchainTable("approval_event", (t) => ({
  id: t.text().primaryKey(),
  owner: t.hex().notNull(),
  spender: t.hex().notNull(),
  amount: t.bigint().notNull(),
  timestamp: t.integer().notNull(),
}));
