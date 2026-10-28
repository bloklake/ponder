import { ponder } from "ponder:registry";
import {
  account,
  allowance,
  approvalEvent,
  transferEvent,
} from "ponder:schema";

ponder.on("RETH:Transfer", async ({ event, context }) => {
  const { from, to, value } = event.args;
  // Note: Sequential, so a self-transfer nets to zero.
  await context.db
    .insert(account)
    .values({ address: from, balance: -value })
    .onConflictDoUpdate((row) => ({ balance: row.balance - value }));
  await context.db
    .insert(account)
    .values({ address: to, balance: value })
    .onConflictDoUpdate((row) => ({ balance: row.balance + value }));
  await context.db.insert(transferEvent).values({
    id: event.id,
    from,
    to,
    amount: value,
    timestamp: Number(event.block.timestamp),
  });
});

ponder.on("RETH:Approval", async ({ event, context }) => {
  const { owner, spender, value } = event.args;
  await context.db
    .insert(allowance)
    .values({ owner, spender, amount: value })
    .onConflictDoUpdate({ amount: value });
  await context.db.insert(approvalEvent).values({
    id: event.id,
    owner,
    spender,
    amount: value,
    timestamp: Number(event.block.timestamp),
  });
});
