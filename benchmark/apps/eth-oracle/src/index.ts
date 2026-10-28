import { ponder } from "ponder:registry";
import { price } from "ponder:schema";
import { parseAbi } from "viem";

const feedAbi = parseAbi([
  "function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)",
]);

ponder.on("Oracle:block", async ({ event, context }) => {
  const [roundId, answer, , updatedAt] = await context.client.readContract({
    abi: feedAbi,
    address: "0x5f4ec3df9cbd43714fe2740f5e3616155c5b8419",
    functionName: "latestRoundData",
  });
  await context.db.insert(price).values({
    block: event.block.number,
    timestamp: event.block.timestamp,
    roundId,
    answer,
    updatedAt,
  });
});
