# Licensing

This repository is a fork of [Ponder](https://github.com/ponder-sh/ponder) with changes made by
Bloklake (the datalake historical source, throughput work in `packages/core`, and the
`benchmark/` harness). It contains code under different licenses.

## Bloklake's changes: Elastic License 2.0

Copyright © 2026 Bloklake (bloklake.com).

Every change Bloklake made to upstream Ponder (this repository's difference from upstream
commit `58867c65`, ponder 0.18.2, at present) is licensed under
the [Elastic License 2.0](LICENSE-ELASTIC) (SPDX: `Elastic-2.0`). That covers the new files and
the changes to the modified files. This fork as a whole, as distributed by Bloklake (including
the `ponder` package in `packages/core`, published as `@bloklake/ponder`), is made available
under the Elastic License 2.0, together with the MIT license for the upstream code it contains.

In plain words (the [license text](LICENSE-ELASTIC) is what applies):

- **You may** use, copy, modify and run this software, including commercially, for yourself and
  your company: for example, running your own indexers on your own infrastructure.
- **You may not** provide it to third parties as a hosted or managed service that gives them
  access to a substantial set of its features: for example, a hosted indexing service built on
  this fork.
- **You may not** remove or obscure the licensing or copyright notices.

Bloklake, as the licensor, is not bound by these limitations. For other terms (for example, to
offer a hosted service), contact support@bloklake.com.

## Upstream Ponder: MIT

Copyright © 2023 Cantrip, Inc.

The code from upstream Ponder stays licensed under the [MIT license](LICENSE) and is available
under those terms from the [upstream repository](https://github.com/ponder-sh/ponder). The
Elastic License 2.0 does not restrict upstream code obtained from upstream. The packages
Bloklake has not changed (`packages/client`, `packages/react`, `packages/utils`,
`packages/create-ponder`, `packages/eslint-config-ponder`) are upstream code under MIT.

## Files Bloklake added or modified

As the Elastic License 2.0 requires, these are the files Bloklake changed relative to upstream
`58867c65` (`A` = added, `M` = modified). Regenerate with
`git diff --name-status 58867c65 HEAD`.

```
A  .github/workflows/turbo.yml
M  README.md
A  UPSTREAM.md
M  benchmark/.gitignore
A  benchmark/apps/eth-allowances/ponder.config.ts
A  benchmark/apps/eth-allowances/ponder.schema.ts
A  benchmark/apps/eth-allowances/src/api/index.ts
A  benchmark/apps/eth-allowances/src/index.ts
A  benchmark/apps/eth-allowances/tsconfig.json
A  benchmark/apps/eth-balances/ponder.config.ts
A  benchmark/apps/eth-balances/ponder.schema.ts
A  benchmark/apps/eth-balances/src/api/index.ts
A  benchmark/apps/eth-balances/src/index.ts
A  benchmark/apps/eth-balances/tsconfig.json
A  benchmark/apps/eth-oracle/ponder.config.ts
A  benchmark/apps/eth-oracle/ponder.schema.ts
A  benchmark/apps/eth-oracle/src/api/index.ts
A  benchmark/apps/eth-oracle/src/index.ts
A  benchmark/apps/eth-oracle/tsconfig.json
A  benchmark/apps/eth-reads/ponder.config.ts
A  benchmark/apps/eth-reads/ponder.schema.ts
A  benchmark/apps/eth-reads/src/api/index.ts
A  benchmark/apps/eth-reads/src/index.ts
A  benchmark/apps/eth-reads/tsconfig.json
A  benchmark/apps/eth-safe/abis.ts
A  benchmark/apps/eth-safe/ponder.config.ts
A  benchmark/apps/eth-safe/ponder.schema.ts
A  benchmark/apps/eth-safe/src/api/index.ts
A  benchmark/apps/eth-safe/src/index.ts
A  benchmark/apps/eth-safe/tsconfig.json
A  benchmark/apps/eth-sources-dl/abis/erc20.ts
A  benchmark/apps/eth-sources-dl/ponder.config.ts
A  benchmark/apps/eth-sources-dl/ponder.schema.ts
A  benchmark/apps/eth-sources-dl/src/api/index.ts
A  benchmark/apps/eth-sources-dl/src/index.ts
A  benchmark/apps/eth-sources-dl/tsconfig.json
A  benchmark/apps/eth-sources/abis/erc20.ts
A  benchmark/apps/eth-sources/ponder.config.ts
A  benchmark/apps/eth-sources/ponder.schema.ts
A  benchmark/apps/eth-sources/src/api/index.ts
A  benchmark/apps/eth-sources/src/index.ts
A  benchmark/apps/eth-sources/tsconfig.json
A  benchmark/apps/eth-usdc-transfers/ponder.config.ts
A  benchmark/apps/eth-usdc-transfers/ponder.schema.ts
A  benchmark/apps/eth-usdc-transfers/src/api/index.ts
A  benchmark/apps/eth-usdc-transfers/src/index.ts
A  benchmark/apps/eth-usdc-transfers/tsconfig.json
A  benchmark/apps/rh-erc20-dl/abis/erc20.ts
A  benchmark/apps/rh-erc20-dl/ponder.config.ts
A  benchmark/apps/rh-erc20-dl/ponder.schema.ts
A  benchmark/apps/rh-erc20-dl/src/api/index.ts
A  benchmark/apps/rh-erc20-dl/src/index.ts
A  benchmark/apps/rh-erc20-dl/tsconfig.json
A  benchmark/apps/rh-erc20-isolated/abis/erc20.ts
A  benchmark/apps/rh-erc20-isolated/ponder.config.ts
A  benchmark/apps/rh-erc20-isolated/ponder.schema.ts
A  benchmark/apps/rh-erc20-isolated/src/api/index.ts
A  benchmark/apps/rh-erc20-isolated/src/index.ts
A  benchmark/apps/rh-erc20-isolated/tsconfig.json
A  benchmark/apps/rh-erc20-omnichain/abis/erc20.ts
A  benchmark/apps/rh-erc20-omnichain/ponder.config.ts
A  benchmark/apps/rh-erc20-omnichain/ponder.schema.ts
A  benchmark/apps/rh-erc20-omnichain/src/api/index.ts
A  benchmark/apps/rh-erc20-omnichain/src/index.ts
A  benchmark/apps/rh-erc20-omnichain/tsconfig.json
A  benchmark/apps/rh-erc20/abis/erc20.ts
A  benchmark/apps/rh-erc20/ponder.config.ts
A  benchmark/apps/rh-erc20/ponder.schema.ts
A  benchmark/apps/rh-erc20/src/api/index.ts
A  benchmark/apps/rh-erc20/src/index.ts
A  benchmark/apps/rh-erc20/tsconfig.json
A  benchmark/apps/rh-factory-dl/ponder.config.ts
A  benchmark/apps/rh-factory-dl/ponder.schema.ts
A  benchmark/apps/rh-factory-dl/src/api/index.ts
A  benchmark/apps/rh-factory-dl/src/index.ts
A  benchmark/apps/rh-factory-dl/tsconfig.json
A  benchmark/apps/rh-factory/ponder.config.ts
A  benchmark/apps/rh-factory/ponder.schema.ts
A  benchmark/apps/rh-factory/src/api/index.ts
A  benchmark/apps/rh-factory/src/index.ts
A  benchmark/apps/rh-factory/tsconfig.json
A  benchmark/apps/rh-find/abis/erc20.ts
A  benchmark/apps/rh-find/ponder.config.ts
A  benchmark/apps/rh-find/ponder.schema.ts
A  benchmark/apps/rh-find/src/api/index.ts
A  benchmark/apps/rh-find/src/index.ts
A  benchmark/apps/rh-find/tsconfig.json
A  benchmark/apps/rh-mixed/abis/erc20.ts
A  benchmark/apps/rh-mixed/ponder.config.ts
A  benchmark/apps/rh-mixed/ponder.schema.ts
A  benchmark/apps/rh-mixed/src/api/index.ts
A  benchmark/apps/rh-mixed/src/index.ts
A  benchmark/apps/rh-mixed/tsconfig.json
A  benchmark/apps/rh-noop/abis/erc20.ts
A  benchmark/apps/rh-noop/ponder.config.ts
A  benchmark/apps/rh-noop/ponder.schema.ts
A  benchmark/apps/rh-noop/src/api/index.ts
A  benchmark/apps/rh-noop/src/index.ts
A  benchmark/apps/rh-noop/tsconfig.json
A  benchmark/apps/rh-sources-dl/abis/erc20.ts
A  benchmark/apps/rh-sources-dl/ponder.config.ts
A  benchmark/apps/rh-sources-dl/ponder.schema.ts
A  benchmark/apps/rh-sources-dl/src/api/index.ts
A  benchmark/apps/rh-sources-dl/src/index.ts
A  benchmark/apps/rh-sources-dl/tsconfig.json
A  benchmark/apps/rh-sources/abis/erc20.ts
A  benchmark/apps/rh-sources/ponder.config.ts
A  benchmark/apps/rh-sources/ponder.schema.ts
A  benchmark/apps/rh-sources/src/api/index.ts
A  benchmark/apps/rh-sources/src/index.ts
A  benchmark/apps/rh-sources/tsconfig.json
A  benchmark/apps/rh-sparse-dl/ponder.config.ts
A  benchmark/apps/rh-sparse-dl/ponder.schema.ts
A  benchmark/apps/rh-sparse-dl/src/api/index.ts
A  benchmark/apps/rh-sparse-dl/src/index.ts
A  benchmark/apps/rh-sparse-dl/tsconfig.json
A  benchmark/apps/rh-sparse/ponder.config.ts
A  benchmark/apps/rh-sparse/ponder.schema.ts
A  benchmark/apps/rh-sparse/src/api/index.ts
A  benchmark/apps/rh-sparse/src/index.ts
A  benchmark/apps/rh-sparse/tsconfig.json
M  benchmark/package.json
A  benchmark/src/call-mock.ts
A  benchmark/src/crash.ts
A  benchmark/src/fault-proxy.ts
A  benchmark/src/run.ts
M  docs/pages/docs/api-reference/ponder/config.mdx
M  docs/pages/docs/config/chains.mdx
M  packages/core/package.json
A  packages/core/src/_test/datalake.ts
M  packages/core/src/bin/commands/start.ts
A  packages/core/src/bin/entry.ts
M  packages/core/src/bin/ponder.ts
M  packages/core/src/build/config.ts
M  packages/core/src/config/index.ts
M  packages/core/src/drizzle/text.ts
M  packages/core/src/indexing-store/cache.ts
M  packages/core/src/indexing-store/index.ts
M  packages/core/src/indexing-store/utils.ts
M  packages/core/src/indexing/client.test.ts
M  packages/core/src/indexing/client.ts
M  packages/core/src/indexing/index.ts
M  packages/core/src/indexing/profile.test.ts
M  packages/core/src/indexing/profile.ts
M  packages/core/src/internal/metrics.ts
M  packages/core/src/internal/types.ts
A  packages/core/src/rpc/batch.test.ts
A  packages/core/src/rpc/batch.ts
M  packages/core/src/rpc/index.test.ts
M  packages/core/src/rpc/index.ts
M  packages/core/src/runtime/historical.test.ts
M  packages/core/src/runtime/historical.ts
M  packages/core/src/runtime/index.ts
M  packages/core/src/runtime/isolated.ts
M  packages/core/src/runtime/multichain.ts
M  packages/core/src/runtime/omnichain.ts
A  packages/core/src/runtime/pipeline.ts
A  packages/core/src/sync-datalake/_test/datalake.arrow
A  packages/core/src/sync-datalake/_test/empty.arrow
A  packages/core/src/sync-datalake/_test/fixture.json
A  packages/core/src/sync-datalake/_test/partly-empty.arrow
A  packages/core/src/sync-datalake/client.ts
A  packages/core/src/sync-datalake/convert.ts
A  packages/core/src/sync-datalake/encode.ts
A  packages/core/src/sync-datalake/index.live.test.ts
A  packages/core/src/sync-datalake/index.test.ts
A  packages/core/src/sync-datalake/index.ts
M  packages/core/src/sync-historical/index.ts
M  packages/core/src/sync-store/index.ts
M  packages/core/src/utils/generators.ts
M  packages/core/src/utils/mutex.ts
M  pnpm-lock.yaml
```
