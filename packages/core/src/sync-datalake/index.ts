import type { Address, Hex } from "viem";
import type { Common } from "@/internal/common.js";
import type {
  BlockFilter,
  Chain,
  Factory,
  FactoryId,
  Filter,
  InternalBlock,
  InternalLog,
  InternalTrace,
  InternalTransaction,
  InternalTransactionReceipt,
  LogFilter,
  SyncLog,
  TransactionFilter,
} from "@/internal/types.js";
import {
  getChildAddress,
  isAddressFactory,
  unionFilterIncludeBlock,
  unionFilterIncludeTransaction,
  unionFilterIncludeTransactionReceipt,
} from "@/runtime/filter.js";
import type { ChildAddresses } from "@/runtime/index.js";
import { formatEventData, isFilterInBlockRange } from "@/sync-store/index.js";
import { toLowerCase } from "@/utils/lowercase.js";
import { startClock } from "@/utils/timer.js";
import {
  createDatalakeClient,
  type DatalakeClient,
  DatalakeError,
  type DatalakeRequest,
} from "./client.js";
import { DATALAKE_LOG_FIELDS } from "./convert.js";
import { encodePage } from "./encode.js";

/**
 * The bloklake datalake as the historical source of a chain (`chains.<name>.datalake`).
 *
 * Blocks up to the datalake's archive height are never synced into `ponder_sync`: they
 * count as cached (in memory only, see `getCachedIntervals`), and the event generator
 * reads them from the datalake with `getDatalakeEventData`, which returns exactly what
 * `syncStore.getEventData` would for the same rows. Only the columns the indexing functions
 * use are requested. Blocks above the archive height, and live indexing, use JSON-RPC and
 * `ponder_sync` as before; without the datalake config nothing is marked cached, so the
 * JSON-RPC sync fetches everything.
 */

export type Datalake = {
  client: DatalakeClient;
  archiveHeight: number;
  /** Chain name, for metric labels. */
  chain: string;
};

/**
 * `true` if every filter can be served by the datalake. Transaction filters on factory
 * children and trace / native-transfer filters are not supported yet; chains that use them
 * sync from JSON-RPC.
 */
export const isDatalakeSupported = (filters: Filter[]): boolean =>
  filters.every((filter) => {
    switch (filter.type) {
      case "log":
        return true;
      case "transaction":
        return (
          isAddressFactory(filter.fromAddress) === false &&
          isAddressFactory(filter.toAddress) === false
        );
      case "block":
        return true;
      default:
        return false;
    }
  });

const datalakes = new Map<string, Promise<Datalake | undefined>>();

/**
 * The datalake of `chain` (status checked once per process), or `undefined` when the chain
 * has none configured, uses sources it cannot serve, or it has no data yet.
 */
/** How long startup waits for an unreachable datalake before using JSON-RPC. */
const STARTUP_RETRY_BUDGET_MS = 30_000;

export const getDatalake = ({
  common,
  chain,
  filters,
}: {
  common: Common;
  chain: Chain;
  filters: Filter[];
}): Promise<Datalake | undefined> => {
  if (chain.datalake === undefined) return Promise.resolve(undefined);
  const key = `${chain.id}:${chain.datalake.url}`;
  if (datalakes.has(key) === false) {
    datalakes.set(
      key,
      (async () => {
        if (isDatalakeSupported(filters) === false) {
          common.logger.warn({
            msg: "Datalake does not support trace, transfer or factory account sources yet; using JSON-RPC",
            chain: chain.name,
            chain_id: chain.id,
          });
          return undefined;
        }
        const client = createDatalakeClient(chain.datalake!, {
          onRetry: ({ error, attempt, delayMs }) => {
            common.logger.warn({
              msg: "Retrying datalake request",
              chain: chain.name,
              chain_id: chain.id,
              attempt,
              retry_delay: delayMs,
              error: error as Error,
            });
          },
        });
        let status: Awaited<ReturnType<typeof client.status>>;
        try {
          status = await client.status(STARTUP_RETRY_BUDGET_MS);
        } catch (error) {
          // Note: Without the datalake every block is synced from JSON-RPC, as without the
          // config; blocks already indexed are not fetched again.
          common.logger.warn({
            msg: "Datalake is unreachable; using JSON-RPC",
            chain: chain.name,
            chain_id: chain.id,
            url: chain.datalake!.url,
            error: error as Error,
          });
          return undefined;
        }
        if (status.chainId !== chain.id) {
          throw new Error(
            `Datalake at ${chain.datalake!.url} serves chain ${status.chainId}, but chain '${chain.name}' has id ${chain.id}`,
          );
        }
        if (status.archiveHeight === undefined) {
          common.logger.warn({
            msg: "Datalake has no data yet; using JSON-RPC",
            chain: chain.name,
            chain_id: chain.id,
          });
          return undefined;
        }
        // Note: Internal testing knob — cap the datalake range to exercise the handoff to
        // JSON-RPC at the archive height.
        const cap = process.env.PONDER_DATALAKE_MAX_BLOCK;
        const archiveHeight =
          cap === undefined
            ? status.archiveHeight
            : Math.min(status.archiveHeight, Number(cap));
        common.metrics.ponder_datalake_archive_height.set(
          { chain: chain.name },
          archiveHeight,
        );
        common.logger.info({
          msg: "Using datalake for backfill",
          chain: chain.name,
          chain_id: chain.id,
          archive_height: archiveHeight,
        });
        return { client, archiveHeight, chain: chain.name };
      })(),
    );
  }
  return datalakes.get(key)!;
};

