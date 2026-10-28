import { onchainTable } from "ponder";

// Every field of the event's transaction, so a datalake/JSON-RPC difference in any
// transaction shape (legacy, EIP-2930, EIP-1559, blob) changes the digest.
const txColumns = (t: any) => ({
  txHash: t.hex().notNull(),
  txIndex: t.integer().notNull(),
  txFrom: t.hex().notNull(),
  txTo: t.hex(),
  txInput: t.hex().notNull(),
  txValue: t.bigint().notNull(),
  txNonce: t.integer().notNull(),
  txGas: t.bigint().notNull(),
  txType: t.text().notNull(),
  txGasPrice: t.bigint(),
  txMaxFeePerGas: t.bigint(),
  txMaxPriorityFeePerGas: t.bigint(),
  txAccessList: t.text(),
  txV: t.bigint(),
  txR: t.hex(),
  txS: t.hex(),
});

const receiptColumns = (t: any) => ({
  gasUsed: t.bigint().notNull(),
  cumulativeGasUsed: t.bigint().notNull(),
  effectiveGasPrice: t.bigint().notNull(),
  status: t.text().notNull(),
  contractAddress: t.hex(),
  receiptType: t.text().notNull(),
  receiptLogsBloom: t.hex().notNull(),
});

export const transfer = onchainTable("transfer", (t) => ({
  id: t.text().primaryKey(),
  token: t.hex().notNull(),
  from: t.hex().notNull(),
  to: t.hex().notNull(),
  amount: t.bigint().notNull(),
  logIndex: t.integer().notNull(),
  ...txColumns(t),
  ...receiptColumns(t),
}));

export const pair = onchainTable("pair", (t) => ({
  address: t.hex().primaryKey(),
  syncs: t.integer().notNull(),
  reserve0: t.bigint().notNull(),
  reserve1: t.bigint().notNull(),
  lastBlock: t.bigint().notNull(),
}));

export const accountTransaction = onchainTable("account_transaction", (t) => ({
  id: t.text().primaryKey(),
  account: t.text().notNull(),
  direction: t.text().notNull(),
  blockNumber: t.bigint().notNull(),
  ...txColumns(t),
  ...receiptColumns(t),
}));

export const blockSnapshot = onchainTable("block_snapshot", (t) => ({
  number: t.bigint().primaryKey(),
  hash: t.hex().notNull(),
  parentHash: t.hex().notNull(),
  timestamp: t.bigint().notNull(),
  gasUsed: t.bigint().notNull(),
  gasLimit: t.bigint().notNull(),
  baseFeePerGas: t.bigint(),
  miner: t.hex().notNull(),
  stateRoot: t.hex().notNull(),
  receiptsRoot: t.hex().notNull(),
  transactionsRoot: t.hex().notNull(),
  sha3Uncles: t.hex(),
  logsBloom: t.hex().notNull(),
  extraData: t.hex().notNull(),
  difficulty: t.bigint().notNull(),
  totalDifficulty: t.bigint(),
  size: t.bigint().notNull(),
  nonce: t.hex(),
  mixHash: t.hex(),
}));
