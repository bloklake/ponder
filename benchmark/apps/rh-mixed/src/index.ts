import { ponder } from "ponder:registry";
import {
  account,
  allowance,
  approvalEvent,
  transferEvent,
} from "ponder:schema";
import { eq } from "ponder";

// Correctness app: like rh-erc20, plus `db.delete` and raw `db.sql` that start
// half-way through the range (exercises the pipeline fallback mid-run).
const SWITCH_BLOCK = BigInt(process.env.BENCH_SWITCH_BLOCK ?? 58_605_000);

ponder.on("Token:Transfer", async ({ event, context }) => {
  await context.db
    .insert(account)
    .values({ address: event.args.from, balance: 0n, isOwner: false })
    .onConflictDoUpdate((row) => ({
      balance: row.balance - event.args.value,
    }));

  await context.db
    .insert(account)
    .values({ address: event.args.to, balance: 0n, isOwner: false })
    .onConflictDoUpdate((row) => ({
      balance: row.balance + event.args.value,
      isOwner: !row.isOwner,
    }));

  await context.db.insert(transferEvent).values({
    id: event.id,
    amount: event.args.value,
    timestamp: Number(event.block.timestamp),
    from: event.args.from,
    to: event.args.to,
  });

  if (event.block.number >= SWITCH_BLOCK && event.log.logIndex % 37 === 0) {
    await context.db.delete(account, { address: event.args.to });
  }
});

ponder.on("Token:Approval", async ({ event, context }) => {
  await context.db
    .insert(allowance)
    .values({
      spender: event.args.spender,
      owner: event.args.owner,
      amount: event.args.value,
    })
    .onConflictDoUpdate({ amount: event.args.value });

  let amount = event.args.value;
  if (event.block.number >= SWITCH_BLOCK && event.log.logIndex % 11 === 0) {
    const rows = await context.db.sql
      .select()
      .from(account)
      .where(eq(account.address, event.args.owner));
    amount += rows[0]?.balance ?? 0n;
  }

  await context.db.insert(approvalEvent).values({
    id: event.id,
    amount,
    timestamp: Number(event.block.timestamp),
    owner: event.args.owner,
    spender: event.args.spender,
  });
});
