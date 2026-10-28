import { createConfig, factory } from "ponder";
import { parseAbi, parseAbiItem } from "viem";

// Correctness app for factory sources: every pair of a V2-style factory and every pool of
// a V3-style factory on Robinhood Chain. BENCH_DATALAKE_URL switches the historical source.
const startBlock = Number(process.env.BENCH_START_BLOCK ?? 58_477_621);
const endBlock = Number(process.env.BENCH_END_BLOCK ?? 58_500_000);

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
    PairV2: {
      chain: "robinhood",
      abi: parseAbi([
        "event Swap(address indexed sender, uint256 amount0In, uint256 amount1In, uint256 amount0Out, uint256 amount1Out, address indexed to)",
        "event Sync(uint112 reserve0, uint112 reserve1)",
      ]),
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
    PoolV3: {
      chain: "robinhood",
      abi: parseAbi([
        "event Swap(address indexed sender, address indexed recipient, int256 amount0, int256 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick)",
      ]),
      address: factory({
        address: "0x1f7d7550b1b028f7571e69a784071f0205fd2efa",
        event: parseAbiItem(
          "event PoolCreated(address indexed token0, address indexed token1, uint24 indexed fee, int24 tickSpacing, address pool)",
        ),
        parameter: "pool",
      }),
      startBlock,
      endBlock,
    },
  },
});
