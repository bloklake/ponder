import { createConfig, factory } from "ponder";
import {
  factories130,
  factories141,
  proxyCreation130,
  proxyCreation141,
  safeAbi,
  safeIndexedAbi,
} from "./abis";

// Factory registration: the Safe proxy factories, every proxy they create registered as a
// child, and the fifteen Safe events of those proxies. Insert-only.
const startBlock = Number(process.env.BENCH_START_BLOCK ?? 24_600_000);
const endBlock = Number(process.env.BENCH_END_BLOCK ?? 24_630_000);

const children = (layout: "130" | "141") =>
  factory({
    address: [...(layout === "130" ? factories130 : factories141)],
    event: layout === "130" ? proxyCreation130 : proxyCreation141,
    parameter: "proxy",
  });

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
    Factory130: {
      chain: "mainnet",
      abi: [proxyCreation130],
      address: [...factories130],
      startBlock,
      endBlock,
    },
    Factory141: {
      chain: "mainnet",
      abi: [proxyCreation141],
      address: [...factories141],
      startBlock,
      endBlock,
    },
    // Note: Each child layout is its own contract; a log is decoded only with the ABI whose
    // indexed arguments match its topics.
    Safe130: {
      chain: "mainnet",
      abi: safeAbi,
      address: children("130"),
      startBlock,
      endBlock,
    },
    Safe141: {
      chain: "mainnet",
      abi: safeAbi,
      address: children("141"),
      startBlock,
      endBlock,
    },
    SafeIndexed130: {
      chain: "mainnet",
      abi: safeIndexedAbi,
      address: children("130"),
      startBlock,
      endBlock,
    },
    SafeIndexed141: {
      chain: "mainnet",
      abi: safeIndexedAbi,
      address: children("141"),
      startBlock,
      endBlock,
    },
  },
});
