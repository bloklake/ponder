import { ponder } from "ponder:registry";
import { blockSnapshot, hubTransaction, transferReceipt } from "ponder:schema";

ponder.on("Token:Transfer", async ({ event, context }) => {
  const { transaction: tx, transactionReceipt: r, block } = event;
  await context.db.insert(transferReceipt).values({
    id: event.id,
    txHash: tx.hash,
    txFrom: tx.from,
    txTo: tx.to,
    txInput: tx.input,
    txValue: tx.value,
    txNonce: tx.nonce,
    txType: tx.type,
    txGasPrice: tx.gasPrice ?? null,
    gasUsed: r.gasUsed,
    cumulativeGasUsed: r.cumulativeGasUsed,
    effectiveGasPrice: r.effectiveGasPrice,
    status: r.status,
    contractAddress: r.contractAddress,
    blockHash: block.hash,
    blockMiner: block.miner,
    blockBaseFee: block.baseFeePerGas ?? null,
  });
});

ponder.on("Token:Approval", async () => {});

for (const direction of ["from", "to"] as const) {
  ponder.on(`Hub:transaction:${direction}`, async ({ event, context }) => {
    await context.db
      .insert(hubTransaction)
      .values({
        hash: event.transaction.hash,
        direction,
        from: event.transaction.from,
        to: event.transaction.to,
        value: event.transaction.value,
        input: event.transaction.input,
        status: event.transactionReceipt.status,
        gasUsed: event.transactionReceipt.gasUsed,
        blockNumber: event.block.number,
      })
      .onConflictDoNothing();
  });
}

ponder.on("Every100:block", async ({ event, context }) => {
  const b = event.block;
  await context.db.insert(blockSnapshot).values({
    number: b.number,
    hash: b.hash,
    parentHash: b.parentHash,
    timestamp: b.timestamp,
    gasUsed: b.gasUsed,
    gasLimit: b.gasLimit,
    miner: b.miner,
    stateRoot: b.stateRoot,
    logsBloom: b.logsBloom,
    extraData: b.extraData,
    difficulty: b.difficulty,
    totalDifficulty: b.totalDifficulty ?? null,
    size: b.size,
    nonce: b.nonce ?? null,
    mixHash: b.mixHash ?? null,
  });
});
