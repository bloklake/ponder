import { ponder } from "ponder:registry";
import {
  accountTransaction,
  blockSnapshot,
  pair,
  transfer,
} from "ponder:schema";

const txValues = (tx: any) => ({
  txHash: tx.hash,
  txIndex: tx.transactionIndex,
  txFrom: tx.from,
  txTo: tx.to,
  txInput: tx.input,
  txValue: tx.value,
  txNonce: tx.nonce,
  txGas: tx.gas,
  txType: tx.type,
  txGasPrice: tx.gasPrice ?? null,
  txMaxFeePerGas: tx.maxFeePerGas ?? null,
  txMaxPriorityFeePerGas: tx.maxPriorityFeePerGas ?? null,
  txAccessList:
    tx.accessList === undefined ? null : JSON.stringify(tx.accessList),
  txV: tx.v ?? null,
  txR: tx.r ?? null,
  txS: tx.s ?? null,
});

const receiptValues = (r: any) => ({
  gasUsed: r.gasUsed,
  cumulativeGasUsed: r.cumulativeGasUsed,
  effectiveGasPrice: r.effectiveGasPrice,
  status: r.status,
  contractAddress: r.contractAddress,
  receiptType: r.type,
  receiptLogsBloom: r.logsBloom,
});

ponder.on("Token:Transfer", async ({ event, context }) => {
  await context.db.insert(transfer).values({
    id: event.id,
    token: event.log.address,
    from: event.args.from,
    to: event.args.to,
    amount: event.args.value,
    logIndex: event.log.logIndex,
    ...txValues(event.transaction),
    ...receiptValues(event.transactionReceipt),
  });
});

ponder.on("Token:Approval", async () => {});

ponder.on("Pair:Sync", async ({ event, context }) => {
  await context.db
    .insert(pair)
    .values({
      address: event.log.address,
      syncs: 1,
      reserve0: event.args.reserve0,
      reserve1: event.args.reserve1,
      lastBlock: event.block.number,
    })
    .onConflictDoUpdate((row) => ({
      syncs: row.syncs + 1,
      reserve0: event.args.reserve0,
      reserve1: event.args.reserve1,
      lastBlock: event.block.number,
    }));
});

for (const account of ["Router", "BlobInbox", "BlobPoster"] as const) {
  for (const direction of ["from", "to"] as const) {
    ponder.on(
      `${account}:transaction:${direction}`,
      async ({ event, context }) => {
        await context.db.insert(accountTransaction).values({
          id: `${event.transaction.hash}-${direction}-${account}`,
          account,
          direction,
          blockNumber: event.block.number,
          ...txValues(event.transaction),
          ...receiptValues(event.transactionReceipt),
        });
      },
    );
  }
}

ponder.on("Every25:block", async ({ event, context }) => {
  const b = event.block;
  await context.db.insert(blockSnapshot).values({
    number: b.number,
    hash: b.hash,
    parentHash: b.parentHash,
    timestamp: b.timestamp,
    gasUsed: b.gasUsed,
    gasLimit: b.gasLimit,
    baseFeePerGas: b.baseFeePerGas ?? null,
    miner: b.miner,
    stateRoot: b.stateRoot,
    receiptsRoot: b.receiptsRoot,
    transactionsRoot: b.transactionsRoot,
    sha3Uncles: b.sha3Uncles ?? null,
    logsBloom: b.logsBloom,
    extraData: b.extraData,
    difficulty: b.difficulty,
    totalDifficulty: b.totalDifficulty ?? null,
    size: b.size,
    nonce: b.nonce ?? null,
    mixHash: b.mixHash ?? null,
  });
});
