/**
 * Crash-recovery check: start an app, SIGKILL it after `--after` committed batches, restart
 * it on the same schema (Ponder resumes from its checkpoint), and print table digests.
 * `--after 0` lets the first run end by itself (e.g. on an error); `--between` runs a shell
 * command before the restart (e.g. to change a fault proxy).
 *
 *   bun run src/crash.ts --app rh-erc20-dl --after 60 [--start ... --end ...]
 */
import { execSync, spawn } from "node:child_process";
import { cpSync, rmSync } from "node:fs";
import path from "node:path";
import { Command } from "commander";
import pg from "pg";

const opts = new Command()
  .requiredOption("--app <id>")
  .option(
    "--after <n>",
    "kill after this many 'Indexed block range' lines",
    "60",
  )
  .option("--between <command>", "shell command to run before the restart")
  .option("--start <block>")
  .option("--end <block>")
  .parse(process.argv)
  .opts();

const base = process.env.DATABASE_URL!;
const database = `bench_crash_${opts.app}`.replace(/-/g, "_");
const schema = "crash";
const root = path.resolve(import.meta.dir, "../..");
const appDir = path.join(root, "benchmark/apps", `.bench-${opts.app}`);
rmSync(appDir, { recursive: true, force: true });
cpSync(path.resolve(import.meta.dir, "../apps", opts.app), appDir, {
  recursive: true,
});

const admin = new pg.Client({ connectionString: `${base}/postgres` });
await admin.connect();
await admin.query(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`);
await admin.query(`CREATE DATABASE "${database}"`);
await admin.end();

const port = 43000 + Math.floor(Math.random() * 2000);
const run = (label: string, killAfter?: number) =>
  new Promise<void>((resolve, reject) => {
    const child = spawn(
      "taskset",
      [
        "-c",
        "0-7,10-31",
        "node",
        path.join(root, "packages/core/dist/esm/bin/ponder.js"),
        "start",
        "--root",
        appDir,
        "--schema",
        schema,
        "--port",
        String(port),
        "--log-format",
        "json",
      ],
      {
        cwd: appDir,
        env: {
          ...process.env,
          DATABASE_URL: `${base}/${database}`,
          PONDER_TELEMETRY_DISABLED: "true",
          ...(opts.start ? { BENCH_START_BLOCK: opts.start } : {}),
          ...(opts.end ? { BENCH_END_BLOCK: opts.end } : {}),
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let batches = 0;
    let buffer = "";
    child.stdout.on("data", (d) => {
      buffer += d.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop()!;
      for (const line of lines) {
        if (line.includes('"Indexed block range"')) batches++;
        if (line.includes('"level":50'))
          console.log(`[${label}] ${line.slice(0, 300)}`);
        if (
          line.includes("Started returning 200 responses") &&
          line.includes("/ready")
        ) {
          console.log(`[${label}] ready after ${batches} batches`);
          child.kill("SIGTERM");
        }
        if (
          killAfter !== undefined &&
          killAfter > 0 &&
          batches >= killAfter &&
          !child.killed
        ) {
          console.log(`[${label}] SIGKILL after ${batches} batches`);
          child.kill("SIGKILL");
        }
      }
    });
    child.on("exit", (code, signal) => {
      console.log(
        `[${label}] exited (code ${code}, signal ${signal}) after ${batches} batches`,
      );
      resolve();
    });
    child.on("error", reject);
  });

await run("first", Number(opts.after));
if (opts.between)
  execSync(opts.between, { stdio: "inherit", shell: "/bin/bash" });
await run("restart");

const client = new pg.Client({ connectionString: `${base}/${database}` });
await client.connect();
const { rows: tables } = await client.query(
  `SELECT table_name FROM information_schema.tables WHERE table_schema = $1 AND table_type = 'BASE TABLE'
   AND table_name NOT LIKE '\\_ponder%' AND table_name NOT LIKE '\\_reorg%' ORDER BY table_name`,
  [schema],
);
for (const { table_name } of tables) {
  const { rows: pk } = await client.query(
    `SELECT a.attname FROM pg_index i JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
     WHERE i.indrelid = $1::regclass AND i.indisprimary ORDER BY array_position(i.indkey, a.attnum)`,
    [`"${schema}"."${table_name}"`],
  );
  const order = pk.map((r) => `t."${r.attname}"`).join(", ");
  const { rows } = await client.query(
    `SELECT count(*)::int AS n, encode(sha256(convert_to(coalesce(string_agg(t::text, E'\\n' ORDER BY ${order}), ''), 'UTF8')), 'hex') AS h FROM "${schema}"."${table_name}" t`,
  );
  console.log(`${table_name}:${rows[0].n}:${rows[0].h.slice(0, 12)}`);
}
await client.end();
