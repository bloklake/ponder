import crypto from "node:crypto";
import {
  and,
  asc,
  Column,
  desc,
  eq,
  getTableColumns,
  gte,
  inArray,
  lt,
  lte,
  or,
  type SQL,
  sql,
} from "drizzle-orm";
import { toSnakeCase } from "drizzle-orm/casing";

const identityMapFromDriverValue = (Column.prototype as any).mapFromDriverValue;

import {
  getTableConfig,
  type PgColumn,
  type PgSelectBase,
  type PgTable,
  unionAll,
} from "drizzle-orm/pg-core";
import type pg from "pg";
import { type Address, hexToNumber, isHex } from "viem";
import type { QB } from "@/database/queryBuilder.js";
import { extractBlockNumberParam } from "@/indexing/client.js";
import type { Common } from "@/internal/common.js";
import type { Logger } from "@/internal/logger.js";
import type {
  BlockFilter,
  Factory,
  FactoryFragmentId,
  Filter,
  Fragment,
  FragmentId,
  InternalBlock,
  InternalLog,
  InternalTrace,
  InternalTransaction,
  InternalTransactionReceipt,
  LightBlock,
  LogFilter,
  RequiredInternalBlockColumns,
  RequiredInternalTraceColumns,
  RequiredInternalTransactionColumns,
  RequiredInternalTransactionReceiptColumns,
  SyncBlock,
  SyncBlockHeader,
  SyncLog,
  SyncTrace,
  SyncTransaction,
  SyncTransactionReceipt,
  TraceFilter,
  TransactionFilter,
  TransferFilter,
} from "@/internal/types.js";
import type { RequestParameters } from "@/rpc/index.js";
import {
  getFilterFactories,
  isAddressFactory,
  unionFilterIncludeBlock,
  unionFilterIncludeTrace,
  unionFilterIncludeTransaction,
  unionFilterIncludeTransactionReceipt,
} from "@/runtime/filter.js";
import {
  encodeFragment,
  getFactoryFragmentIds,
  getFactoryFragments,
  getFragments,
} from "@/runtime/fragments.js";
import type {
  IntervalWithFactory,
  IntervalWithFilter,
} from "@/runtime/index.js";
import type { Interval } from "@/utils/interval.js";
import { toLowerCase } from "@/utils/lowercase.js";
import { orderObject } from "@/utils/order.js";
import { startClock } from "@/utils/timer.js";
import {
  encodeBlock,
  encodeLog,
  encodeTrace,
  encodeTransaction,
  encodeTransactionReceipt,
} from "./encode.js";
import * as PONDER_SYNC from "./schema.js";

export type SyncStore = {
  insertIntervals(
    args: {
      intervals: IntervalWithFilter[];
      factoryIntervals: IntervalWithFactory[];
      chainId: number;
    },
    context?: { logger?: Logger },
  ): Promise<void>;
  getIntervals(
    args: { filters: Filter[] },
    context?: { logger?: Logger },
  ): Promise<
    Map<Filter | Factory, { fragment: Fragment; intervals: Interval[] }[]>
  >;
  insertChildAddresses(
    args: {
      /** Child addresses and block numbers per `factory_log` fragment ID. */
      childAddresses: Map<FactoryFragmentId, Map<Address, number>>;
      chainId: number;
    },
    context?: { logger?: Logger },
  ): Promise<void>;
  getChildAddresses(
    args: { factory: Factory },
    context?: { logger?: Logger },
  ): Promise<Map<Address, number>>;
  getSafeCrashRecoveryBlock(
    args: {
      chainId: number;
      timestamp: number;
    },
    context?: { logger?: Logger },
  ): Promise<{ number: bigint; timestamp: bigint } | undefined>;
  insertLogs(
    args: { logs: SyncLog[]; chainId: number },
    context?: { logger?: Logger },
  ): Promise<void>;
  insertBlocks(
    args: {
      blocks: (SyncBlock | SyncBlockHeader)[];
      chainId: number;
    },
    context?: { logger?: Logger },
  ): Promise<void>;
  insertTransactions(
    args: {
      transactions: SyncTransaction[];
      chainId: number;
    },
    context?: { logger?: Logger },
  ): Promise<void>;
  insertTransactionReceipts(
    args: {
      transactionReceipts: SyncTransactionReceipt[];
      chainId: number;
    },
    context?: { logger?: Logger },
  ): Promise<void>;
  insertTraces(
    args: {
      traces: {
        trace: SyncTrace;
        block: SyncBlock;
        transaction: SyncTransaction;
      }[];
      chainId: number;
    },
    context?: { logger?: Logger },
  ): Promise<void>;
  getEventData(
    args: {
      filters: Filter[];
      fromBlock: number;
      toBlock: number;
      chainId: number;
      limit: number;
    },
    context?: { logger?: Logger },
  ): Promise<{
    blocks: InternalBlock[];
    logs: InternalLog[];
    transactions: InternalTransaction[];
    transactionReceipts: InternalTransactionReceipt[];
    traces: InternalTrace[];
    cursor: number;
  }>;
  insertRpcRequestResults(
    args: {
      requests: {
        request: RequestParameters;
        blockNumber: number | undefined;
        result: string;
      }[];
      chainId: number;
    },
    context?: { logger?: Logger },
  ): Promise<void>;
  getRpcRequestResults(
    args: {
      requests: RequestParameters[];
      chainId: number;
    },
    context?: { logger?: Logger },
  ): Promise<(string | undefined)[]>;
  pruneRpcRequestResults(
    args: {
      blocks: Pick<LightBlock, "number">[];
      chainId: number;
    },
    context?: { logger?: Logger },
  ): Promise<void>;
  pruneByChain(
    args: { chainId: number },
    context?: { logger?: Logger },
  ): Promise<void>;
};

/**
 * `ponder_sync` rows (as selected, oldest first) → the internal event data of blocks up to
 * `cursor` (inclusive): drops rows past the cursor, lowercases addresses, and maps
 * transaction types, receipt statuses, access lists and log topics. Shared by the Postgres
 * read path and the datalake source so both produce identical events.
 */
