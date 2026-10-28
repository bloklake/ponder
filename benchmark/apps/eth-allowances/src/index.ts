import { ponder } from "ponder:registry";
import { approvalEvent, tokenAllowance } from "ponder:schema";

ponder.on("Token:Approval", async ({ event, context }) => {
  const { owner, spender, value } = event.args;
  const token = event.log.address;
  // A revoked approval is zero whatever the token reports: no read.
  const current =
    value === 0n
      ? 0n
      : await context.client.readContract({
          abi: context.contracts.Token.abi,
          address: token,
          functionName: "allowance",
          args: [owner, spender],
        });
  await context.db.insert(approvalEvent).values({
    id: event.id,
    token,
    owner,
    spender,
    approved: value,
    allowance: current,
    timestamp: Number(event.block.timestamp),
  });
  await context.db
    .insert(tokenAllowance)
    .values({ token, owner, spender, allowance: current })
    .onConflictDoUpdate({ allowance: current });
});
