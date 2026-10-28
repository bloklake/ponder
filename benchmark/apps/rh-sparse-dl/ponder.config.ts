import { createConfig, factory } from "ponder";
import { parseAbi, parseAbiItem } from "viem";

// Sources with few or no events, so datalake pages come back with empty streams: an account
// with no transactions, a factory's creation events only, and a block source.
// BENCH_DATALAKE_URL switches the historical source to the datalake.
const startBlock = Number(process.env.BENCH_START_BLOCK ?? 58_600_000);
const endBlock = Number(process.env.BENCH_END_BLOCK ?? 58_650_000);

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
    FactoryV2: {
      chain: "robinhood",
      abi: parseAbi([
        "event PairCreated(address indexed token0, address indexed token1, address pair, uint256)",
      ]),
      address: "0x0d1ebb179cdbca88d74c923c4255cb2b17474afd",
      startBlock,
      endBlock,
    },
    PairV2: {
      chain: "robinhood",
      abi: parseAbi(["event Sync(uint112 reserve0, uint112 reserve1)"]),
      address: factory({
        address: "0x0d1ebb179cdbca88d74c923c4255cb2b17474afd",
        event: parseAbiItem(
          "event PairCreated(address indexed token0, address indexed token1, address pair, uint256)",
        ),
        parameter: "pair",
      }),
      startBlock,
      endBlock,
    },
  },
  accounts: {
    Nobody: {
      chain: "robinhood",
      address: "0x000000000000000000000000000000000000dead",
      startBlock,
      endBlock,
    },
  },
  blocks: {
    Every1000: {
      chain: "robinhood",
      interval: 1000,
      startBlock,
      endBlock,
    },
  },
});