export const formatEventData = async ({
  common,
  blocksRows,
  transactionsRows,
  transactionReceiptsRows,
  tracesRows,
  logsRows,
  cursor,
}: {
  common: Common;
  blocksRows: any[];
  transactionsRows: any[];
  transactionReceiptsRows: any[];
  tracesRows: any[];
  logsRows: any[];
  cursor: number;
}): Promise<{
  blocks: InternalBlock[];
  logs: InternalLog[];
  transactions: InternalTransaction[];
  transactionReceipts: InternalTransactionReceipt[];
  traces: InternalTrace[];
  cursor: number;
}> => {
  const endClock = startClock();
  for (let i = 0; i < blocksRows.length; i++) {
    if (Number(blocksRows[i]!.number) > cursor) {
      blocksRows.length = i;
      break;
    }

    const block = blocksRows[i]!;

    if (block.miner) {
      block.miner = toLowerCase(block.miner as Address);
    }
  }

  for (let i = 0; i < transactionsRows.length; i++) {
    if (Number(transactionsRows[i]!.blockNumber) > cursor) {
      transactionsRows.length = i;
      break;
    }

    const transaction = transactionsRows[i]!;
    const internalTransaction = transaction as unknown as InternalTransaction;

    internalTransaction.blockNumber = Number(transaction.blockNumber);
    internalTransaction.from = toLowerCase(transaction.from as Address);
    if (transaction.to !== null) {
      internalTransaction.to = toLowerCase(transaction.to as Address);
    }

    if (transaction.type === "0x0") {
      internalTransaction.type = "legacy";
      internalTransaction.accessList = undefined;
      internalTransaction.maxFeePerGas = undefined;
      internalTransaction.maxPriorityFeePerGas = undefined;
    } else if (transaction.type === "0x1") {
      internalTransaction.type = "eip2930";
      internalTransaction.accessList =
        transaction.accessList === undefined
          ? undefined
          : JSON.parse(transaction.accessList!);
      internalTransaction.maxFeePerGas = undefined;
      internalTransaction.maxPriorityFeePerGas = undefined;
    } else if (transaction.type === "0x2") {
      internalTransaction.type = "eip1559";
      internalTransaction.gasPrice = undefined;
      internalTransaction.accessList = undefined;
    } else if (transaction.type === "0x7e") {
      internalTransaction.type = "deposit";
      internalTransaction.gasPrice = undefined;
      internalTransaction.accessList = undefined;
    }
  }

  for (let i = 0; i < transactionReceiptsRows.length; i++) {
    if (Number(transactionReceiptsRows[i]!.blockNumber) > cursor) {
      transactionReceiptsRows.length = i;
      break;
    }

    const transactionReceipt = transactionReceiptsRows[i]!;

    const internalTransactionReceipt =
      transactionReceipt as unknown as InternalTransactionReceipt;

    internalTransactionReceipt.blockNumber = Number(
      transactionReceipt.blockNumber,
    );
    if (transactionReceipt.contractAddress) {
      internalTransactionReceipt.contractAddress = toLowerCase(
        transactionReceipt.contractAddress as Address,
      );
    }
    internalTransactionReceipt.from = toLowerCase(
      transactionReceipt.from as Address,
    );
    if (transactionReceipt.to !== null) {
      internalTransactionReceipt.to = toLowerCase(
        transactionReceipt.to as Address,
      );
    }
    internalTransactionReceipt.status =
      transactionReceipt.status === "0x1"
        ? "success"
        : transactionReceipt.status === "0x0"
          ? "reverted"
          : (transactionReceipt.status as InternalTransactionReceipt["status"]);
    internalTransactionReceipt.type =
      transactionReceipt.type === "0x0"
        ? "legacy"
        : transactionReceipt.type === "0x1"
          ? "eip2930"
          : transactionReceipt.type === "0x2"
            ? "eip1559"
            : transactionReceipt.type === "0x7e"
              ? "deposit"
              : transactionReceipt.type;
  }

  for (let i = 0; i < tracesRows.length; i++) {
    if (Number(tracesRows[i]!.blockNumber) > cursor) {
      tracesRows.length = i;
      break;
    }

    const trace = tracesRows[i]!;
    const internalTrace = trace as unknown as InternalTrace;

    internalTrace.blockNumber = Number(trace.blockNumber);

    internalTrace.from = toLowerCase(trace.from as Address);
    if (trace.to !== null) {
      internalTrace.to = toLowerCase(trace.to as Address);
    }

    if (trace.output === null) {
      internalTrace.output = undefined;
    }
  }

  for (let i = 0; i < logsRows.length; i++) {
    if (Number(logsRows[i]!.blockNumber) > cursor) {
      logsRows.length = i;
      break;
    }

    const log = logsRows[i]!;
    const internalLog = log as unknown as InternalLog;

    internalLog.blockNumber = Number(log.blockNumber);
    internalLog.address = toLowerCase(log.address as Address);
    internalLog.removed = false;
    internalLog.topics = [log.topic0, log.topic1, log.topic2, log.topic3];
    log.topic0 = undefined;
    log.topic1 = undefined;
    log.topic2 = undefined;
    log.topic3 = undefined;
  }

  common.metrics.ponder_historical_extract_duration.inc(
    { step: "format" },
    endClock(),
  );

  await new Promise(setImmediate);

  return {
    blocks: blocksRows as InternalBlock[],
    logs: logsRows as InternalLog[],
    transactions: transactionsRows as InternalTransaction[],
    transactionReceipts:
      transactionReceiptsRows as InternalTransactionReceipt[],
    traces: tracesRows as InternalTrace[],
    cursor,
  };
};

