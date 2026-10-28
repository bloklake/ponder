import { ponder } from "ponder:registry";
import { checkpoint, nobody, pair } from "ponder:schema";

ponder.on("FactoryV2:PairCreated", async ({ event, context }) => {
  // Note: The unnamed last parameter makes `args` positional.
  const [token0, token1, address] = event.args as unknown as [
    `0x${string}`,
    `0x${string}`,
    `0x${string}`,
  ];
  await context.db.insert(pair).values({
    address,
    token0,
    token1,
    createdAt: event.block.number,
    syncs: 0,
  });
});

ponder.on("PairV2:Sync", async ({ event, context }) => {
  await context.db
    .update(pair, { address: event.log.address })
    .set((row) => ({ syncs: row.syncs + 1 }));
});

for (const direction of ["from", "to"] as const) {
  ponder.on(`Nobody:transaction:${direction}`, async ({ event, context }) => {
    await context.db
      .insert(nobody)
      .values({ hash: event.transaction.hash })
      .onConflictDoNothing();
  });
}

ponder.on("Every1000:block", async ({ event, context }) => {
  await context.db
    .insert(checkpoint)
    .values({ number: event.block.number, hash: event.block.hash });
});
