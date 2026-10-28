/**
 * Turbo benchmark harness: runs reference apps against one or more Ponder builds,
 * records wall-clock + Ponder's own phase metrics, and digests the resulting tables so
 * builds can be checked for identical output.
 *
 *   bun run src/run.ts --apps rh-erc20 --repos fork=..,upstream=../../ponder-upstream \
 *     --mode warm --runs 3 [--start 58600000 --end 58700000] [--out results/<ts>]
 *
 * Modes:
 *   cold  fresh database per run (RPC extract + ponder_sync writes included)
 *   warm  shared database per app+range whose ponder_sync is filled once (not timed),
 *         fresh schema per run: measures read-back + transform + load only
 *
 * Apps are copied into `<repo>/benchmark/apps/.bench-<app>` so that `import ... from
 * "ponder"` resolves to the package of the build under test.
 */
import { spawn } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { Command } from "commander";
import pg from "pg";

const program = new Command()
  .requiredOption(
    "--apps <list>",
    "comma-separated app ids under benchmark/apps",
  )
  .option(
    "--repos <list>",
    "label=path pairs of Ponder repos (built)",
    `fork=${path.resolve(import.meta.dir, "../..")}`,
  )
  .option("--mode <mode>", "cold | warm", "warm")
  .option("--runs <n>", "runs per app and repo", "1")
  .option("--start <block>", "BENCH_START_BLOCK")
  .option("--end <block>", "BENCH_END_BLOCK")
  .option("--cpus <set>", "taskset CPU list for Ponder", "0-7,10-31")
  .option("--timeout <s>", "per-run timeout in seconds", "3600")
  .option("--out <dir>", "results directory")
  .option("--node-args <args>", "extra node args, e.g. --cpu-prof", "")
  .parse(process.argv);

const opts = program.opts();
const apps: string[] = opts.apps.split(",");
const repos = (opts.repos as string).split(",").map((pair) => {
  const [label, p] = pair.split("=");
  return { label: label!, root: path.resolve(p!) };
});
const runs = Number(opts.runs);
const baseUrl = process.env.DATABASE_URL!;
if (!baseUrl)
  throw new Error("DATABASE_URL (without database name) is required");

const ts = new Date().toISOString().replace(/[:.]/g, "-");
const outDir = path.resolve(opts.out ?? `results/${ts}`);
mkdirSync(outDir, { recursive: true });

const rangeTag = `${opts.start ?? "d"}_${opts.end ?? "d"}`;

const admin = new pg.Client({ connectionString: `${baseUrl}/postgres` });
await admin.connect();

const ensureDatabase = async (name: string, fresh: boolean) => {
  if (fresh)
    await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
  const { rowCount } = await admin.query(
    "SELECT 1 FROM pg_database WHERE datname = $1",
    [name],
  );
  if (rowCount === 0) await admin.query(`CREATE DATABASE "${name}"`);
};

const parseMetrics = (text: string) => {
  const out: Record<string, number> = {};
  for (const line of text.split("\n")) {
    if (line.startsWith("#") || line.length === 0) continue;
    const i = line.lastIndexOf(" ");
    out[line.slice(0, i)] = Number(line.slice(i + 1));
  }
  return out;
};

