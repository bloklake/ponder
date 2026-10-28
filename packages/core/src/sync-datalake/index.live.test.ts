import { test } from "vitest";
import { expectSameAsRpc } from "@/_test/datalake.js";
import { createDatalakeClient } from "./client.js";
import {
  DATALAKE_BLOCK_FIELDS,
  DATALAKE_LOG_FIELDS,
  DATALAKE_RECEIPT_FIELDS,
  DATALAKE_TRANSACTION_FIELDS,
  toFieldMap,
} from "./convert.js";

/**
 * Compares a live datalake with a live JSON-RPC node over every transaction, receipt and log
 * of a block range. Opt-in:
 *
 *   PONDER_DATALAKE_LIVE_URL=http://localhost:8091 PONDER_DATALAKE_LIVE_RPC=http://localhost:8561 \
 *   PONDER_DATALAKE_LIVE_BLOCKS=12964990:12965010 pnpm vitest run index.live.test.ts
 */
const url = process.env.PONDER_DATALAKE_LIVE_URL;
const rpcUrl = process.env.PONDER_DATALAKE_LIVE_RPC;
const [fromBlock, toBlock] = (process.env.PONDER_DATALAKE_LIVE_BLOCKS ?? "")
  .split(":")
  .map(Number);

const rpc = async (method: string, params: unknown[]) => {
  const response = await fetch(rpcUrl!, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const body = (await response.json()) as { result?: any; error?: unknown };
  if (body.error) throw new Error(`${method}: ${JSON.stringify(body.error)}`);
  return body.result;
};

test.skipIf(url === undefined || rpcUrl === undefined || !toBlock)(
  "datalake rows equal JSON-RPC rows over a live block range",
  async () => {
    const client = createDatalakeClient({ url: url! });
    const { chainId } = await client.status();
    const receiptFields = DATALAKE_RECEIPT_FIELDS as readonly string[];

    for (let from = fromBlock!; from <= toBlock!; ) {
      const page = await client.query({
        fromBlock: from,
        toBlock: toBlock!,
        transactions: [{}],
        logs: [{}],
        fields: {
          block: toFieldMap(DATALAKE_BLOCK_FIELDS),
          transaction: toFieldMap([
            ...DATALAKE_TRANSACTION_FIELDS,
            ...receiptFields,
          ]),
          log: toFieldMap(DATALAKE_LOG_FIELDS),
        },
      });
      const to = Math.min(page.nextBlock - 1, toBlock!);

      const blocks: any[] = [];
      const receipts: any[] = [];
      for (let n = from; n <= to; n++) {
        const hex = `0x${n.toString(16)}`;
        blocks.push(await rpc("eth_getBlockByNumber", [hex, true]));
        receipts.push(...(await rpc("eth_getBlockReceipts", [hex])));
      }
      // Note: A receipt carries its logs; `eth_getLogs` caps a whole block range.
      const logs = receipts.flatMap((receipt) => receipt.logs);

      // Note: Transaction and log streams only carry the blocks their rows reference.
      expectSameAsRpc(page, chainId, true, {
        blocks: blocks.filter((block) => block.transactions.length > 0),
        receipts,
        logs,
      });

      // Every block, empty ones included, through a block-interval request.
      const blockPage = await client.query({
        fromBlock: from,
        toBlock: to,
        blockInterval: 1,
        blockOffset: 0,
        fields: { block: toFieldMap(DATALAKE_BLOCK_FIELDS) },
      });
      expectSameAsRpc(blockPage, chainId, false, {
        blocks: blocks.map((block) => ({ ...block, transactions: [] })),
        receipts: [],
        logs: [],
      });
      from = to + 1;
    }
  },
  600_000,
);
