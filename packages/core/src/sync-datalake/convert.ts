/** Datalake fields for the rows `encode.ts` makes, per row type (DSL camelCase names). */
export const DATALAKE_BLOCK_FIELDS = [
  "number",
  "hash",
  "parentHash",
  "timestamp",
  "size",
  "gasUsed",
  "gasLimit",
  "baseFeePerGas",
  "stateRoot",
  "transactionsRoot",
  "receiptsRoot",
  "logsBloom",
  "difficulty",
  "totalDifficulty",
  "miner",
  "nonce",
  "sha3Uncles",
  "mixHash",
  "extraData",
] as const;

export const DATALAKE_TRANSACTION_FIELDS = [
  "blockNumber",
  "transactionIndex",
  "hash",
  "from",
  "to",
  "value",
  "input",
  "nonce",
  "gas",
  "gasPrice",
  "maxFeePerGas",
  "maxPriorityFeePerGas",
  "type",
  "accessList",
  "v",
  "r",
  "s",
] as const;

export const DATALAKE_RECEIPT_FIELDS = [
  "gasUsed",
  "cumulativeGasUsed",
  "effectiveGasPrice",
  "status",
  "logsBloom",
  "contractAddress",
] as const;

export const DATALAKE_LOG_FIELDS = [
  "blockNumber",
  "logIndex",
  "transactionIndex",
  "transactionHash",
  "address",
  "topics",
  "data",
] as const;

export const toFieldMap = (fields: readonly string[]) =>
  Object.fromEntries(fields.map((f) => [f, true as const]));
