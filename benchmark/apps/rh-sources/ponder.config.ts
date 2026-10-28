import { createConfig } from "ponder";

import { erc20Abi } from "./abis/erc20";

// Correctness app for the datalake source: log events with receipts, an account
// (transaction) source and a block-interval source. BENCH_DATALAKE_URL switches the
// historical source to the datalake; everything else is identical.
const startBlock = Number(process.env.BENCH_START_BLOCK ?? 58_600_000);
const endBlock = Number(process.env.BENCH_END_BLOCK ?? 58_605_000);

export default createConfig({
  chains: {
    robinhood: {
      id: 4663,
      rpc: process.env.PONDER_RPC_URL_4663!,
      ...(process.env.BENCH_DATALAKE_URL
        ? { datalake: { url: process.env.BENCH_DATALAKE_URL } }
        : {}),
    },
  },
  contracts: {
    Token: {
      chain: "robinhood",
      abi: erc20Abi,
      address: "0x0bd7d308f8e1639fab988df18a8011f41eacad73",
      includeTransactionReceipts: true,
      startBlock,
      endBlock,
    },
  },
  accounts: {
    Hub: {
      chain: "robinhood",
      address: "0x65050a9b7e5075a2ba5ced7b1b64ee66262c40dc",
      startBlock,
      endBlock,
    },
  },
  blocks: {
    Every100: {
      chain: "robinhood",
      interval: 100,
      startBlock: startBlock + 7,
      endBlock,
    },
  },
});
