/**
 * Fault-injecting proxy in front of a datalake, for testing Ponder's datalake failure handling.
 *
 *   FAULT_MODE=503 FAULT_AFTER=5 FAULT_COUNT=20 bun run src/fault-proxy.ts \
 *     --target http://localhost:8090 --port 8190
 *
 * `/query` requests pass through until FAULT_AFTER of them have been answered, then the next
 * FAULT_COUNT (default: all) fail, then requests pass again. `/status` fails only with
 * FAULT_STATUS=1. Modes:
 *
 *   503       HTTP 503 with a JSON error body
 *   reset     the response body errors before any byte (connection failure)
 *   hang      never answer (the client times out)
 *   truncate  the first half of the real response body, then a clean end
 *   behind    a datalake whose archive height is FAULT_BEHIND_HEIGHT: ranges past it are cut
 *             off, a request past it gets an empty page that does not advance; it catches up
 *             after FAULT_COUNT such requests
 *   down      every request, `/status` included, is refused with 503
 */
import {
  RecordBatch,
  Schema,
  Table,
  tableFromIPC,
  tableToIPC,
} from "apache-arrow";
import { Command } from "commander";
import { splitStreams } from "../../packages/core/src/sync-datalake/client.js";

const opts = new Command()
  .requiredOption("--target <url>", "datalake base URL")
  .option("--port <n>", "listen port", "8190")
  .parse(process.argv)
  .opts();

const target = (opts.target as string).replace(/\/+$/, "");
const mode = process.env.FAULT_MODE ?? "pass";
const after = Number(process.env.FAULT_AFTER ?? 0);
const count = Number(process.env.FAULT_COUNT ?? Number.POSITIVE_INFINITY);
const faultStatus = process.env.FAULT_STATUS === "1" || mode === "down";
const behindHeight = Number(process.env.FAULT_BEHIND_HEIGHT ?? 0);

let queries = 0;
let faults = 0;

const forward = async (request: Request, body?: string) =>
  fetch(`${target}${new URL(request.url).pathname}`, {
    method: request.method,
    headers: request.headers,
    body: body ?? (request.method === "GET" ? undefined : await request.text()),
  });

const unavailable = () =>
  new Response(
    JSON.stringify({
      error: { code: "unavailable", message: "injected fault" },
    }),
    { status: 503, headers: { "content-type": "application/json" } },
  );

const withHeaders = (response: Response, body: BodyInit | null) => {
  const headers = new Headers(response.headers);
  headers.delete("content-length");
  headers.delete("content-encoding");
  return { headers, body };
};

/** A `/query` body with the `bl.*` metadata of every stream changed. */
const withMetadata = (bytes: Uint8Array, patch: Record<string, string>) =>
  Buffer.concat(
    splitStreams(bytes).map((stream) => {
      const table = tableFromIPC(stream);
      const metadata = new Map([
        ...table.schema.metadata,
        ...Object.entries(patch),
      ]);
      const schema = new Schema(table.schema.fields, metadata);
      return tableToIPC(
        new Table(
          schema,
          table.batches.map((batch) => new RecordBatch(schema, batch.data)),
        ),
        "stream",
      );
    }),
  );

const fault = async (request: Request): Promise<Response> => {
  switch (mode) {
    case "503":
    case "down":
      return unavailable();
    case "reset":
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.error(new Error("injected reset"));
          },
        }),
      );
    case "hang":
      return new Promise(() => {});
    case "truncate": {
      const response = await forward(request);
      const bytes = new Uint8Array(await response.arrayBuffer());
      const { headers } = withHeaders(response, null);
      return new Response(bytes.slice(0, Math.floor(bytes.length / 2)), {
        status: response.status,
        headers,
      });
    }
    case "behind": {
      const query = JSON.parse(await request.text());
      const status = (await (await fetch(`${target}/status`)).json()) as {
        archive_height: number;
      };
      const past = query.fromBlock > behindHeight;
      if (past) {
        faults++;
        console.log(`fault ${faults} (${mode}) at block ${query.fromBlock}`);
      }
      const rewritten = past
        ? {
            ...query,
            fromBlock: status.archive_height + 1,
            toBlock: status.archive_height + 1,
          }
        : { ...query, toBlock: Math.min(query.toBlock, behindHeight) };
      const response = await forward(request, JSON.stringify(rewritten));
      const bytes = new Uint8Array(await response.arrayBuffer());
      const { headers } = withHeaders(response, null);
      if (response.ok === false) {
        return new Response(bytes, { status: response.status, headers });
      }
      const body = withMetadata(bytes, {
        "bl.archive_height": String(behindHeight),
        ...(past ? { "bl.next_block": String(query.fromBlock) } : {}),
      });
      return new Response(body, { status: response.status, headers });
    }
    default:
      throw new Error(`Unknown FAULT_MODE ${mode}`);
  }
};

Bun.serve({
  port: Number(opts.port),
  idleTimeout: 255,
  async fetch(request) {
    const path = new URL(request.url).pathname;
    if (path === "/status") {
      return faultStatus ? unavailable() : forward(request);
    }
    if (path !== "/query" || mode === "pass") return forward(request);

    const n = queries++;
    if (n < after || faults >= count) return forward(request);
    // Note: Only a request past the archive height counts as a `behind` fault.
    if (mode === "behind") return fault(request);
    faults++;
    console.log(`fault ${faults} (${mode}) on query ${n + 1}`);
    return fault(request);
  },
});
console.log(
  `fault proxy :${opts.port} → ${target} (mode ${mode}, after ${after}, count ${count})`,
);
