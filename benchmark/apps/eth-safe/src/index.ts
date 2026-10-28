import { ponder } from "ponder:registry";
import { safe, safeEvent, safeSetup } from "ponder:schema";

for (const factory of ["Factory130", "Factory141"] as const) {
  ponder.on(`${factory}:ProxyCreation`, async ({ event, context }) => {
    await context.db.insert(safe).values({
      id: event.id,
      proxy: event.args.proxy,
      singleton: event.args.singleton,
      timestamp: Number(event.block.timestamp),
    });
  });
}

const json = (args: unknown) =>
  JSON.stringify(args, (_, v) => (typeof v === "bigint" ? v.toString() : v));

const names = [
  "SafeReceived",
  "SafeModuleTransaction",
  "SafeMultiSigTransaction",
  "ExecutionSuccess",
  "ExecutionFailure",
  "ChangedThreshold",
  "ChangedMasterCopy",
  "ChangedFallbackHandler",
  "ChangedGuard",
  "ChangedModuleGuard",
  "EnabledModule",
  "DisabledModule",
  "AddedOwner",
  "RemovedOwner",
] as const;
const indexedNames = [
  "ExecutionSuccess",
  "ExecutionFailure",
  "ChangedFallbackHandler",
  "ChangedGuard",
  "EnabledModule",
  "DisabledModule",
  "AddedOwner",
  "RemovedOwner",
] as const;

for (const contract of ["Safe130", "Safe141"] as const) {
  ponder.on(`${contract}:SafeSetup`, async ({ event, context }) => {
    await context.db.insert(safeSetup).values({
      id: event.id,
      proxy: event.log.address,
      initiator: event.args.initiator,
      threshold: event.args.threshold,
      timestamp: Number(event.block.timestamp),
    });
  });
  for (const name of names) {
    ponder.on(`${contract}:${name}` as any, async ({ event, context }: any) => {
      await context.db.insert(safeEvent).values({
        id: event.id,
        proxy: event.log.address,
        name,
        args: json(event.args),
        timestamp: Number(event.block.timestamp),
      });
    });
  }
}
for (const contract of ["SafeIndexed130", "SafeIndexed141"] as const) {
  for (const name of indexedNames) {
    ponder.on(`${contract}:${name}` as any, async ({ event, context }: any) => {
      await context.db.insert(safeEvent).values({
        id: event.id,
        proxy: event.log.address,
        name,
        args: json(event.args),
        timestamp: Number(event.block.timestamp),
      });
    });
  }
}
