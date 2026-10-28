import { createConfig } from "ponder";
import { parseAbi } from "viem";

// Read-modify-write on a sparse token: rETH Transfer (account balances, event rows) and
// Approval (allowances, event rows) on Ethereum mainnet.
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
    RETH: {
      chain: "mainnet",
      abi: parseAbi([
        "event Transfer(address indexed from, address indexed to, uint256 value)",
        "event Approval(address indexed owner, address indexed spender, uint256 value)",
      ]),
      address: "0xae78736cd615f374d3085123a210448e74fc6393",
      startBlock,
      endBlock,
    },
  },
});
