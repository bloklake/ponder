import type { Data, Table, Vector } from "apache-arrow";
import { zeroAddress, zeroHash } from "viem";
import { zeroLogsBloom } from "@/sync-realtime/bloom.js";
import type { DatalakePage } from "./client.js";

/**
 * Datalake Arrow rows → `ponder_sync` rows (the output of `sync-store/encode.ts`), projected to
 * the requested keys in their order, without going through JSON-RPC shapes.
 *
 * The values are exactly those of the JSON-RPC path (`standardize*` then `encode*`) for the same
 * data: a field a node omits (a column that was not requested) gets the standardization
 * default, a null value keeps the encoding's null handling. Binary columns are converted to hex
 * once per record batch.
 */

type Row = Record<string, unknown>;
type Getter = (i: number) => unknown;

/** Keys to produce, per row type (`ponder_sync` column names, in select order). */
export type EncodeKeys = {
  block: string[];
  transaction: string[];
  transactionReceipt: string[];
  log: string[];
};

const column = (table: Table, name: string): Vector | undefined =>
  (table.getChild(name) as Vector | null) ?? undefined;

const isValid = (data: Data, j: number) =>
  data.nullCount === 0 || data.getValid(j);

/** Lowercase hex of every value (without `0x`), `null` for a null value. */
const hexBodies = (vector: Vector): (string | null)[] => {
  const out: (string | null)[] = new Array(vector.length);
  let k = 0;
  for (const data of vector.data as Data[]) {
    const values = data.values as Uint8Array;
    const hex = Buffer.from(
      values.buffer,
      values.byteOffset,
      values.byteLength,
    ).toString("hex");
    const width = (data.type as { byteWidth?: number }).byteWidth;
    if (width !== undefined) {
      for (let j = 0; j < data.length; j++) {
        const start = (data.offset + j) * width * 2;
        out[k++] = isValid(data, j)
          ? hex.slice(start, start + width * 2)
          : null;
      }
    } else {
      const offsets = data.valueOffsets as Int32Array;
      for (let j = 0; j < data.length; j++) {
        out[k++] = isValid(data, j)
          ? hex.slice(
              offsets[data.offset + j]! * 2,
              offsets[data.offset + j + 1]! * 2,
            )
          : null;
      }
    }
  }
  return out;
};

/** Values of a numeric column (bigint for 64-bit types), `null` for a null value. */
const numbers = (vector: Vector): (number | bigint | null)[] => {
  const out: (number | bigint | null)[] = new Array(vector.length);
  let k = 0;
  for (const data of vector.data as Data[]) {
    const values = data.values as ArrayLike<number | bigint>;
    for (let j = 0; j < data.length; j++) {
      out[k++] = isValid(data, j) ? values[data.offset + j]! : null;
    }
  }
  return out;
};

const toBigInt = (n: number | bigint) =>
  typeof n === "bigint" ? n : BigInt(n);

/** Big-endian unsigned integer (hex body) → minimal quantity hex, `0x0` for zero. */
const quantityOfHex = (body: string) => {
  let i = 0;
  while (i < body.length - 1 && body.charCodeAt(i) === 48) i++;
  return `0x${body.slice(i)}`;
};

/** Getter builders over a table, memoized per column. */
const columns = (table: Table) => {
  const hexCache = new Map<string, (string | null)[] | undefined>();
  const numberCache = new Map<string, (number | bigint | null)[] | undefined>();
  const hexOf = (name: string) => {
    if (hexCache.has(name) === false) {
      const vector = column(table, name);
      hexCache.set(name, vector ? hexBodies(vector) : undefined);
    }
    return hexCache.get(name);
  };
  const numberOf = (name: string) => {
    if (numberCache.has(name) === false) {
      const vector = column(table, name);
      numberCache.set(name, vector ? numbers(vector) : undefined);
    }
    return numberCache.get(name);
  };

  return {
    /** Fixed-size or variable binary → `0x` hex; `absent` when the column is missing. */
    hex(name: string, absent: unknown): Getter {
      const values = hexOf(name);
      if (values === undefined) return () => absent;
      return (i) => {
        const v = values[i];
        return v === null ? null : `0x${v}`;
      };
    },
    /** Big-endian bytes → bigint; `ifNull` for a null value, `absent` when missing. */
    bigintOfBytes(name: string, ifNull: unknown, absent: unknown): Getter {
      const values = hexOf(name);
      if (values === undefined) return () => absent;
      return (i) => {
        const v = values[i];
        return v === null ? ifNull : BigInt(`0x${v}`);
      };
    },
    /** Big-endian bytes → minimal quantity hex (r, s). */
    quantityOfBytes(name: string, absent: unknown): Getter {
      const values = hexOf(name);
      if (values === undefined) return () => absent;
      return (i) => {
        const v = values[i];
        return v == null ? null : quantityOfHex(v);
      };
    },
    bigint(name: string, ifNull: unknown, absent: unknown): Getter {
      const values = numberOf(name);
      if (values === undefined) return () => absent;
      return (i) => {
        const v = values[i];
        return v === null || v === undefined ? ifNull : toBigInt(v);
      };
    },
    number(name: string, absent: unknown): Getter {
      const values = numberOf(name);
      if (values === undefined) return () => absent;
      return (i) => {
        const v = values[i];
        return v === null || v === undefined ? null : Number(v);
      };
    },
    /** Number → quantity hex (`type`, `status`). */
    quantity(name: string, ifNull: unknown, absent: unknown): Getter {
      const values = numberOf(name);
      if (values === undefined) return () => absent;
      return (i) => {
        const v = values[i];
        return v === null || v === undefined ? ifNull : `0x${v.toString(16)}`;
      };
    },
    numberOf,
  };
};

