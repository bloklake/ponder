import { createConfig } from "ponder";
import { parseAbi } from "viem";

// App B (factory-reads): Uniswap V2 pairs on Ethereum mainnet with contract reads per event —
// one the event predicts (`getReserves()` on the event's pair at its block) and one it does
// not (`balanceOf` on a token address loaded from the database).
const startBlock = Number(process.env.BENCH_START_BLOCK ?? 12_964_001);
const endBlock = Number(process.env.BENCH_END_BLOCK ?? 12_965_999);

export const pairAbi = parseAbi([
  "event Sync(uint112 reserve0, uint112 reserve1)",
  "function getReserves() view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)",
  "function token0() view returns (address)",
  "function token1() view returns (address)",
]);

export default createConfig({
  chains: {
    mainnet: {
      id: 1,
      rpc: process.env.PONDER_RPC_URL_1!,
      ...(process.env.BENCH_DATALAKE_URL
        ? { datalake: { url: process.env.BENCH_DATALAKE_URL } }
        : {}),
    },
  },
  contracts: {
    Pair: {
      chain: "mainnet",
      abi: pairAbi,
      address: [
        "0x0d4a11d5eeaac28ec3f61d100daf4d40471f1852", // USDT/WETH
        "0xb4e16d0168e52d35cacd2c6185b44281ec28c9dc", // USDC/WETH
      ],
      startBlock,
      endBlock,
    },
  },
});
