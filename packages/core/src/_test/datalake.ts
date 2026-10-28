import {
  RecordBatch,
  Schema,
  Table,
  tableFromIPC,
  tableToIPC,
} from "apache-arrow";
import { expect } from "vitest";
import {
  standardizeBlock,
  standardizeLogs,
  standardizeTransactionReceipts,
  standardizeTransactions,
} from "@/rpc/actions.js";
import { type DatalakePage, splitStreams } from "@/sync-datalake/client.js";
import { type EncodeKeys, encodePage } from "@/sync-datalake/encode.js";
import {
  encodeBlock,
  encodeLog,
  encodeTransaction,
  encodeTransactionReceipt,
} from "@/sync-store/encode.js";

/** `bytes` with the `bl.*` metadata of every stream changed (`undefined` removes a key). */
export const withMetadata = (
  bytes: Uint8Array,
  patch: Record<string, string | undefined>,
) =>
  Buffer.concat(
    splitStreams(bytes).map((stream) => {
      const table = tableFromIPC(stream);
      const metadata = new Map(table.schema.metadata);
      for (const [key, value] of Object.entries(patch)) {
        if (value === undefined) metadata.delete(key);
        else metadata.set(key, value);
      }
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

/** Every `ponder_sync` column, per row type. */
export const ALL_KEYS: EncodeKeys = {
  block: [
    "chainId",
    "number",
    "timestamp",
    "hash",
    "parentHash",
    "logsBloom",
    "miner",
    "gasUsed",
    "gasLimit",
    "baseFeePerGas",
    "nonce",
    "mixHash",
    "stateRoot",
    "receiptsRoot",
    "transactionsRoot",
    "sha3Uncles",
    "size",
    "difficulty",
    "totalDifficulty",
    "extraData",
  ],
  transaction: [
    "chainId",
    "blockNumber",
    "transactionIndex",
    "hash",
    "blockHash",
    "from",
    "to",
    "input",
    "value",
    "nonce",
    "r",
    "s",
    "v",
    "type",
    "gas",
    "gasPrice",
    "maxFeePerGas",
    "maxPriorityFeePerGas",
    "accessList",
  ],
  transactionReceipt: [
    "chainId",
    "blockNumber",
    "transactionIndex",
    "transactionHash",
    "blockHash",
    "from",
    "to",
    "contractAddress",
    "logsBloom",
    "gasUsed",
    "cumulativeGasUsed",
    "effectiveGasPrice",
    "status",
    "type",
  ],
  log: [
    "chainId",
    "blockNumber",
    "logIndex",
    "transactionIndex",
    "blockHash",
    "transactionHash",
    "address",
    "topic0",
    "topic1",
    "topic2",
    "topic3",
    "data",
  ],
};

/** JSON-RPC responses for a block range, as a node returns them. */
export type RpcData = {
  /** `eth_getBlockByNumber(n, true)`, keeping only the transactions to compare. */
  blocks: any[];
  /** `eth_getBlockReceipts`, the receipts to compare, block order. */
  receipts: any[];
  /** `eth_getLogs`, the logs to compare, block order. */
  logs: any[];
};

const expectRows = (
  kind: string,
  actual: Record<string, unknown>[],
  expected: Record<string, unknown>[],
  keys: string[],
  id: (row: Record<string, unknown>) => string,
) => {
  expect(actual.length, `${kind} count`).toBe(expected.length);
  for (const [i, row] of expected.entries()) {
    expect(Object.keys(actual[i]!), `${kind} ${id(row)} keys`).toEqual(keys);
    for (const key of keys) {
      expect(actual[i]![key], `${kind} ${id(row)} ${key}`).toStrictEqual(
        row[key],
      );
    }
  }
};

/**
 * Assert that the rows `encodePage` makes from a datalake page equal the rows the JSON-RPC path
 * stores for the same data (`standardize*` then `encode*`), for every `ponder_sync` column.
 */
export const expectSameAsRpc = (
  page: DatalakePage,
  chainId: number,
  withReceipts: boolean,
  rpc: RpcData,
) => {
  const actual = encodePage(page, chainId, withReceipts, ALL_KEYS);

  const expectedBlocks = rpc.blocks.map((b: any) =>
    encodeBlock({
      block: standardizeBlock(
        { ...b, transactions: [] },
        { method: "eth_getBlockByNumber", params: [b.number, true] },
      ),
      chainId,
    }),
  );
  expectRows(
    "block",
    Array.from(actual.blocks.values()),
    expectedBlocks,
    ALL_KEYS.block,
    (row) => String(row.number),
  );

  const expectedTransactions = rpc.blocks.flatMap((b: any) =>
    standardizeTransactions(b.transactions, {
      method: "eth_getBlockByNumber",
      params: [b.number, true],
    }).map((transaction) => encodeTransaction({ transaction, chainId })),
  );
  expectRows(
    "transaction",
    actual.transactions,
    expectedTransactions,
    ALL_KEYS.transaction,
    (row) => String(row.hash),
  );

  // Note: One `eth_getBlockReceipts` per block, as the JSON-RPC path makes them (it sorts
  // a block's receipts by transaction index).
  const receiptsByBlock = Map.groupBy(rpc.receipts, (r: any) => r.blockNumber);
  const expectedReceipts = withReceipts
    ? Array.from(receiptsByBlock, ([blockNumber, receipts]) =>
        standardizeTransactionReceipts(receipts, {
          method: "eth_getBlockReceipts",
          params: [blockNumber],
        }),
      )
        .flat()
        .map((transactionReceipt) =>
          encodeTransactionReceipt({ transactionReceipt, chainId }),
        )
    : [];
  expectRows(
    "receipt",
    actual.transactionReceipts,
    expectedReceipts,
    ALL_KEYS.transactionReceipt,
    (row) => String(row.transactionHash),
  );

  const expectedLogs = standardizeLogs(rpc.logs, {
    method: "eth_getLogs",
    params: [{}],
  }).map((log) => encodeLog({ log, chainId }));
  expectRows(
    "log",
    actual.logs,
    expectedLogs,
    ALL_KEYS.log,
    (row) => `${row.blockNumber}/${row.logIndex}`,
  );
};
