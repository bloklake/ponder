/**
 * JSON-RPC endpoint for contract-read benchmarks: answers `eth_call`s of one function
 * selector after a fixed latency, with a value derived from the call itself, and relays every
 * other method to an upstream node. No rate limit and no concurrency ceiling, so the calls in
 * flight measure the client's scheduling.
 *
 *   bun run src/call-mock.ts --upstream http://localhost:8572 --port 8574 \
 *     --selector 0xdd62ed3e --latency 200
 *
 * The answer to `eth_call({to, data}, block)` is the first 8 bytes of
 * sha256(to ‖ data ‖ block number) as a uint256; a call with another selector, or at a tag
 * other than a block number, is refused. Batches are served concurrently, each call held for
 * its own latency.
 */
import { createHash } from "node:crypto";
import { Command } from "commander";

const opts = new Command()
  .requiredOption("--upstream <url>", "node for every other method")
  .option("--port <n>", "listen port", "8574")
  .option("--selector <hex>", "function selector answered", "0xdd62ed3e")
  .option("--latency <ms>", "latency per answered call", "200")
  .parse(process.argv)
  .opts();

const upstream = opts.upstream as string;
const selector = (opts.selector as string).toLowerCase();
const latency = Number(opts.latency);

let inFlight = 0;
let peak = 0;
let answered = 0;
const hashToNumber = new Map<string, Promise<number>>();

const relay = async (request: unknown) => {
  const response = await fetch(upstream, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(request),
  });
  return response.json();
};

const blockNumberOf = async (tag: any): Promise<number | undefined> => {
  if (
    typeof tag === "string" &&
    /^0x[0-9a-f]+$/i.test(tag) &&
    tag.length < 66
  ) {
    return Number(tag);
  }
  if (tag && typeof tag === "object") {
    if (tag.blockNumber !== undefined) return Number(tag.blockNumber);
    if (tag.blockHash !== undefined) {
      const hash = String(tag.blockHash).toLowerCase();
      if (hashToNumber.has(hash) === false) {
        hashToNumber.set(
          hash,
          relay({
            jsonrpc: "2.0",
            id: 1,
            method: "eth_getBlockByHash",
            params: [hash, false],
          }).then((r: any) => Number(r.result.number)),
        );
      }
      return hashToNumber.get(hash);
    }
  }
  return undefined;
};

const handle = async (request: any) => {
  const { id = null, method, params = [] } = request ?? {};
  if (method !== "eth_call") return relay(request);

  const [call, tag] = params;
  const data = String(call?.data ?? call?.input ?? "").toLowerCase();
  const block = await blockNumberOf(tag);
  if (data.startsWith(selector) === false || block === undefined) {
    return {
      jsonrpc: "2.0",
      id,
      error: { code: -32601, message: "call not served by this endpoint" },
    };
  }
  inFlight++;
  peak = Math.max(peak, inFlight);
  await new Promise((r) => setTimeout(r, latency));
  inFlight--;
  answered++;
  const digest = createHash("sha256")
    .update(`${String(call.to).toLowerCase()}${data}${block}`)
    .digest("hex");
  return {
    jsonrpc: "2.0",
    id,
    result: `0x${digest.slice(0, 16).padStart(64, "0")}`,
  };
};

Bun.serve({
  port: Number(opts.port),
  idleTimeout: 255,
  async fetch(req) {
    const url = new URL(req.url);
    if (req.method === "GET" && url.pathname === "/stats") {
      return Response.json({ answered, peak, inFlight });
    }
    if (req.method === "POST" && url.pathname === "/reset") {
      answered = 0;
      peak = 0;
      return Response.json({ ok: true });
    }
    const body = await req.json();
    const result = Array.isArray(body)
      ? await Promise.all(body.map(handle))
      : await handle(body);
    return Response.json(result);
  },
});
console.log(
  `call mock :${opts.port} → ${upstream} (${selector}, ${latency} ms)`,
);
