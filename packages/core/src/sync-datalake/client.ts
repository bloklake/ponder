import { Message, type Table, tableFromIPC } from "apache-arrow";

/**
 * Minimal client for the bloklake datalake query API (`POST /query`, `GET /status`).
 *
 * A `/query` response body is a concatenation of complete Arrow IPC streams, one per row
 * type. Every stream's schema metadata carries the response's `bl.*` keys: `bl.streams` (every
 * stream, in wire order), `bl.archive_height`, `bl.next_block` and `bl.unavailable_fields`.
 * Pagination is by object count: the response covers `[fromBlock, bl.next_block - 1]`.
 */

export type DatalakeConfig = {
  url: string;
  apiKey?: string;
};

export type DatalakeStatus = {
  chainId: number;
  archiveHeight: number | undefined;
};

export type DatalakeRequest = {
  fromBlock: number;
  toBlock: number;
  maxObjects?: number;
  logs?: object[];
  transactions?: object[];
  joinTransactions?: boolean;
  blockInterval?: number;
  blockOffset?: number;
  fields: {
    block?: Record<string, true>;
    transaction?: Record<string, true>;
    log?: Record<string, true>;
  };
};

export type DatalakePage = {
  /** First block the next page starts at; `> toBlock` when the range is complete. */
  nextBlock: number;
  archiveHeight: number;
  /** Selected fields this chain doesn't have (`<row type>.<field>`); their columns are null.
   * `undefined` when the server can't tell. */
  unavailableFields: string[] | undefined;
  transactions: Table | undefined;
  logs: Table | undefined;
  blocks: Table | undefined;
};

export class DatalakeError extends Error {
  override name = "DatalakeError";
  constructor(
    message: string,
    public readonly status?: number,
    public readonly retryable = false,
    /** The error envelope's `code` (`unknown_set`, `rate_limited`, …). */
    public readonly code?: string,
  ) {
    super(message);
  }
}

/**
 * Split concatenated Arrow IPC streams at their end-of-stream markers.
 *
 * Note: `RecordBatchReader.readAll` reads past the end of a stream that has no record
 * batches (a stream type with no matching rows), so the streams are split here.
 */
export const splitStreams = (body: Uint8Array): Uint8Array[] => {
  const view = new DataView(body.buffer, body.byteOffset, body.byteLength);
  const out: Uint8Array[] = [];
  let start = 0;
  let offset = 0;
  while (offset + 4 <= body.byteLength) {
    // Note: A message is `0xFFFFFFFF`, metadata length, metadata, body; pre-1.0 writers
    // omit the continuation marker. A zero length is the end-of-stream marker.
    let prefix = 4;
    let length = view.getInt32(offset, true);
    if (length === -1) {
      prefix = 8;
      length = view.getInt32(offset + 4, true);
    }
    if (length === 0) {
      offset += prefix;
      out.push(body.subarray(start, offset));
      start = offset;
      continue;
    }
    const metadata = body.subarray(offset + prefix, offset + prefix + length);
    offset += prefix + length + Message.decode(metadata).bodyLength;
  }
  // Note: Every stream ends with the marker; without it, batches may be missing.
  if (start !== body.byteLength) {
    throw new DatalakeError(
      "Truncated datalake response: Arrow stream without end-of-stream marker",
      undefined,
      true,
    );
  }
  return out;
};

/** Per-attempt limit on a request, response body included. */
const REQUEST_TIMEOUT_MS = 60_000;
const MAX_RETRY_DELAY_MS = 10_000;

export type DatalakeClientOptions = {
  /** Give up on a request that is still failing after this long. */
  retryBudgetMs?: number;
  /** Called before each retry. */
  onRetry?: (args: {
    error: unknown;
    attempt: number;
    delayMs: number;
  }) => void;
};

