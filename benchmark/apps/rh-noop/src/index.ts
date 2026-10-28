import { ponder } from "ponder:registry";

// App E: measures the framework's fixed per-event cost with no store access.
ponder.on("Token:Transfer", async () => {});
ponder.on("Token:Approval", async () => {});
