import { onchainTable } from "ponder";

export const transferReceipt = onchainTable("transfer_receipt", (t) => ({
  id: t.text().primaryKey(),
  txHash: t.hex().notNull(),
  txFrom: t.hex().notNull(),
  txTo: t.hex(),
  txInput: t.hex().notNull(),
  txValue: t.bigint().notNull(),
  txNonce: t.integer().notNull(),
  txType: t.text().notNull(),
  txGasPrice: t.bigint(),
  gasUsed: t.bigint().notNull(),
  cumulativeGasUsed: t.bigint().notNull(),
  effectiveGasPrice: t.bigint().notNull(),
  status: t.text().notNull(),
  contractAddress: t.hex(),
  blockHash: t.hex().notNull(),
  blockMiner: t.hex().notNull(),
  blockBaseFee: t.bigint(),
}));

export const hubTransaction = onchainTable("hub_transaction", (t) => ({
  hash: t.hex().primaryKey(),
  direction: t.text().notNull(),
  from: t.hex().notNull(),
  to: t.hex(),
  value: t.bigint().notNull(),
  input: t.hex().notNull(),
  status: t.text().notNull(),
  gasUsed: t.bigint().notNull(),
  blockNumber: t.bigint().notNull(),
}));

export const blockSnapshot = onchainTable("block_snapshot", (t) => ({
  number: t.bigint().primaryKey(),
  hash: t.hex().notNull(),
  parentHash: t.hex().notNull(),
  timestamp: t.bigint().notNull(),
  gasUsed: t.bigint().notNull(),
  gasLimit: t.bigint().notNull(),
  miner: t.hex().notNull(),
  stateRoot: t.hex().notNull(),
  logsBloom: t.hex().notNull(),
  extraData: t.hex().notNull(),
  difficulty: t.bigint().notNull(),
  totalDifficulty: t.bigint(),
  size: t.bigint().notNull(),
  nonce: t.hex(),
  mixHash: t.hex(),
}));