export const createSyncStore = ({
  common,
  qb,
}: {
  common: Common;
  qb: QB<typeof PONDER_SYNC>;
}): SyncStore => {
  /**
   * Multi-row `INSERT ... ON CONFLICT (target) DO NOTHING` with the SQL text built by
   * hand. Drizzle's builder spends several microseconds per bound parameter, which made
   * it the largest CPU cost of historical sync. Values go through each column's own
   * `mapToDriverValue`, so the stored rows are the same.
   */
  /**
   * Run a drizzle select and map its rows like drizzle does, without drizzle's
   * per-field result mapping (a large CPU cost when reading back events). Each
   * value still goes through its column's `mapFromDriverValue`. PGlite keeps the
   * drizzle path. Note: drizzle's node-postgres driver only overrides the type
   * parsers of timestamp, date and interval types, which `ponder_sync` event
   * columns don't use.
   */
  const selectRows = async <query extends PromiseLike<unknown[]>>(
    {
      label,
      query,
      select,
    }: {
      label: string;
      query: query & { toSQL: () => { sql: string; params: unknown[] } };
      select: { [key: string]: PgColumn | undefined };
    },
    context?: { logger?: Logger },
  ): Promise<Awaited<query>> => {
    if (qb.$dialect !== "postgres") {
      return (await qb.wrap({ label }, () => query, context)) as Awaited<query>;
    }

    const keys = Object.keys(select);
    const decoders = keys.map((key) => {
      const column = select[key]!;
      return column.mapFromDriverValue === identityMapFromDriverValue
        ? undefined
        : column;
    });
    const { sql: text, params } = query.toSQL();

    const result = await qb.wrap(
      { label },
      () =>
        (qb.$client as pg.Pool).query<unknown[]>({
          text,
          values: params,
          rowMode: "array",
        }),
      context,
    );

    const rows = new Array(result.rows.length);
    for (let r = 0; r < result.rows.length; r++) {
      const values = result.rows[r]!;
      const row: { [key: string]: unknown } = {};
      for (let c = 0; c < keys.length; c++) {
        const value = values[c];
        row[keys[c]!] =
          value === null || decoders[c] === undefined
            ? value
            : decoders[c]!.mapFromDriverValue(value);
      }
      rows[r] = row;
    }
    return rows as Awaited<query>;
  };

  const insertRows = async (
    {
      label,
      table,
      rows,
      target,
    }: {
      label: string;
      table: PgTable;
      rows: Record<string, unknown>[];
      target: string[];
    },
    context?: { logger?: Logger },
  ) => {
    if (rows.length === 0) return;

    const tableColumns = getTableColumns(table);
    const keys = Object.keys(rows[0]!);
    const columns = keys.map((key) => tableColumns[key]!);
    const { schema, name } = getTableConfig(table);
    // Note: The sync query builders use `casing: "snake_case"`.
    const columnName = (column: PgColumn) =>
      column.keyAsName ? toSnakeCase(column.name) : column.name;
    const prefix = `INSERT INTO "${schema}"."${name}" (${columns
      .map((column) => `"${columnName(column)}"`)
      .join(", ")}) VALUES `;
    const suffix = ` ON CONFLICT (${target
      .map((key) => `"${columnName(tableColumns[key]!)}"`)
      .join(", ")}) DO NOTHING`;

    const batchSize = Math.floor(
      common.options.databaseMaxQueryParameters / keys.length,
    );

    const insertBatch = async (i: number) => {
      const batch = rows.slice(i, i + batchSize);
      const params: unknown[] = new Array(batch.length * keys.length);
      const tuples: string[] = new Array(batch.length);
      let p = 0;
      for (let r = 0; r < batch.length; r++) {
        const row = batch[r]!;
        let tuple = "(";
        for (let c = 0; c < keys.length; c++) {
          const value = row[keys[c]!];
          params[p++] =
            value === undefined || value === null
              ? null
              : columns[c]!.mapToDriverValue(value);
          tuple += c === 0 ? `$${p}` : `, $${p}`;
        }
        tuples[r] = `${tuple})`;
      }
      const text = prefix + tuples.join(", ") + suffix;

      await qb.wrap(
        { label },
        () => (qb.$client as pg.Pool).query(text, params),
        context,
      );
    };

    for (let i = 0; i < rows.length; i += batchSize) await insertBatch(i);
  };

  const syncStore = {
    insertIntervals: async (
      { intervals, factoryIntervals, chainId },
      context,
    ) => {
      if (intervals.length === 0 && factoryIntervals.length === 0) return;

      const perFragmentIntervals = new Map<FragmentId, Interval[]>();
      const values: (typeof PONDER_SYNC.intervals.$inferInsert)[] = [];

      // dedupe and merge matching fragments

      for (const { filter, interval } of intervals) {
        for (const fragment of getFragments(filter)) {
          const fragmentId = encodeFragment(fragment.fragment);
          if (perFragmentIntervals.has(fragmentId) === false) {
            perFragmentIntervals.set(fragmentId, []);
          }

          perFragmentIntervals.get(fragmentId)!.push(interval);
        }
      }

      for (const { factory, interval } of factoryIntervals) {
        for (const fragment of getFactoryFragments(factory)) {
          const fragmentId = encodeFragment(fragment);
          if (perFragmentIntervals.has(fragmentId) === false) {
            perFragmentIntervals.set(fragmentId, []);
          }

          perFragmentIntervals.get(fragmentId)!.push(interval);
        }
      }

      // NOTE: In order to force proper range union behavior, `interval[1]` must
      // be rounded up.

      for (const [fragmentId, intervals] of perFragmentIntervals) {
        const numranges = intervals
          .map((interval) => {
            const start = interval[0];
            const end = interval[1] + 1;
            return `numrange(${start}, ${end}, '[]')`;
          })
          .join(", ");

        values.push({
          fragmentId: fragmentId,
          chainId: BigInt(chainId),
          // @ts-expect-error
          blocks: sql.raw(`nummultirange(${numranges})`),
        });
      }

      const batchSize = Math.floor(
        common.options.databaseMaxQueryParameters / 3,
      );

      for (let i = 0; i < values.length; i += batchSize) {
        await qb.wrap(
          { label: "insert_intervals" },
          (db) =>
            db
              .insert(PONDER_SYNC.intervals)
              .values(values.slice(i, i + batchSize))
              .onConflictDoUpdate({
                target: PONDER_SYNC.intervals.fragmentId,
                set: { blocks: sql`intervals.blocks + excluded.blocks` },
              }),
          context,
        );
      }
    },
    getIntervals: async ({ filters }, context) => {
      const queries: PgSelectBase<
        "unnested",
        {
          mergedBlocks: SQL.Aliased<string>;
          fragment: SQL.Aliased<unknown>;
        },
        "partial"
      >[] = [];
      let index = 0;

      for (const filter of filters) {
        const fragments = getFragments(filter);

        for (const fragment of fragments) {
          queries.push(
            qb.raw
              .select({
                mergedBlocks: sql<string>`range_agg(unnested.blocks)`.as(
                  "merged_blocks",
                ),
                fragment: sql.raw(`'${index++}'`).as("fragment"),
              })
              .from(
                qb.raw
                  .select({ blocks: sql.raw("unnest(blocks)").as("blocks") })
                  .from(PONDER_SYNC.intervals)
                  .where(
                    sql.raw(
                      `fragment_id IN (${fragment.adjacentIds.map((id) => `'${id}'`).join(", ")})`,
                    ),
                  )
                  .as("unnested"),
              ),
          );
        }

        for (const factory of getFilterFactories(filter)) {
          for (const fragment of getFactoryFragments(factory)) {
            queries.push(
              qb.raw
                .select({
                  mergedBlocks: sql<string>`range_agg(unnested.blocks)`.as(
                    "merged_blocks",
                  ),
                  fragment: sql.raw(`'${index++}'`).as("fragment"),
                })
                .from(
                  qb.raw
                    .select({
                      blocks: sql.raw("unnest(blocks)").as("blocks"),
                    })
                    .from(PONDER_SYNC.intervals)
                    .where(
                      sql.raw(`fragment_id = '${encodeFragment(fragment)}'`),
                    )
                    .as("unnested"),
                ),
            );
          }
        }
      }

      let rows: Awaited<(typeof queries)[number]> = [];

      if (queries.length > 1) {
        // Note: This query has no parameters, but there is a bug with
        // drizzle causing a "maximum call stack size exceeded" error.
        // Related: https://github.com/drizzle-team/drizzle-orm/issues/1740
        const batchSize = 200;

        for (let i = 0; i < queries.length; i += batchSize) {
          const batch = queries.slice(i, i + batchSize);
          const _rows = await qb.wrap(
            { label: "select_intervals" },
            () => {
              if (batch.length === 1) return batch[0]!.execute();

              // @ts-expect-error
              return unionAll(...batch);
            },
            context,
          );

          if (i === 0) {
            rows = _rows;
          } else {
            rows.push(..._rows);
          }
        }
      } else {
        rows = await qb.wrap(
          { label: "select_intervals" },
          () => queries[0]!.execute(),
          context,
        );
      }

      const result = new Map<
        Filter | Factory,
        { fragment: Fragment; intervals: Interval[] }[]
      >();

      // NOTE: `interval[1]` must be rounded down in order to offset the previous
      // rounding.

      index = 0;

      for (const filter of filters) {
        const fragments = getFragments(filter);
        result.set(filter, []);

        for (const fragment of fragments) {
          const intervals = rows
            .filter((row) => row.fragment === `${index}`)
            .map((row) =>
              (row.mergedBlocks
                ? (JSON.parse(
                    `[${row.mergedBlocks.slice(1, -1)}]`,
                  ) as Interval[])
                : []
              ).map((interval) => [interval[0], interval[1] - 1] as Interval),
            )[0]!;

          index += 1;

          result.get(filter)!.push({ fragment: fragment.fragment, intervals });
        }

        for (const factory of getFilterFactories(filter)) {
          result.set(factory, []);
          for (const fragment of getFactoryFragments(factory)) {
            const intervals = rows
              .filter((row) => row.fragment === `${index}`)
              .map((row) =>
                (row.mergedBlocks
                  ? (JSON.parse(
                      `[${row.mergedBlocks.slice(1, -1)}]`,
                    ) as Interval[])
                  : []
                ).map((interval) => [interval[0], interval[1] - 1] as Interval),
              )[0]!;

            index += 1;

            result.get(factory)!.push({ fragment, intervals });
          }
        }
      }

      return result;
    },
    insertChildAddresses: async ({ childAddresses, chainId }, context) => {
      if (childAddresses.size === 0) return;

      const factories = await qb.wrap(
        { label: "insert_factories" },
        (db) =>
          db
            .insert(PONDER_SYNC.factories)
            .values(
              Array.from(childAddresses.keys()).map((fragmentId) => ({
                fragmentId,
              })),
            )
            // @ts-expect-error bug with drizzle-orm
            .returning({
              id: PONDER_SYNC.factories.id,
              fragmentId: PONDER_SYNC.factories.fragmentId,
            })
            // Note: `DO UPDATE` makes `RETURNING` include rows that already exist.
            .onConflictDoUpdate({
              target: PONDER_SYNC.factories.fragmentId,
              set: { fragmentId: sql`excluded.fragment_id` },
            }),
        context,
      );

      const factoryIds = new Map<FactoryFragmentId, number>();
      for (const { id, fragmentId } of factories) {
        factoryIds.set(fragmentId, id);
      }

      const batchSize = Math.floor(
        common.options.databaseMaxQueryParameters / 4,
      );

      const values: (typeof PONDER_SYNC.factoryAddresses.$inferInsert)[] = [];

      for (const [fragmentId, _childAddresses] of childAddresses) {
        for (const [address, blockNumber] of _childAddresses) {
          values.push({
            factoryId: factoryIds.get(fragmentId)!,
            chainId: BigInt(chainId),
            blockNumber: BigInt(blockNumber),
            address,
          });
        }
      }

      for (let i = 0; i < values.length; i += batchSize) {
        await qb.wrap(
          { label: "insert_child_addresses" },
          (db) =>
            db
              .insert(PONDER_SYNC.factoryAddresses)
              .values(values.slice(i, i + batchSize))
              // Note: Live and historical sync can insert a child address that is
              // already stored. Keep one row per parent with the earliest block number.
              .onConflictDoUpdate({
                target: [
                  PONDER_SYNC.factoryAddresses.factoryId,
                  PONDER_SYNC.factoryAddresses.address,
                ],
                set: { blockNumber: sql`excluded.block_number` },
                setWhere: sql`excluded.block_number < ${PONDER_SYNC.factoryAddresses.blockNumber}`,
              }),
          context,
        );
      }
    },
    getChildAddresses: async ({ factory }, context) => {
      const fragmentIds = getFactoryFragmentIds(factory);

      const rows = await qb.wrap(
        { label: "select_child_addresses" },
        (db) =>
          db
            .select({
              address: PONDER_SYNC.factoryAddresses.address,
              blockNumber: PONDER_SYNC.factoryAddresses.blockNumber,
            })
            .from(PONDER_SYNC.factoryAddresses)
            .innerJoin(
              PONDER_SYNC.factories,
              eq(
                PONDER_SYNC.factoryAddresses.factoryId,
                PONDER_SYNC.factories.id,
              ),
            )
            .where(inArray(PONDER_SYNC.factories.fragmentId, fragmentIds)),
        context,
      );

      // Note: A child address can have more than one row, because more than one parent
      // can emit it. The earliest block number is used.

      const result = new Map<Address, number>();
      for (const { address, blockNumber } of rows) {
        if (
          result.has(address) === false ||
          result.get(address)! > Number(blockNumber)
        ) {
          result.set(address, Number(blockNumber));
        }
      }
      return result;
    },
    getSafeCrashRecoveryBlock: async ({ chainId, timestamp }, context) => {
      const rows = await qb.wrap(
        { label: "select_crash_recovery_block" },
        (db) =>
          db
            .select({
              number: PONDER_SYNC.blocks.number,
              timestamp: PONDER_SYNC.blocks.timestamp,
            })
            .from(PONDER_SYNC.blocks)
            .where(
              and(
                eq(PONDER_SYNC.blocks.chainId, BigInt(chainId)),
                lt(PONDER_SYNC.blocks.timestamp, BigInt(timestamp)),
              ),
            )
            .orderBy(desc(PONDER_SYNC.blocks.number))
            .limit(1),
        context,
      );

      return rows[0];
    },
    insertLogs: async ({ logs, chainId }, context) => {
      // Note: As an optimization, logs that are matched by a factory do
      // not contain a checkpoint, because not corresponding block is
      // fetched (no block.timestamp). However, when a log is matched by
      // both a log filter and a factory, the checkpoint must be included
      // in the db.
      await insertRows(
        {
          label: "insert_logs",
          table: PONDER_SYNC.logs,
          rows: logs.map((log) => encodeLog({ log, chainId })),
          target: ["chainId", "blockNumber", "logIndex"],
        },
        context,
      );
    },
    insertBlocks: async ({ blocks, chainId }, context) => {
      await insertRows(
        {
          label: "insert_blocks",
          table: PONDER_SYNC.blocks,
          rows: blocks.map((block) => encodeBlock({ block, chainId })),
          target: ["chainId", "number"],
        },
        context,
      );
    },
    insertTransactions: async ({ transactions, chainId }, context) => {
      await insertRows(
        {
          label: "insert_transactions",
          table: PONDER_SYNC.transactions,
          rows: transactions.map((transaction) =>
            encodeTransaction({ transaction, chainId }),
          ),
          target: ["chainId", "blockNumber", "transactionIndex"],
        },
        context,
      );
    },
    insertTransactionReceipts: async (
      { transactionReceipts, chainId },
      context,
    ) => {
      await insertRows(
        {
          label: "insert_transaction_receipts",
          table: PONDER_SYNC.transactionReceipts,
          rows: transactionReceipts.map((transactionReceipt) =>
            encodeTransactionReceipt({ transactionReceipt, chainId }),
          ),
          target: ["chainId", "blockNumber", "transactionIndex"],
        },
        context,
      );
    },
    insertTraces: async ({ traces, chainId }, context) => {
      await insertRows(
        {
          label: "insert_traces",
          table: PONDER_SYNC.traces,
          rows: traces.map(({ trace, block, transaction }) =>
            encodeTrace({ trace, block, transaction, chainId }),
          ),
          target: [
            "chainId",
            "blockNumber",
            "transactionIndex",
            "traceAddress",
          ],
        },
        context,
      );
    },
    getEventData: async (
      { filters, fromBlock, toBlock, chainId, limit },
      context,
    ): Promise<{
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
      const transactionFilters = activeFilters.filter(
        (f): f is TransactionFilter => f.type === "transaction",
      );
      const traceFilters = activeFilters.filter(
        (f): f is TraceFilter => f.type === "trace",
      );
      const transferFilters = activeFilters.filter(
        (f): f is TransferFilter => f.type === "transfer",
      );

      const logBlockRange = getFilterBlockRange({
        filters: logFilters,
        fromBlock,
        toBlock,
      });
      const traceBlockRange = getFilterBlockRange({
        filters: [...traceFilters, ...transferFilters],
        fromBlock,
        toBlock,
      });

      const shouldQueryBlocks = true;
      const shouldQueryLogs = logFilters.length > 0;
      const shouldQueryTraces =
        traceFilters.length > 0 || transferFilters.length > 0;
      const shouldQueryTransactions =
        transactionFilters.length > 0 || shouldQueryLogs || shouldQueryTraces;
      const shouldQueryTransactionReceipts = activeFilters.some(
        (filter) => filter.hasTransactionReceipt,
      );

      type BlockSelect = {
        [P in RequiredInternalBlockColumns]: (typeof PONDER_SYNC.blocks)[P];
      } & {
        [P in Exclude<
          keyof typeof PONDER_SYNC.blocks.$inferSelect,
          RequiredInternalBlockColumns
        >]?: (typeof PONDER_SYNC.blocks)[P];
      };
      type TransactionSelect = {
        [P in RequiredInternalTransactionColumns]: (typeof PONDER_SYNC.transactions)[P];
      } & {
        [P in Exclude<
          keyof typeof PONDER_SYNC.transactions.$inferSelect,
          RequiredInternalTransactionColumns
        >]?: (typeof PONDER_SYNC.transactions)[P];
      };
      type TransactionReceiptSelect = {
        [P in RequiredInternalTransactionReceiptColumns]: (typeof PONDER_SYNC.transactionReceipts)[P];
      } & {
        [P in Exclude<
          keyof typeof PONDER_SYNC.transactionReceipts.$inferSelect,
          RequiredInternalTransactionReceiptColumns
        >]?: (typeof PONDER_SYNC.transactionReceipts)[P];
      };
      type TraceSelect = {
        [P in RequiredInternalTraceColumns]: (typeof PONDER_SYNC.traces)[P];
      } & {
        [P in Exclude<
          keyof typeof PONDER_SYNC.traces.$inferSelect,
          RequiredInternalTraceColumns
        >]?: (typeof PONDER_SYNC.traces)[P];
      };
      // Note: `LogSelect` doesn't exist because all log columns are required.

      const blockSelect: BlockSelect = {
        number: PONDER_SYNC.blocks.number,
        hash: PONDER_SYNC.blocks.hash,
        timestamp: PONDER_SYNC.blocks.timestamp,
      };

      for (const column of unionFilterIncludeBlock(filters)) {
        // @ts-expect-error
        blockSelect[column] = PONDER_SYNC.blocks[column];
      }

      const blocksQuery = qb.raw
        .select(blockSelect)
        .from(PONDER_SYNC.blocks)
        .where(
          and(
            eq(PONDER_SYNC.blocks.chainId, BigInt(chainId)),
            gte(PONDER_SYNC.blocks.number, BigInt(fromBlock)),
            lte(PONDER_SYNC.blocks.number, BigInt(toBlock)),
          ),
        )
        .orderBy(asc(PONDER_SYNC.blocks.number))
        .limit(limit);

      const transactionSelect: TransactionSelect = {
        blockNumber: PONDER_SYNC.transactions.blockNumber,
        transactionIndex: PONDER_SYNC.transactions.transactionIndex,
        from: PONDER_SYNC.transactions.from,
        to: PONDER_SYNC.transactions.to,
        hash: PONDER_SYNC.transactions.hash,
        type: PONDER_SYNC.transactions.type,
      };

      for (const column of unionFilterIncludeTransaction(filters)) {
        // @ts-expect-error
        transactionSelect[column] = PONDER_SYNC.transactions[column];
      }

      const transactionsQuery = qb.raw
        .select(transactionSelect)
        .from(PONDER_SYNC.transactions)
        .where(
          and(
            eq(PONDER_SYNC.transactions.chainId, BigInt(chainId)),
            gte(PONDER_SYNC.transactions.blockNumber, BigInt(fromBlock)),
            lte(PONDER_SYNC.transactions.blockNumber, BigInt(toBlock)),
          ),
        )
        .orderBy(
          asc(PONDER_SYNC.transactions.blockNumber),
          asc(PONDER_SYNC.transactions.transactionIndex),
        )
        .limit(limit);

      const transactionReceiptSelect: TransactionReceiptSelect = {
        blockNumber: PONDER_SYNC.transactionReceipts.blockNumber,
        transactionIndex: PONDER_SYNC.transactionReceipts.transactionIndex,
        status: PONDER_SYNC.transactionReceipts.status,
        from: PONDER_SYNC.transactionReceipts.from,
        to: PONDER_SYNC.transactionReceipts.to,
      };

      for (const column of unionFilterIncludeTransactionReceipt(filters)) {
        // @ts-expect-error
        transactionReceiptSelect[column] =
          PONDER_SYNC.transactionReceipts[column];
      }

      const transactionReceiptsQuery = qb.raw
        .select(transactionReceiptSelect)
        .from(PONDER_SYNC.transactionReceipts)
        .where(
          and(
            eq(PONDER_SYNC.transactionReceipts.chainId, BigInt(chainId)),
            gte(PONDER_SYNC.transactionReceipts.blockNumber, BigInt(fromBlock)),
            lte(PONDER_SYNC.transactionReceipts.blockNumber, BigInt(toBlock)),
          ),
        )
        .orderBy(
          asc(PONDER_SYNC.transactionReceipts.blockNumber),
          asc(PONDER_SYNC.transactionReceipts.transactionIndex),
        )
        .limit(limit);

      const traceSelect: TraceSelect = {
        blockNumber: PONDER_SYNC.traces.blockNumber,
        transactionIndex: PONDER_SYNC.traces.transactionIndex,
        from: PONDER_SYNC.traces.from,
        to: PONDER_SYNC.traces.to,
        input: PONDER_SYNC.traces.input,
        output: PONDER_SYNC.traces.output,
        value: PONDER_SYNC.traces.value,
        type: PONDER_SYNC.traces.type,
        traceAddress: PONDER_SYNC.traces.traceAddress,
      };

      for (const column of unionFilterIncludeTrace(filters)) {
        // @ts-expect-error
        traceSelect[column] = PONDER_SYNC.traces[column];
      }

      const tracesQuery = qb.raw
        .select(traceSelect)
        .from(PONDER_SYNC.traces)
        .where(
          and(
            eq(PONDER_SYNC.traces.chainId, BigInt(chainId)),
            gte(
              PONDER_SYNC.traces.blockNumber,
              BigInt(traceBlockRange.fromBlock),
            ),
            lte(
              PONDER_SYNC.traces.blockNumber,
              BigInt(traceBlockRange.toBlock),
            ),
            or(
              ...traceFilters.map((filter) => traceFilter(filter)),
              ...transferFilters.map((filter) => transferFilter(filter)),
            ),
          ),
        )
        .orderBy(
          asc(PONDER_SYNC.traces.blockNumber),
          asc(PONDER_SYNC.traces.transactionIndex),
          asc(PONDER_SYNC.traces.traceAddress),
        )
        .limit(limit);

      const logSelect = {
        blockNumber: PONDER_SYNC.logs.blockNumber,
        logIndex: PONDER_SYNC.logs.logIndex,
        transactionIndex: PONDER_SYNC.logs.transactionIndex,
        address: PONDER_SYNC.logs.address,
        topic0: PONDER_SYNC.logs.topic0,
        topic1: PONDER_SYNC.logs.topic1,
        topic2: PONDER_SYNC.logs.topic2,
        topic3: PONDER_SYNC.logs.topic3,
        data: PONDER_SYNC.logs.data,
      };

      const logsQuery = qb.raw
        .select(logSelect)
        .from(PONDER_SYNC.logs)
        .where(
          and(
            eq(PONDER_SYNC.logs.chainId, BigInt(chainId)),
            gte(PONDER_SYNC.logs.blockNumber, BigInt(logBlockRange.fromBlock)),
            lte(PONDER_SYNC.logs.blockNumber, BigInt(logBlockRange.toBlock)),
            or(...logFilters.map((filter) => logFilter(filter))),
          ),
        )
        .orderBy(
          asc(PONDER_SYNC.logs.blockNumber),
          asc(PONDER_SYNC.logs.logIndex),
        )
        .limit(limit);

      const [
        blocksRows,
        transactionsRows,
        transactionReceiptsRows,
        logsRows,
        tracesRows,
      ] = await Promise.all([
        shouldQueryBlocks
          ? selectRows(
              {
                label: "select_blocks",
                query: blocksQuery,
                select: blockSelect,
              },
              context,
            )
          : [],
        shouldQueryTransactions
          ? selectRows(
              {
                label: "select_transactions",
                query: transactionsQuery,
                select: transactionSelect,
              },
              context,
            )
          : [],
        shouldQueryTransactionReceipts
          ? selectRows(
              {
                label: "select_transaction_receipts",
                query: transactionReceiptsQuery,
                select: transactionReceiptSelect,
              },
              context,
            )
          : [],
        shouldQueryLogs
          ? selectRows(
              { label: "select_logs", query: logsQuery, select: logSelect },
              context,
            )
          : [],
        shouldQueryTraces
          ? selectRows(
              {
                label: "select_traces",
                query: tracesQuery,
                select: traceSelect,
              },
              context,
            )
          : [],
      ]);

      const supremum = Math.min(
        blocksRows.length < limit
          ? Number.POSITIVE_INFINITY
          : Number(blocksRows[blocksRows.length - 1]!.number),
        transactionsRows.length < limit
          ? Number.POSITIVE_INFINITY
          : Number(transactionsRows[transactionsRows.length - 1]!.blockNumber),
        transactionReceiptsRows.length < limit
          ? Number.POSITIVE_INFINITY
          : Number(
              transactionReceiptsRows[transactionReceiptsRows.length - 1]!
                .blockNumber,
            ),
        logsRows.length < limit
          ? Number.POSITIVE_INFINITY
          : Number(logsRows[logsRows.length - 1]!.blockNumber),
        tracesRows.length < limit
          ? Number.POSITIVE_INFINITY
          : Number(tracesRows[tracesRows.length - 1]!.blockNumber),
      );

      let cursor: number;
      if (
        Math.max(
          blocksRows.length,
          transactionsRows.length,
          transactionReceiptsRows.length,
          logsRows.length,
          tracesRows.length,
        ) !== limit
      ) {
        cursor = toBlock;
      } else if (
        blocksRows.length === limit &&
        Math.max(
          transactionsRows.length,
          transactionReceiptsRows.length,
          logsRows.length,
          tracesRows.length,
        ) !== limit
      ) {
        // all events for `supremum` block have been extracted
        cursor = supremum;
      } else {
        // there may be events for `supremum` block that have not been extracted
        cursor = supremum - 1;

        if (cursor < fromBlock) {
          return syncStore.getEventData(
            {
              filters,
              fromBlock,
              toBlock,
              chainId,
              limit: limit * 2,
            },
            context,
          );
        }
      }

      return formatEventData({
        common,
        blocksRows,
        transactionsRows,
        transactionReceiptsRows,
        tracesRows,
        logsRows,
        cursor,
      });
    },
    insertRpcRequestResults: async ({ requests, chainId }, context) => {
      if (requests.length === 0) return;

      const values = requests.map(({ request, blockNumber, result }) => ({
        requestHash: crypto
          .createHash("md5")
          .update(toLowerCase(JSON.stringify(orderObject(request))))
          .digest("hex"),
        chainId: BigInt(chainId),
        blockNumber: blockNumber ? BigInt(blockNumber) : undefined,
        result,
      }));

      await qb.wrap(
        { label: "insert_rpc_requests" },
        (db) =>
          db
            .insert(PONDER_SYNC.rpcRequestResults)
            .values(values)
            .onConflictDoNothing({
              target: [
                PONDER_SYNC.rpcRequestResults.requestHash,
                PONDER_SYNC.rpcRequestResults.chainId,
              ],
            }),
        context,
      );
    },
    getRpcRequestResults: async ({ requests, chainId }, context) => {
      if (requests.length === 0) return [];

      // Optimized fast path for high number of `requests` using a range of block numbers
      // rather than querying each request individually.

      const blockNumbersByRequest: (number | undefined)[] = new Array(
        requests.length,
      );

      for (let i = 0; i < requests.length; i++) {
        const blockNumber = extractBlockNumberParam(requests[i]!);

        // Note: "latest" is not considered a block number
        if (isHex(blockNumber)) {
          blockNumbersByRequest[i] = hexToNumber(blockNumber);
        } else {
          blockNumbersByRequest[i] = undefined;
        }
      }

      // Note: Hashing is only needed to match rows; the range query goes first, so a range
      // with nothing cached (indexed for the first time) costs no hashing.
      let hashes: string[] | undefined;
      const getRequestHashes = () => {
        if (hashes === undefined) {
          hashes = requests.map((request) =>
            crypto
              .createHash("md5")
              .update(toLowerCase(JSON.stringify(orderObject(request))))
              .digest("hex"),
          );
        }
        return hashes;
      };

      const blockNumbers = blockNumbersByRequest.filter(
        (blockNumber): blockNumber is number => blockNumber !== undefined,
      );

      if (blockNumbers.length > 100) {
        let minBlockNumber = blockNumbers[0]!;
        let maxBlockNumber = blockNumbers[0]!;
        for (const n of blockNumbers) {
          if (n < minBlockNumber) minBlockNumber = n;
          if (n > maxBlockNumber) maxBlockNumber = n;
        }

        const nonBlockRequestHashes =
          blockNumbers.length === requests.length
            ? []
            : getRequestHashes().filter(
                (_, i) => blockNumbersByRequest[i] === undefined,
              );

        const result = await Promise.all([
          qb.wrap(
            { label: "select_rpc_requests" },
            (db) =>
              db
                .select({
                  request_hash: PONDER_SYNC.rpcRequestResults.requestHash,
                  result: PONDER_SYNC.rpcRequestResults.result,
                })
                .from(PONDER_SYNC.rpcRequestResults)
                .where(
                  and(
                    eq(PONDER_SYNC.rpcRequestResults.chainId, BigInt(chainId)),
                    gte(
                      PONDER_SYNC.rpcRequestResults.blockNumber,
                      BigInt(minBlockNumber),
                    ),
                    lte(
                      PONDER_SYNC.rpcRequestResults.blockNumber,
                      BigInt(maxBlockNumber),
                    ),
                  ),
                ),
            context,
          ),
          nonBlockRequestHashes.length === 0
            ? []
            : qb.wrap(
                { label: "select_rpc_requests" },
                (db) =>
                  db
                    .select({
                      request_hash: PONDER_SYNC.rpcRequestResults.requestHash,
                      result: PONDER_SYNC.rpcRequestResults.result,
                    })
                    .from(PONDER_SYNC.rpcRequestResults)
                    .where(
                      and(
                        eq(
                          PONDER_SYNC.rpcRequestResults.chainId,
                          BigInt(chainId),
                        ),
                        inArray(
                          PONDER_SYNC.rpcRequestResults.requestHash,
                          nonBlockRequestHashes,
                        ),
                      ),
                    ),
                context,
              ),
        ]);

        if (result[0]!.length === 0 && result[1]!.length === 0) {
          return new Array<undefined>(requests.length);
        }

        const results = new Map<string, string | undefined>();
        for (const row of result[0]!) {
          results.set(row.request_hash, row.result);
        }
        for (const row of result[1]!) {
          results.set(row.request_hash, row.result);
        }

        return getRequestHashes().map((requestHash) =>
          results.get(requestHash),
        );
      }

      const requestHashes = getRequestHashes();

      const result = await qb.wrap(
        { label: "select_rpc_requests" },
        (db) =>
          db
            .select({
              request_hash: PONDER_SYNC.rpcRequestResults.requestHash,
              result: PONDER_SYNC.rpcRequestResults.result,
            })
            .from(PONDER_SYNC.rpcRequestResults)
            .where(
              and(
                eq(PONDER_SYNC.rpcRequestResults.chainId, BigInt(chainId)),
                inArray(
                  PONDER_SYNC.rpcRequestResults.requestHash,
                  requestHashes,
                ),
              ),
            ),
        context,
      );

      const results = new Map<string, string | undefined>();
      for (const row of result) {
        results.set(row.request_hash, row.result);
      }

      return requestHashes.map((requestHash) => results.get(requestHash));
    },
    pruneRpcRequestResults: async ({ blocks, chainId }, context) => {
      if (blocks.length === 0) return;

      const numbers = blocks.map(({ number }) => BigInt(hexToNumber(number)));

      await qb.wrap(
        { label: "delete_rpc_requests" },
        (db) =>
          db
            .delete(PONDER_SYNC.rpcRequestResults)
            .where(
              and(
                eq(PONDER_SYNC.rpcRequestResults.chainId, BigInt(chainId)),
                inArray(PONDER_SYNC.rpcRequestResults.blockNumber, numbers),
              ),
            ),
        context,
      );
    },
    pruneByChain: async ({ chainId }, context) =>
      qb.transaction(async (tx) => {
        await tx.wrap(
          { label: "delete_logs" },
          (db) =>
            db
              .delete(PONDER_SYNC.logs)
              .where(eq(PONDER_SYNC.logs.chainId, BigInt(chainId)))
              .execute(),
          context,
        );
        await tx.wrap(
          { label: "delete_blocks" },
          (db) =>
            db
              .delete(PONDER_SYNC.blocks)
              .where(eq(PONDER_SYNC.blocks.chainId, BigInt(chainId)))
              .execute(),
          context,
        );
        await tx.wrap(
          { label: "delete_traces" },
          (db) =>
            db
              .delete(PONDER_SYNC.traces)
              .where(eq(PONDER_SYNC.traces.chainId, BigInt(chainId)))
              .execute(),
          context,
        );
        await tx.wrap(
          { label: "delete_transactions" },
          (db) =>
            db
              .delete(PONDER_SYNC.transactions)
              .where(eq(PONDER_SYNC.transactions.chainId, BigInt(chainId)))
              .execute(),
          context,
        );
        await tx.wrap(
          { label: "delete_transaction_receipts" },
          (db) =>
            db
              .delete(PONDER_SYNC.transactionReceipts)
              .where(
                eq(PONDER_SYNC.transactionReceipts.chainId, BigInt(chainId)),
              )
              .execute(),
          context,
        );
        await tx.wrap(
          { label: "delete_factory_addresses" },
          (db) =>
            db
              .delete(PONDER_SYNC.factoryAddresses)
              .where(eq(PONDER_SYNC.factoryAddresses.chainId, BigInt(chainId)))
              .execute(),
          context,
        );
      }),
  } satisfies SyncStore;

  return syncStore;
};

