import { createConfig } from "ponder";

// App C (oracle-blocks): a block source every 10 blocks, one contract read per block (the
// Chainlink ETH/USD feed on Ethereum mainnet).
const startBlock = Number(process.env.BENCH_START_BLOCK ?? 12_964_001);
const endBlock = Number(process.env.BENCH_END_BLOCK ?? 12_965_999);

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
  blocks: {
    Oracle: {
      chain: "mainnet",
      interval: 10,
      startBlock,
      endBlock,
    },
  },
});
