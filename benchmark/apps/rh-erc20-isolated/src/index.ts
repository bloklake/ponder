import { ponder } from "ponder:registry";
import {
  account,
  allowance,
  approvalEvent,
  transferEvent,
} from "ponder:schema";

ponder.on("Token:Transfer", async ({ event, context }) => {
  const chainId = context.chain.id;
  await context.db
    .insert(account)
    .values({ chainId, address: event.args.from, balance: 0n, isOwner: false })
    .onConflictDoUpdate((row) => ({
      balance: row.balance - event.args.value,
    }));

  await context.db
    .insert(account)
    .values({ chainId, address: event.args.to, balance: 0n, isOwner: false })
    .onConflictDoUpdate((row) => ({
      balance: row.balance + event.args.value,
    }));

  await context.db.insert(transferEvent).values({
    chainId,
    id: event.id,
    amount: event.args.value,
    timestamp: Number(event.block.timestamp),
    from: event.args.from,
    to: event.args.to,
  });
});

ponder.on("Token:Approval", async ({ event, context }) => {
  const chainId = context.chain.id;
  await context.db
    .insert(allowance)
    .values({
      chainId,
      spender: event.args.spender,
      owner: event.args.owner,
      amount: event.args.value,
    })
    .onConflictDoUpdate({ amount: event.args.value });

  await context.db.insert(approvalEvent).values({
    chainId,
    id: event.id,
    amount: event.args.value,
    timestamp: Number(event.block.timestamp),
    owner: event.args.owner,
    spender: event.args.spender,
  });
});