const addressFilter = (
  address:
    | LogFilter["address"]
    | TransactionFilter["fromAddress"]
    | TransactionFilter["toAddress"],
  column: PgColumn,
): SQL => {
  // `factory` filtering is handled in-memory
  if (isAddressFactory(address)) return sql`true`;
  if (Array.isArray(address)) return inArray(column, address);
  if (typeof address === "string") return eq(column, address);
  return sql`true`;
};

/**
 * @dev It's an invariant that the returned `fromBlock <= toBlock`.
 */
export const getFilterBlockRange = ({
  filters,
  fromBlock,
  toBlock,
}: {
  filters: Pick<Filter, "fromBlock" | "toBlock">[];
  fromBlock: number;
  toBlock: number;
}) => {
  if (filters.length === 0) return { fromBlock, toBlock };

  const ranges = filters.map((filter) => ({
    fromBlock: Math.max(fromBlock, filter.fromBlock ?? fromBlock),
    toBlock: Math.min(toBlock, filter.toBlock ?? toBlock),
  }));

  return {
    fromBlock: Math.min(...ranges.map((range) => range.fromBlock)),
    toBlock: Math.max(...ranges.map((range) => range.toBlock)),
  };
};

export const isFilterInBlockRange = ({
  filter,
  fromBlock,
  toBlock,
}: {
  filter: Pick<Filter, "fromBlock" | "toBlock">;
  fromBlock: number;
  toBlock: number;
}) =>
  (filter.fromBlock ?? Number.NEGATIVE_INFINITY) <= toBlock &&
  (filter.toBlock ?? Number.POSITIVE_INFINITY) >= fromBlock;