const rowsOf = (
  n: number,
  keys: string[],
  getters: Record<string, Getter>,
  kind: string,
): Row[] => {
  const selected = keys.map((key) => {
    const getter = getters[key];
    if (getter === undefined) {
      throw new Error(`Unsupported datalake ${kind} column '${key}'`);
    }
    return getter;
  });
  const rows: Row[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const row: Row = {};
    for (let k = 0; k < keys.length; k++) row[keys[k]!] = selected[k]!(i);
    rows[i] = row;
  }
  return rows;
};

const accessListJson = (vector: Vector | undefined): Getter => {
  if (vector === undefined) return () => null;
  return (i) => {
    const list = vector.get(i) as Vector | null;
    if (list == null) return null;
    const out: { address: string; storageKeys: string[] }[] = [];
    for (let e = 0; e < list.length; e++) {
      const entry = list.get(e) as {
        address: Uint8Array;
        storage_keys: Vector;
      };
      const storageKeys: string[] = [];
      for (let s = 0; s < entry.storage_keys.length; s++) {
        storageKeys.push(
          `0x${Buffer.from(entry.storage_keys.get(s) as Uint8Array).toString("hex")}`,
        );
      }
      out.push({
        address: `0x${Buffer.from(entry.address).toString("hex")}`,
        storageKeys,
      });
    }
    return JSON.stringify(out);
  };
};

export type EncodedPage = {
  /** Block number → block row. */
  blocks: Map<number, Row>;
  transactions: Row[];
  transactionReceipts: Row[];
  logs: Row[];
};