/**
 * Child addresses of a log factory created up to `toBlock` (inclusive), from the factory's
 * creation logs in the datalake: `address → first creation block`, like
 * `syncStore.getChildAddresses`.
 */
export const getDatalakeChildAddresses = async ({
  datalake,
  factory,
  toBlock,
}: {
  datalake: Datalake;
  factory: Factory;
  toBlock: number;
}): Promise<Map<Address, number>> => {
  const children = new Map<Address, number>();
  const fromBlock = factory.fromBlock ?? 0;
  const lastBlock = Math.min(
    toBlock,
    factory.toBlock ?? Number.POSITIVE_INFINITY,
  );
  const address = values(factory.address as Hex | Hex[] | undefined);
  let from = fromBlock;
  while (from <= lastBlock) {
    const page = await datalake.client.query({
      fromBlock: from,
      toBlock: lastBlock,
      maxObjects: 250_000,
      logs: [
        {
          ...(address ? { address } : {}),
          topic0: [factory.eventSelector],
        },
      ],
      fields: {
        log: { blockNumber: true, logIndex: true, topics: true, data: true },
      },
    });
    const logs = page.logs;
    if (logs) {
      const blockNumber = logs.getChild("block_number")!;
      const data = logs.getChild("data")!;
      const topics = [1, 2, 3].map((i) => logs.getChild(`topic${i}`));
      const hex = (v: unknown) =>
        v == null
          ? undefined
          : (`0x${Buffer.from(v as Uint8Array).toString("hex")}` as Hex);
      for (let i = 0; i < logs.numRows; i++) {
        const child = toLowerCase(
          getChildAddress({
            log: {
              data: hex(data.get(i)) ?? "0x",
              topics: [
                factory.eventSelector,
                ...topics.map((t) => hex(t?.get(i))),
              ],
            } as unknown as SyncLog,
            factory,
          }),
        );
        const block = Number(blockNumber.get(i));
        const known = children.get(child);
        if (known === undefined || block < known) children.set(child, block);
      }
    }
    if (page.nextBlock <= from) {
      throw new Error(
        `Datalake pagination did not advance (fromBlock ${from}, next block ${page.nextBlock})`,
      );
    }
    from = page.nextBlock;
  }
  return children;
};

/** Literal address lists up to this size; larger child sets go through `/v1/sets`. */
const MAX_LITERAL_ADDRESSES = 1_000;

/** Registered child-address sets per factory, reused while the set does not grow. */
const childSets = new WeakMap<
  Datalake,
  Map<FactoryId, { size: number; setId: string }>
>();

const childAddressObject = async (
  datalake: Datalake,
  factory: Factory,
  children: Map<Address, number>,
): Promise<{ address: Hex[] } | { addressSet: string } | undefined> => {
  // Note: No children yet means no log can match; an empty `address` would match all.
  if (children.size === 0) return undefined;
  if (children.size <= MAX_LITERAL_ADDRESSES) {
    return { address: Array.from(children.keys()) };
  }
  if (childSets.has(datalake) === false) childSets.set(datalake, new Map());
  const sets = childSets.get(datalake)!;
  const previous = sets.get(factory.id);
  if (previous !== undefined && previous.size === children.size) {
    return { addressSet: previous.setId };
  }
  const setId = await datalake.client.createSet(
    "address",
    Array.from(children.keys()),
    previous?.setId,
  );
  sets.set(factory.id, { size: children.size, setId });
  return { addressSet: setId };
};

