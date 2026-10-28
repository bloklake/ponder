import { ponder } from "ponder:registry";
import { pool, poolHourData } from "ponder:schema";
import { erc20Abi } from "viem";
import { pairAbi } from "../ponder.config";

ponder.on("Pair:Sync", async ({ event, context }) => {
  const address = event.log.address;
  let row = await context.db.find(pool, { address });
  if (row === null) {
    const [token0, token1] = await Promise.all([
      context.client.readContract({
        abi: pairAbi,
        address,
        functionName: "token0",
      }),
      context.client.readContract({
        abi: pairAbi,
        address,
        functionName: "token1",
      }),
    ]);
    row = await context.db.insert(pool).values({
      address,
      token0,
      token1,
      reserve0: 0n,
      reserve1: 0n,
      balance0: 0n,
      syncs: 0,
    });
  }

  // Predictable from the event: the pair's reserves at the event's block.
  const [reserve0, reserve1, blockTimestampLast] =
    await context.client.readContract({
      abi: pairAbi,
      address,
      functionName: "getReserves",
    });
  // Not predictable from the event: the token address comes from the database.
  const balance0 = await context.client.readContract({
    abi: erc20Abi,
    address: row.token0,
    functionName: "balanceOf",
    args: [address],
  });

  await context.db.update(pool, { address }).set((r) => ({
    reserve0,
    reserve1,
    balance0,
    syncs: r.syncs + 1,
  }));
  await context.db
    .insert(poolHourData)
    .values({
      pool: address,
      hour: event.block.timestamp / 3600n,
      syncs: 1,
      lastReserve0: reserve0,
      lastBalance0: balance0,
      lastBlockTimestamp: BigInt(blockTimestampLast),
    })
    .onConflictDoUpdate((r) => ({
      syncs: r.syncs + 1,
      lastReserve0: reserve0,
      lastBalance0: balance0,
      lastBlockTimestamp: BigInt(blockTimestampLast),
    }));
});