export const createDatalakeClient = (
  config: DatalakeConfig,
  { retryBudgetMs = 300_000, onRetry }: DatalakeClientOptions = {},
) => {
  const base = config.url.replace(/\/+$/, "");
  const headers: Record<string, string> = {
    "content-type": "application/json",
    ...(config.apiKey ? { "x-bl-api-key": config.apiKey } : {}),
  };

  const withRetries = async <T>(
    fn: (signal: AbortSignal) => Promise<T>,
    budgetMs = retryBudgetMs,
  ): Promise<T> => {
    const deadline = Date.now() + budgetMs;
    for (let attempt = 1; ; attempt++) {
      try {
        return await fn(AbortSignal.timeout(REQUEST_TIMEOUT_MS));
      } catch (error) {
        // Note: Network errors, timeouts and truncated bodies are retried.
        const retryable =
          error instanceof DatalakeError ? error.retryable : true;
        const delayMs = Math.min(MAX_RETRY_DELAY_MS, 125 * 2 ** (attempt - 1));
        if (retryable === false) throw error;
        if (Date.now() + delayMs > deadline) {
          if (attempt === 1) throw error;
          throw new DatalakeError(
            `Datalake still failing after ${attempt} attempts over ${Math.round(
              (Date.now() + budgetMs - deadline) / 1000,
            )}s; restarting uses JSON-RPC while the datalake is unreachable: ${
              (error as Error).message
            }`,
            error instanceof DatalakeError ? error.status : undefined,
          );
        }
        onRetry?.({ error, attempt, delayMs });
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }
  };

  const errorFrom = async (response: Response) => {
    let message = `${response.status} ${response.statusText}`;
    let code: string | undefined;
    try {
      const body = (await response.json()) as {
        error?: { code?: string; message?: string };
      };
      code = body?.error?.code;
      if (body?.error?.message) {
        message = `${code ?? response.status}: ${body.error.message}`;
      }
    } catch {}
    return new DatalakeError(
      `Datalake request failed: ${message}`,
      response.status,
      response.status === 408 ||
        response.status === 429 ||
        response.status >= 500,
      code,
    );
  };

  return {
    /** `budgetMs` overrides the retry budget (a startup check need not wait long). */
    async status(budgetMs?: number): Promise<DatalakeStatus> {
      return withRetries(async (signal) => {
        const response = await fetch(`${base}/status`, { headers, signal });
        if (response.ok === false) throw await errorFrom(response);
        const body = (await response.json()) as {
          chain_id: number;
          archive_height: number | null;
        };
        return {
          chainId: body.chain_id,
          archiveHeight: body.archive_height ?? undefined,
        };
      }, budgetMs);
    },

    /**
     * Register a server-side value set (content-addressed and idempotent); `basedOn` is the
     * previous set when growing one.
     */
    async createSet(
      kind: "address" | "topic",
      values: string[],
      basedOn?: string,
    ): Promise<string> {
      return withRetries(async (signal) => {
        const response = await fetch(`${base}/v1/sets`, {
          method: "POST",
          headers,
          signal,
          body: JSON.stringify({
            kind,
            values,
            ...(basedOn ? { basedOn } : {}),
          }),
        });
        if (response.ok === false) throw await errorFrom(response);
        const body = (await response.json()) as { set_id: string };
        return body.set_id;
      });
    },

    /** One page of a query. */
    async query(request: DatalakeRequest): Promise<DatalakePage> {
      return withRetries(async (signal) => {
        const response = await fetch(`${base}/query`, {
          method: "POST",
          headers,
          signal,
          body: JSON.stringify(request),
        });
        if (response.ok === false) throw await errorFrom(response);

        const body = new Uint8Array(await response.arrayBuffer());
        const tables = splitStreams(body).map((stream) => tableFromIPC(stream));
        if (tables.length === 0) {
          throw new DatalakeError(
            "Truncated datalake response: no Arrow stream",
            undefined,
            true,
          );
        }
        // Note: Every stream repeats the response metadata; the first one says how many follow.
        const meta = tables[0]!.schema.metadata;
        const streams = (meta.get("bl.streams") ?? "")
          .split(",")
          .filter((s) => s.length > 0);
        if (streams.length === 0) {
          throw new DatalakeError(
            "Datalake response without bl.* stream metadata; the server is older than this client",
          );
        }
        const nextBlock = Number(meta.get("bl.next_block"));
        const archiveHeight = Number(meta.get("bl.archive_height"));
        const unavailable = meta.get("bl.unavailable_fields");

        const page: DatalakePage = {
          nextBlock,
          archiveHeight,
          unavailableFields:
            unavailable === undefined
              ? undefined
              : unavailable.split(",").filter((f) => f.length > 0),
          transactions: undefined,
          logs: undefined,
          blocks: undefined,
        };
        if (tables.length > streams.length) {
          throw new DatalakeError(
            `Datalake response has ${tables.length} streams, but bl.streams lists ${streams.length}`,
          );
        }
        for (const [i, table] of tables.entries()) {
          const name = streams[i];
          if (name === "transactions") page.transactions = table;
          else if (name === "logs") page.logs = table;
          else if (name === "blocks") page.blocks = table;
          else {
            throw new DatalakeError(`Unexpected datalake stream "${name}"`);
          }
        }
        if (tables.length !== streams.length) {
          throw new DatalakeError(
            `Truncated datalake response: expected ${streams.length} streams, got ${tables.length}`,
            undefined,
            true,
          );
        }
        // Note: A datalake behind the requested range (e.g. a lagging replica) answers with
        // an empty page that does not advance; wait for it to catch up.
        if (
          Number.isFinite(nextBlock) === false ||
          nextBlock <= request.fromBlock
        ) {
          throw new DatalakeError(
            `Datalake is behind: requested blocks from ${request.fromBlock}, archive height ${archiveHeight}`,
            undefined,
            true,
          );
        }
        return page;
      });
    },
  };
};

export type DatalakeClient = ReturnType<typeof createDatalakeClient>;