export const logFilter = (filter: LogFilter): SQL => {
  const conditions: SQL[] = [];

  for (const idx of [0, 1, 2, 3] as const) {
    // If it's an array of length 1, collapse it.
    const raw = filter[`topic${idx}`] ?? null;
    if (raw === null) continue;
    const topic = Array.isArray(raw) && raw.length === 1 ? raw[0]! : raw;
    if (Array.isArray(topic)) {
      conditions.push(inArray(PONDER_SYNC.logs[`topic${idx}`], topic));
    } else {
      conditions.push(eq(PONDER_SYNC.logs[`topic${idx}`], topic));
    }
  }

  conditions.push(addressFilter(filter.address, PONDER_SYNC.logs.address));

  return and(...conditions)!;
};

export const blockFilter = (filter: BlockFilter): SQL => {
  const conditions: SQL[] = [];

  conditions.push(
    sql`(blocks.number - ${filter.offset}) % ${filter.interval} = 0`,
  );

  return and(...conditions)!;
};

export const transactionFilter = (filter: TransactionFilter): SQL => {
  const conditions: SQL[] = [];

  conditions.push(
    addressFilter(filter.fromAddress, PONDER_SYNC.transactions.from),
  );
  conditions.push(addressFilter(filter.toAddress, PONDER_SYNC.transactions.to));

  return and(...conditions)!;
};

export const transferFilter = (filter: TransferFilter): SQL => {
  const conditions: SQL[] = [];

  conditions.push(addressFilter(filter.fromAddress, PONDER_SYNC.traces.from));
  conditions.push(addressFilter(filter.toAddress, PONDER_SYNC.traces.to));

  return and(...conditions)!;
};

export const traceFilter = (filter: TraceFilter): SQL => {
  const conditions: SQL[] = [];

  conditions.push(addressFilter(filter.fromAddress, PONDER_SYNC.traces.from));
  conditions.push(addressFilter(filter.toAddress, PONDER_SYNC.traces.to));

  if (filter.callType !== undefined) {
    conditions.push(eq(PONDER_SYNC.traces.type, filter.callType));
  }

  if (filter.functionSelector !== undefined) {
    conditions.push(
      eq(sql`substring(traces.input from 1 for 10)`, filter.functionSelector),
    );
  }

  return and(...conditions)!;
};
