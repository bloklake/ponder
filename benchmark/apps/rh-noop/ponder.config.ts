import { createConfig } from "ponder";

import { erc20Abi } from "./abis/erc20";

// Robinhood Chain (4663); hottest ERC-20 by Transfer count on the benchmark range.
// Range overridable for quick runs: BENCH_START_BLOCK / BENCH_END_BLOCK.
export default createConfig({
  chains: {
    robinhood: {
      id: 4663,
      rpc: process.env.PONDER_RPC_URL_4663!,
    },
  },
  contracts: {
    Token: {
      chain: "robinhood",
      abi: erc20Abi,
      address: "0x0bd7d308f8e1639fab988df18a8011f41eacad73",
      startBlock: Number(process.env.BENCH_START_BLOCK ?? 58_600_000),
      endBlock: Number(process.env.BENCH_END_BLOCK ?? 58_700_000),
    },
  },
});
