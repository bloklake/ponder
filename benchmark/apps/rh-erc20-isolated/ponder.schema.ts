import { onchainTable, primaryKey } from "ponder";

export const account = onchainTable(
  "account",
  (t) => ({
    chainId: t.integer().notNull(),
    address: t.hex().notNull(),
    balance: t.bigint().notNull(),
    isOwner: t.boolean().notNull(),
  }),
  (table) => ({ pk: primaryKey({ columns: [table.chainId, table.address] }) }),
);

export const transferEvent = onchainTable(
  "transfer_event",
  (t) => ({
    chainId: t.integer().notNull(),
    id: t.text().notNull(),
    amount: t.bigint().notNull(),
    timestamp: t.integer().notNull(),
    from: t.hex().notNull(),
    to: t.hex().notNull(),
  }),
  (table) => ({ pk: primaryKey({ columns: [table.chainId, table.id] }) }),
);

export const allowance = onchainTable(
  "allowance",
  (t) => ({
    chainId: t.integer().notNull(),
    owner: t.hex().notNull(),
    spender: t.hex().notNull(),
    amount: t.bigint().notNull(),
  }),
  (table) => ({
    pk: primaryKey({ columns: [table.chainId, table.owner, table.spender] }),
  }),
);

export const approvalEvent = onchainTable(
  "approval_event",
  (t) => ({
    chainId: t.integer().notNull(),
    id: t.text().notNull(),
    amount: t.bigint().notNull(),
    timestamp: t.integer().notNull(),
    owner: t.hex().notNull(),
    spender: t.hex().notNull(),
  }),
  (table) => ({ pk: primaryKey({ columns: [table.chainId, table.id] }) }),
);