/** One datalake page → projected `ponder_sync` rows. */
export const encodePage = (
  page: DatalakePage,
  chainId: number,
  withReceipts: boolean,
  keys: EncodeKeys,
): EncodedPage => {
  const chain = BigInt(chainId);
  const blocks = new Map<number, Row>();
  // Note: Block hashes by number, for the transactions, receipts and logs of the page.
  const blockHashes = new Map<number, string>();

  if (page.blocks && page.blocks.numRows > 0) {
    const table = page.blocks;
    const c = columns(table);
    const hash = c.hex("hash", undefined);
    const getters: Record<string, Getter> = {
      chainId: () => chain,
      number: c.bigint("number", null, undefined),
      timestamp: c.bigint("timestamp", null, undefined),
      hash,
      parentHash: c.hex("parent_hash", undefined),
      logsBloom: c.hex("logs_bloom", undefined),
      miner: c.hex("miner", zeroAddress),
      gasUsed: c.bigint("gas_used", null, 0n),
      gasLimit: c.bigint("gas_limit", null, 0n),
      baseFeePerGas: c.bigintOfBytes("base_fee_per_gas", 0n, 0n),
      nonce: nullAs(c.hex("nonce", "0x0"), "0x0"),
      mixHash: nullAs(c.hex("mix_hash", zeroHash), zeroHash),
      stateRoot: c.hex("state_root", zeroHash),
      receiptsRoot: c.hex("receipts_root", undefined),
      transactionsRoot: c.hex("transactions_root", zeroHash),
      sha3Uncles: c.hex("sha3_uncles", zeroHash),
      size: c.bigint("size", null, 0n),
      difficulty: c.bigintOfBytes("difficulty", 0n, 0n),
      totalDifficulty: c.bigintOfBytes("total_difficulty", 0n, 0n),
      extraData: c.hex("extra_data", "0x"),
    };
    const rows = rowsOf(table.numRows, keys.block, getters, "block");
    const number = c.numberOf("number")!;
    for (let i = 0; i < table.numRows; i++) {
      const n = Number(number[i]);
      blocks.set(n, rows[i]!);
      blockHashes.set(n, hash(i) as string);
    }
  }

  const blockHashOf =
    (blockNumber: (number | bigint | null)[]) => (i: number) => {
      const hash = blockHashes.get(Number(blockNumber[i]));
      if (hash === undefined) {
        throw new Error(
          `Datalake response is missing block ${blockNumber[i]} of a row`,
        );
      }
      return hash;
    };

  let transactions: Row[] = [];
  let transactionReceipts: Row[] = [];
  if (page.transactions && page.transactions.numRows > 0) {
    const table = page.transactions;
    const c = columns(table);
    const blockNumber = c.numberOf("block_number")!;
    const blockHash = blockHashOf(blockNumber);
    const type = c.quantity("type", "0x0", "0x0");
    const common: Record<string, Getter> = {
      chainId: () => chain,
      blockNumber: c.bigint("block_number", null, undefined),
      transactionIndex: c.number("transaction_index", undefined),
      blockHash,
      from: c.hex("from", undefined),
      to: c.hex("to", null),
      type,
    };
    transactions = rowsOf(
      table.numRows,
      keys.transaction,
      {
        ...common,
        hash: c.hex("hash", undefined),
        input: c.hex("input", "0x"),
        value: c.bigintOfBytes("value", null, 0n),
        nonce: c.number("nonce", 0),
        r: c.quantityOfBytes("r", "0x0"),
        s: c.quantityOfBytes("s", "0x0"),
        v: c.bigint("v", null, 0n),
        gas: c.bigint("gas", null, 0n),
        gasPrice: c.bigintOfBytes("gas_price", null, null),
        maxFeePerGas: c.bigintOfBytes("max_fee_per_gas", null, null),
        maxPriorityFeePerGas: c.bigintOfBytes(
          "max_priority_fee_per_gas",
          null,
          null,
        ),
        accessList: accessListJson(column(table, "access_list")),
      },
      "transaction",
    );

    if (withReceipts) {
      const status = c.quantity("status", undefined, undefined);
      transactionReceipts = rowsOf(
        table.numRows,
        keys.transactionReceipt,
        {
          ...common,
          transactionHash: c.hex("hash", undefined),
          contractAddress: c.hex("contract_address", null),
          logsBloom: c.hex("logs_bloom", zeroLogsBloom),
          gasUsed: c.bigint("gas_used", null, 0n),
          cumulativeGasUsed: c.bigint("cumulative_gas_used", null, 0n),
          effectiveGasPrice: c.bigintOfBytes("effective_gas_price", null, 0n),
          status: (i) => {
            const value = status(i);
            // Note: As the JSON-RPC path, which requires `receipt.status`.
            if (value === undefined) {
              throw new Error(
                "Invalid datalake response: 'receipt.status' is a required property",
              );
            }
            return value;
          },
        },
        "transaction receipt",
      );
    }
  }

  let logs: Row[] = [];
  if (page.logs && page.logs.numRows > 0) {
    const table = page.logs;
    const c = columns(table);
    const blockNumber = c.numberOf("block_number")!;
    // Note: Topics end at the first null, as a JSON-RPC `topics` array.
    const topics = [0, 1, 2, 3].map((t) => c.hex(`topic${t}`, null));
    const topic =
      (t: number): Getter =>
      (i) => {
        for (let u = 0; u < t; u++) if (topics[u]!(i) === null) return null;
        return topics[t]!(i);
      };
    logs = rowsOf(
      table.numRows,
      keys.log,
      {
        chainId: () => chain,
        blockNumber: c.bigint("block_number", null, undefined),
        logIndex: c.number("log_index", undefined),
        transactionIndex: c.number("transaction_index", 0),
        blockHash: blockHashOf(blockNumber),
        transactionHash: c.hex("transaction_hash", zeroHash),
        address: c.hex("address", undefined),
        topic0: topic(0),
        topic1: topic(1),
        topic2: topic(2),
        topic3: topic(3),
        data: c.hex("data", undefined),
      },
      "log",
    );
  }

  return { blocks, transactions, transactionReceipts, logs };
};

/** A null value replaced (the JSON-RPC path turns these nulls into the default). */
const nullAs =
  (getter: Getter, value: unknown): Getter =>
  (i) =>
    getter(i) ?? value;
