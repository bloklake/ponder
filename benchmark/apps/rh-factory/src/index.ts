import { ponder } from "ponder:registry";
import { pool, swap } from "ponder:schema";

ponder.on("PairV2:Swap", async ({ event, context }) => {
  await context.db
    .insert(pool)
    .values({ address: event.log.address, kind: "v2", swaps: 1 })
    .onConflictDoUpdate((row) => ({ swaps: row.swaps + 1 }));
  await context.db.insert(swap).values({
    id: event.id,
    pool: event.log.address,
    sender: event.args.sender,
    recipient: event.args.to,
    amount0: event.args.amount0In - event.args.amount0Out,
    amount1: event.args.amount1In - event.args.amount1Out,
    txFrom: event.transaction.from,
    timestamp: event.block.timestamp,
  });
});

ponder.on("PairV2:Sync", async ({ event, context }) => {
  await context.db
    .insert(pool)
    .values({
      address: event.log.address,
      kind: "v2",
      swaps: 0,
      reserve0: event.args.reserve0,
      reserve1: event.args.reserve1,
    })
    .onConflictDoUpdate({
      reserve0: event.args.reserve0,
      reserve1: event.args.reserve1,
    });
});

ponder.on("PoolV3:Swap", async ({ event, context }) => {
  await context.db
    .insert(pool)
    .values({
      address: event.log.address,
      kind: "v3",
      swaps: 1,
      lastTick: event.args.tick,
    })
    .onConflictDoUpdate((row) => ({
      swaps: row.swaps + 1,
      lastTick: event.args.tick,
    }));
  await context.db.insert(swap).values({
    id: event.id,
    pool: event.log.address,
    sender: event.args.sender,
    recipient: event.args.recipient,
    amount0: event.args.amount0,
    amount1: event.args.amount1,
    txFrom: event.transaction.from,
    timestamp: event.block.timestamp,
  });
});
