# Fork notes

This fork is upstream Ponder plus Bloklake's changes, on `main` of
https://github.com/bloklake/ponder.

- Upstream: https://github.com/ponder-sh/ponder, branch `main` (remote `origin`)
- Fork: https://github.com/bloklake/ponder, branch `main` (remote `bloklake`)
- Base: `58867c65` (ponder 0.18.2)

## Updating to a new upstream release

    git fetch origin
    git checkout main && git merge origin/main     # resolve conflicts
    pnpm install && pnpm lint && pnpm build && pnpm typecheck
    CI=true pnpm --filter ponder test:typecheck
    CI=1 pnpm --filter ponder test                  # PGlite; again with DATABASE_URL (Postgres)
    CI=1 pnpm --filter ponder test:bun              # PGlite and Postgres, as upstream's CI
    # with the datalake API: benchmark/src/run.ts against the previous build, digests must match

Upstream tests need the anvil version upstream's CI pins (`main.yml`). Update the base commit
above and in `LICENSING.md`, and regenerate the file list there.

The 0.17.10 → 0.18.2 port (`4a2c7717` → `58867c65`), for the next one: 0.18 moved the sync
tables to `ponder_rpc_cache_1` (traces keyed by `traceAddress`, no `error` / `revertReason` /
`subcalls`; factories by fragment id), added an in-memory historical sync for chains with
`cacheRpcRequests: false` (the datalake range is read from the datalake there too), and dropped
`.github/actions/setup`.

## Release checklist

Developers keep `import ... from "ponder"`; only the dependency line and the config change.

1. Version: set `packages/core/package.json` `version` to a fork version (e.g.
   `0.18.2-turbo.1`) and publish under a scope we own, e.g. `@bloklake/ponder` (npm or a
   private registry). The name `ponder` belongs to upstream; never publish it.
2. Install for users — an npm alias keeps every import unchanged:

       "ponder": "npm:@bloklake/ponder@0.18.2-turbo.1"

   (`@ponder/utils` is unchanged from upstream and comes from npm.)
3. Before publishing:
   - `pnpm install --frozen-lockfile && pnpm lint && pnpm build`
   - `CI=true pnpm --filter ponder test:typecheck`
   - `CI=1 pnpm --filter ponder test` and `test:bun` against Postgres and PGlite
   - `pnpm pack` in `packages/core`: no `_test/` or `*.test.*` files (checked in `turbo.yml`)
   - the tarball has `LICENSE` (MIT, upstream) and `LICENSE-ELASTIC`, and `package.json`
     says `"license": "Elastic-2.0 AND MIT"`
   - install the tarball into an app outside the monorepo and run it (`ponder codegen`,
     `ponder start`); compare table digests with the harness run of the same app
   - digests: `benchmark/src/run.ts` fork vs upstream on rh-erc20, rh-sources, rh-factory,
     eth-sources, eth-reads, eth-oracle; datalake vs JSON-RPC on the `-dl` apps
   - datalake failures: `benchmark/src/fault-proxy.ts` modes 503 / reset / hang / truncate /
     behind / down with `rh-erc20-dl`, and `crash.ts --after 0 --between` for a datalake that
     stays down (restart falls back to JSON-RPC)
   - live comparison against the production datalake for a sample of each chain:
     `PONDER_DATALAKE_LIVE_{URL,RPC,BLOCKS}` with `src/sync-datalake/index.live.test.ts`
4. Repository: in the fork's GitHub settings disable the upstream workflows that need
   upstream secrets, publish or open release pull requests (`release.yml`, `version.yml`,
   `simulation-test*.yml`, `utils.yml`, `windows.yml`). `main.yml` (lint, build, tests) and
   `turbo.yml` (package contents) stay on.
5. Datalake deployment: each chain's `bl serve` must report the chain id and archive height at
   `/status`; `chains.<name>.datalake.url` (and `apiKey` when auth is enabled) is the only
   user-facing change. Watch `ponder_datalake_request_duration`, `ponder_datalake_rows_total`
   and the "Retrying datalake request" warnings after rollout.
