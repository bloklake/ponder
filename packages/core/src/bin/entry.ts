#!/usr/bin/env node
import module from "node:module";

// Note: Keep compiled code of Ponder's modules on disk (Node >= 22.1), so later starts skip
// compiling them. Enabled before any other module loads.
module.enableCompileCache?.();

await import("./ponder.js");
