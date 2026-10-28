import { createConfig } from "ponder";
import { parseAbi } from "viem";

// Approvals on the eight ERC-20s with the most approval traffic, each non-zero approval
// followed by an allowance(owner, spender) read at the event's block.
const startBlock = Number(process.env.BENCH_START_BLOCK ?? 25_600_000);
const endBlock = Number(process.env.BENCH_END_BLOCK ?? 25_601_199);

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
      abi: parseAbi([
        "event Approval(address indexed owner, address indexed spender, uint256 value)",
        "function allowance(address owner, address spender) view returns (uint256)",
      ]),
      address: [
        "0xdac17f958d2ee523a2206206994597c13d831ec7", // USDT
        "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", // USDC
        "0x68749665ff8d2d112fa859aa293f07a622782f38", // XAUt
        "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2", // WETH
        "0x4c9edd5852cd905f086c759e8383e09bff1e68b3", // USDe
        "0x2260fac5e5542a773aa44fbcfedf7c193bc2c599", // WBTC
        "0x6b175474e89094c44da98b954eedeac495271d0f", // DAI
        "0xf939e0a03fb07f59a73314e73794be0e57ac1b4e", // crvUSD
      ],
      startBlock,
      endBlock,
    },
  },
});
