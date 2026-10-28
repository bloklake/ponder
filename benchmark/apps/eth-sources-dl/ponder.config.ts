import { createConfig, factory } from "ponder";
import { parseAbi, parseAbiItem } from "viem";

import { erc20Abi } from "./abis/erc20";

// Ethereum mainnet correctness app for the datalake source: every source kind over windows
// that straddle London (legacy / access-list / 1559 transactions, base fee appears) and
// Dencun (withdrawals, blob transactions). BENCH_DATALAKE_URL switches the historical
// source to the datalake; everything else is identical.
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
  contracts: {
    Token: {
      chain: "mainnet",
      abi: erc20Abi,
      address: [
        "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", // USDC
        "0xdac17f958d2ee523a2206206994597c13d831ec7", // USDT
        "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2", // WETH
      ],
      includeTransactionReceipts: true,
      startBlock,
      endBlock,
    },
    Pair: {
      chain: "mainnet",
      abi: parseAbi(["event Sync(uint112 reserve0, uint112 reserve1)"]),
      address: factory({
        address: "0x5c69bee701ef814a2b6a3edd4b1652cb9cc5aa6f",
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
    Router: {
      chain: "mainnet",
      address: "0x7a250d5630b4cf539739df2c5dacb4c659f2488d",
      startBlock,
      endBlock,
    },
    BlobInbox: {
      chain: "mainnet",
      address: "0xff00000000000000000000000000000000008453",
      startBlock,
      endBlock,
    },
    // Note: Sends blob (type 3) transactions in the Dencun window.
    BlobPoster: {
      chain: "mainnet",
      address: "0xa8cb082a5a689e0d594d7da1e2d72a3d63adc1bd",
      startBlock,
      endBlock,
    },
  },
  blocks: {
    Every25: {
      chain: "mainnet",
      interval: 25,
      startBlock: startBlock + 3,
      endBlock,
    },
  },
});