/** sha256 over every user table's rows (text form) in primary-key order. */
const digest = async (database: string, schema: string) => {
  const client = new pg.Client({ connectionString: `${baseUrl}/${database}` });
  await client.connect();
  try {
    const { rows: tables } = await client.query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = $1 AND table_type = 'BASE TABLE'
         AND table_name NOT LIKE '\\_ponder%' AND table_name NOT LIKE '\\_reorg%'
       ORDER BY table_name`,
      [schema],
    );
    const result: Record<string, { rows: number; sha256: string }> = {};
    for (const { table_name } of tables) {
      const { rows: pk } = await client.query(
        `SELECT a.attname FROM pg_index i
         JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
         WHERE i.indrelid = $1::regclass AND i.indisprimary
         ORDER BY array_position(i.indkey, a.attnum)`,
        [`"${schema}"."${table_name}"`],
      );
      const order = pk.map((r) => `t."${r.attname}"`).join(", ") || "t::text";
      const { rows } = await client.query(
        `SELECT count(*)::int AS n,
           encode(sha256(convert_to(coalesce(string_agg(t::text, E'\\n' ORDER BY ${order}), ''), 'UTF8')), 'hex') AS h
         FROM "${schema}"."${table_name}" t`,
      );
      result[table_name] = { rows: rows[0].n, sha256: rows[0].h };
    }
    return result;
  } finally {
    await client.end();
  }
};

type RunResult = {
  app: string;
  repo: string;
  run: number;
  mode: string;
  wallMs: number;
  events: number;
  metrics: Record<string, number>;
  digest: Record<string, { rows: number; sha256: string }>;
  maxRssMb?: number;
};

const runPonder = async (args: {
  repoRoot: string;
  app: string;
  database: string;
  schema: string;
  port: number;
  logFile: string;
}): Promise<{ wallMs: number; metrics: Record<string, number> }> => {
  const appSrc = path.resolve(import.meta.dir, "../apps", args.app);
  const appDir = path.join(
    args.repoRoot,
    "benchmark/apps",
    `.bench-${args.app}`,
  );
  rmSync(appDir, { recursive: true, force: true });
  cpSync(appSrc, appDir, { recursive: true });

  // Note: The package's own `bin`, as `ponder` resolves for a user.
  const corePackage = JSON.parse(
    readFileSync(
      path.join(args.repoRoot, "packages/core/package.json"),
      "utf8",
    ),
  );
  const bin = path.join(args.repoRoot, "packages/core", corePackage.bin.ponder);
  const nodeArgs = (opts.nodeArgs as string).split(" ").filter(Boolean);
  const env = {
    ...process.env,
    DATABASE_URL: `${baseUrl}/${args.database}`,
    PONDER_TELEMETRY_DISABLED: "true",
    ...(opts.start ? { BENCH_START_BLOCK: opts.start } : {}),
    ...(opts.end ? { BENCH_END_BLOCK: opts.end } : {}),
  };
  const log = Bun.file(args.logFile).writer();
  const start = performance.now();
  const child = spawn(
    "taskset",
    [
      "-c",
      opts.cpus,
      "node",
      ...nodeArgs,
      bin,
      "start",
      "--root",
      appDir,
      "--schema",
      args.schema,
      "--port",
      String(args.port),
      "--log-format",
      "json",
    ],
    { env, cwd: appDir, stdio: ["ignore", "pipe", "pipe"] },
  );
  // Note: Ponder moves to the next free port if the given one is in use.
  let port = args.port;
  let completed = false;
  // Note: The wall time is when indexing completed (data in the database), not when the HTTP
  // server answers /ready.
  let completedMs = 0;
  let buffer = "";
  child.stdout.on("data", (d) => {
    log.write(d);
    buffer += d.toString();
    const lines = buffer.split("\n");
    buffer = lines.pop()!;
    for (const line of lines) {
      if (line.includes('"Created HTTP server"')) {
        port = JSON.parse(line).port ?? port;
      }
      if (line.includes('"Completed indexing across all chains"')) {
        completed = true;
        completedMs = performance.now() - start;
      }
    }
  });
  child.stderr.on("data", (d) => log.write(d));
  let exited = false;
  child.on("exit", () => {
    exited = true;
  });

  const deadline = start + Number(opts.timeout) * 1000;
  let wallMs = 0;
  while (true) {
    if (exited) throw new Error(`ponder exited early; see ${args.logFile}`);
    if (performance.now() > deadline) {
      child.kill("SIGKILL");
      throw new Error(`timeout; see ${args.logFile}`);
    }
    try {
      const r = await fetch(`http://localhost:${port}/ready`);
      if (r.status === 200) {
        wallMs = performance.now() - start;
        break;
      }
    } catch {}
    await Bun.sleep(50);
  }
  // Note: `/ready` is the end of the backfill; blocks after the finalized block are indexed
  // by the live sync afterwards (up to `endBlock`), so wait for them before the digest.
  const completeDeadline = performance.now() + 120_000;
  while (completed === false && exited === false) {
    if (performance.now() > completeDeadline) {
      throw new Error(`indexing did not complete; see ${args.logFile}`);
    }
    await Bun.sleep(50);
  }
  wallMs = completedMs;
  const metrics = parseMetrics(
    await (await fetch(`http://localhost:${port}/metrics`)).text(),
  );
  child.kill("SIGTERM");
  await new Promise((r) => child.on("exit", r));
  await log.end();
  return { wallMs, metrics };
};