/** Datalakes already warned about fields their chain lacks. */
const warnedUnavailable = new WeakSet<Datalake>();

const warnUnavailableFields = (
  common: Common,
  datalake: Datalake,
  pages: { unavailableFields: string[] | undefined }[],
) => {
  if (warnedUnavailable.has(datalake)) return;
  const fields = new Set(pages.flatMap((page) => page.unavailableFields ?? []));
  if (fields.size === 0) return;
  warnedUnavailable.add(datalake);
  common.logger.warn({
    msg: "Datalake chain lacks selected fields; they read as null",
    chain: datalake.chain,
    fields: Array.from(fields).join(","),
  });
};

const values = (v: Hex | Hex[] | null | undefined): Hex[] | undefined =>
  v === null || v === undefined ? undefined : Array.isArray(v) ? v : [v];

const logObject = async (
  datalake: Datalake,
  filter: LogFilter,
  childAddresses: ChildAddresses,
) => {
  const object: Record<string, Hex[] | string> = {};
  if (isAddressFactory(filter.address)) {
    const children = await childAddressObject(
      datalake,
      filter.address,
      childAddresses.get(filter.address.id) ?? new Map(),
    );
    if (children === undefined) return undefined;
    Object.assign(object, children);
  } else {
    const address = values(filter.address as Hex | Hex[] | undefined);
    if (address) object.address = address;
  }
  for (const key of ["topic0", "topic1", "topic2", "topic3"] as const) {
    const topic = values(filter[key]);
    if (topic) object[key] = topic;
  }
  return object;
};

const transactionObject = (filter: TransactionFilter) => {
  const object: Record<string, Hex[]> = {};
  const from = values(filter.fromAddress as Hex | Hex[] | undefined);
  const to = values(filter.toAddress as Hex | Hex[] | undefined);
  if (from) object.from = from;
  if (to) object.to = to;
  return object;
};

const fieldMap = (fields: Iterable<string>) =>
  Object.fromEntries(Array.from(fields, (f) => [f, true as const]));

/** Key order of `syncStore.getEventData`'s selects: required columns, then includes. */
const selectKeys = (required: string[], include: string[]) =>
  Object.keys(fieldMap([...required, ...include]));

/**
 * `syncStore.getEventData` for blocks up to the datalake's archive height: the same rows,
 * columns and post-processing, read from the datalake. At most about `limit` objects per
 * call; `cursor` is the last block fully returned.
 */
