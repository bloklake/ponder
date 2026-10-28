import { createConfig } from "ponder";
import { parseAbi } from "viem";

// Insert-only event stream: every USDC Transfer on Ethereum mainnet, one row each.
const startBlock = Number(process.env.BENCH_START_BLOCK ?? 18_600_000);
const endBlock = Number(process.env.BENCH_END_BLOCK ?? 18_699_999);

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
    USDC: {
      chain: "mainnet",
      abi: parseAbi([
        "event Transfer(address indexed from, address indexed to, uint256 value)",
      ]),
      address: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
      startBlock,
      endBlock,
    },
  },
});
