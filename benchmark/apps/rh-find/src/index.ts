import { ponder } from "ponder:registry";
import { account } from "ponder:schema";

// App F: one `find` per event (all misses) — the store's read path in isolation.
ponder.on("Token:Transfer", async ({ event, context }) => {
  await context.db.find(account, { address: event.args.from });
});
ponder.on("Token:Approval", async () => {});