const eventData = async ({
  common,
  datalake,
  filters,
  fromBlock,
  toBlock,
  chainId,
  limit,
  childAddresses,
}: {
  common: Common;
  datalake: Datalake;
  childAddresses: ChildAddresses;
  filters: Filter[];
  fromBlock: number;
  toBlock: number;
  chainId: number;
  limit: number;
}): Promise<{
  blocks: InternalBlock[];
  logs: InternalLog[];
  transactions: InternalTransaction[];
  transactionReceipts: InternalTransactionReceipt[];
  traces: InternalTrace[];
  cursor: number;
}> => {
  const activeFilters = filters.filter((filter) =>
    isFilterInBlockRange({ filter, fromBlock, toBlock }),
  );
  const logFilters = activeFilters.filter(
    (f): f is LogFilter => f.type === "log",
  );
  const logObjects = (
    await Promise.all(
      logFilters.map((f) => logObject(datalake, f, childAddresses)),
    )
  ).filter((o): o is Record<string, Hex[] | string> => o !== undefined);
  const transactionFilters = activeFilters.filter(
    (f): f is TransactionFilter => f.type === "transaction",
  );
  const blockFilters = activeFilters.filter(
    (f): f is BlockFilter => f.type === "block",
  );
  const withReceipts = activeFilters.some((f) => f.hasTransactionReceipt);

  // Note: The same columns as `syncStore.getEventData` (which unions the includes of all
  // filters, not only the active ones).
  const blockKeys = selectKeys(
    ["number", "hash", "timestamp"],
    unionFilterIncludeBlock(filters),
  );
  const transactionKeys = selectKeys(
    ["blockNumber", "transactionIndex", "from", "to", "hash", "type"],
    unionFilterIncludeTransaction(filters),
  );
  const receiptKeys = selectKeys(
    ["blockNumber", "transactionIndex", "status", "from", "to"],
    unionFilterIncludeTransactionReceipt(filters),
  );
  const logKeys = [
    "blockNumber",
    "logIndex",
    "transactionIndex",
    "address",
    "topic0",
    "topic1",
    "topic2",
    "topic3",
    "data",
  ];

  // Requested fields: the selected columns plus what JSON-RPC standardization requires.
  const blockFields = fieldMap([
    ...blockKeys,
    "number",
    "hash",
    "timestamp",
    "logsBloom",
    "parentHash",
  ]);
  const transactionFields = fieldMap([
    ...transactionKeys,
    "blockNumber",
    "transactionIndex",
    "hash",
    "from",
    "to",
    ...(withReceipts
      ? receiptKeys
          .filter((k) => k !== "blockNumber" && k !== "transactionIndex")
          .concat("status")
      : []),
  ]);

  // Note: `limit` is rows per table for `syncStore.getEventData`; the datalake counts
  // objects across its streams (blocks, transactions, logs), so allow `limit` per stream to
  // keep batches the same size.
  const requests: { request: DatalakeRequest; withReceipts: boolean }[] = [];
  if (logObjects.length > 0 || transactionFilters.length > 0) {
    requests.push({
      withReceipts,
      request: {
        fromBlock,
        toBlock,
        maxObjects: limit * (logObjects.length > 0 ? 3 : 2),
        ...(logObjects.length > 0
          ? { logs: logObjects, joinTransactions: true }
          : {}),
        ...(transactionFilters.length > 0
          ? { transactions: transactionFilters.map(transactionObject) }
          : {}),
        fields: {
          block: blockFields,
          transaction: transactionFields,
          ...(logObjects.length > 0
            ? { log: fieldMap(DATALAKE_LOG_FIELDS) }
            : {}),
        },
      },
    });
  }
  for (const filter of blockFilters) {
    requests.push({
      withReceipts: false,
      request: {
        fromBlock,
        toBlock,
        maxObjects: limit,
        blockInterval: filter.interval,
        blockOffset: filter.offset % filter.interval,
        fields: { block: blockFields },
      },
    });
  }

  const endClock = startClock();
  const pages = await Promise.all(
    requests.map(({ request }) => datalake.client.query(request)),
  );
  common.metrics.ponder_datalake_request_duration.observe(
    { chain: datalake.chain, kind: "events" },
    endClock(),
  );
  warnUnavailableFields(common, datalake, pages);
  common.metrics.ponder_datalake_rows_total.inc(
    { chain: datalake.chain },
    pages.reduce(
      (sum, page) =>
        sum +
        (page.blocks?.numRows ?? 0) +
        (page.transactions?.numRows ?? 0) +
        (page.logs?.numRows ?? 0),
      0,
    ),
  );
  // Note: Every request covers at least `[fromBlock, cursor]`; rows past the cursor are
  // dropped by `formatEventData` and read again by the next call.
  const cursor =
    pages.length === 0
      ? toBlock
      : Math.min(toBlock, ...pages.map((page) => page.nextBlock - 1));

  const keys = {
    block: blockKeys,
    transaction: transactionKeys,
    transactionReceipt: receiptKeys,
    log: logKeys,
  };
  const blocks = new Map<number, Record<string, unknown>>();
  const transactionsRows: Record<string, unknown>[] = [];
  const transactionReceiptsRows: Record<string, unknown>[] = [];
  const logsRows: Record<string, unknown>[] = [];
  for (const [i, page] of pages.entries()) {
    const rows = encodePage(page, chainId, requests[i]!.withReceipts, keys);
    for (const [number, block] of rows.blocks) blocks.set(number, block);
    transactionsRows.push(...rows.transactions);
    transactionReceiptsRows.push(...rows.transactionReceipts);
    logsRows.push(...rows.logs);
  }
  const blocksRows = Array.from(blocks.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([, block]) => block);

  return formatEventData({
    common,
    blocksRows,
    transactionsRows:
      logObjects.length > 0 || transactionFilters.length > 0
        ? transactionsRows
        : [],
    transactionReceiptsRows,
    tracesRows: [],
    logsRows,
    cursor,
  });
};

/**
 * `syncStore.getEventData` for blocks up to the datalake's archive height: see `eventData`.
 */
export const getDatalakeEventData = async (
  args: Parameters<typeof eventData>[0],
): ReturnType<typeof eventData> => {
  try {
    return await eventData(args);
  } catch (error) {
    // Note: A set unused for days, or deleted to make room for newer ones, is gone
    // (`404 unknown_set`); register the child sets again and retry once.
    if (error instanceof DatalakeError && error.code === "unknown_set") {
      childSets.delete(args.datalake);
      return eventData(args);
    }
    throw error;
  }
};