const results: RunResult[] = [];
let port = 42100 + Math.floor(Math.random() * 5000);

for (const app of apps) {
  for (const repo of repos) {
    for (let run = 0; run < runs; run++) {
      const tag = `${app}-${repo.label}-${run}`;
      let database: string;
      if (opts.mode === "cold") {
        database = `bench_cold_${app}`.replace(/-/g, "_");
        await ensureDatabase(database, true);
      } else {
        database = `bench_warm_${app}_${rangeTag}`.replace(/-/g, "_");
        const existed = (
          await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [
            database,
          ])
        ).rowCount;
        await ensureDatabase(database, false);
        if (!existed) {
          console.log(`[warm-up] filling ponder_sync for ${app} (not timed)`);
          await runPonder({
            repoRoot: repo.root,
            app,
            database,
            schema: "warmup",
            port: port++,
            logFile: path.join(outDir, `${app}-warmup.log`),
          });
        }
      }
      const schema = `r_${repo.label}_${run}`;
      const c = new pg.Client({ connectionString: `${baseUrl}/${database}` });
      await c.connect();
      await c.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await c.end();

      const { wallMs, metrics } = await runPonder({
        repoRoot: repo.root,
        app,
        database,
        schema,
        port: port++,
        logFile: path.join(outDir, `${tag}.log`),
      });
      const d = await digest(database, schema);
      const events = Object.entries(metrics)
        .filter(([k]) => k.startsWith("ponder_indexing_completed_events{"))
        .reduce((a, [, v]) => a + v, 0);
      const r: RunResult = {
        app,
        repo: repo.label,
        run,
        mode: opts.mode,
        wallMs,
        events,
        metrics,
        digest: d,
      };
      results.push(r);
      console.log(
        `${tag}: ${(wallMs / 1000).toFixed(2)}s, ${events} events, ${Math.round(events / (wallMs / 1000))} ev/s`,
      );
    }
  }
}
await admin.end();

// Summary
const m = (r: RunResult, k: string) => r.metrics[k] ?? 0;
const digestKey = (r: RunResult) =>
  Object.entries(r.digest)
    .map(([t, { rows, sha256 }]) => `${t}:${rows}:${sha256}`)
    .join("|");
const lines: string[] = [
  `# Benchmark ${ts} (mode: ${opts.mode}, range: ${rangeTag})`,
  "",
  "| app | repo | run | wall s | events | ev/s | extract s | index s | load s | prefetch s | digest |",
  "|---|---|---|---|---|---|---|---|---|---|---|",
];
for (const app of apps) {
  const ref = results.find((r) => r.app === app);
  for (const r of results.filter((r) => r.app === app)) {
    lines.push(
      `| ${r.app} | ${r.repo} | ${r.run} | ${(r.wallMs / 1000).toFixed(2)} | ${r.events} | ${Math.round(r.events / (r.wallMs / 1000))} | ${(m(r, 'ponder_historical_concurrency_group_duration{group="extract"}') / 1000).toFixed(2)} | ${(m(r, 'ponder_historical_transform_duration{step="index"}') / 1000).toFixed(2)} | ${(m(r, 'ponder_historical_transform_duration{step="load"}') / 1000).toFixed(2)} | ${(m(r, 'ponder_historical_transform_duration{step="prefetch"}') / 1000).toFixed(2)} | ${digestKey(r) === digestKey(ref!) ? "match" : "MISMATCH"} |`,
    );
  }
}
lines.push("", "Digests:", "");
for (const r of results) {
  lines.push(`- ${r.app}/${r.repo}/${r.run}: \`${digestKey(r)}\``);
}
writeFileSync(path.join(outDir, "summary.md"), `${lines.join("\n")}\n`);
writeFileSync(
  path.join(outDir, "results.json"),
  JSON.stringify(results, null, 2),
);
console.log(lines.join("\n"));
if (
  results.some(
    (r) => digestKey(r) !== digestKey(results.find((x) => x.app === r.app)!),
  )
) {
  process.exitCode = 1;
}
