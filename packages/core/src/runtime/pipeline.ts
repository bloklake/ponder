import type { Database } from "@/database/index.js";
import type { QB } from "@/database/queryBuilder.js";
import type { CachedViemClient } from "@/indexing/client.js";
import type { Indexing } from "@/indexing/index.js";
import type { IndexingCache } from "@/indexing-store/cache.js";
import type { IndexingStore } from "@/indexing-store/index.js";
import type { Common } from "@/internal/common.js";
import type { Chain, Event } from "@/internal/types.js";
import { startClock } from "@/utils/timer.js";

/**
 * Ordered background commits for pipelined historical indexing.
 *
 * Batch N+1 is processed in memory while batch N's rows are flushed and its
 * checkpoint is committed. Commit jobs run strictly one after another, in batch
 * order, so crash recovery sees exactly the same sequence of transactions as the
 * sequential path. The first failed job poisons the pipeline: later jobs are
 * skipped and `drain()` throws that error.
 */
export type CommitPipeline = {
  /** Queue a commit job behind all previously queued jobs. */
  enqueue: (job: () => Promise<void>) => void;
  /** Wait until at most `depth` jobs are queued or running. */
  waitForDepth: (depth: number) => Promise<void>;
  /** Wait for every queued job; throw the first job error, if any. */
  drain: () => Promise<void>;
  /** Number of queued or running jobs. */
  size: () => number;
};

export const createCommitPipeline = (): CommitPipeline => {
  const jobs: Promise<void>[] = [];
  let tail: Promise<void> = Promise.resolve();
  let failed = false;
  let error: unknown;

  return {
    enqueue(job) {
      const promise = tail.then(async () => {
        if (failed) return;
        try {
          await job();
        } catch (_error) {
          failed = true;
          error = _error;
        }
      });
      tail = promise;
      jobs.push(promise);
      promise.then(() => {
        jobs.splice(jobs.indexOf(promise), 1);
      });
    },
    async waitForDepth(depth) {
      while (jobs.length > depth) {
        await jobs[0];
      }
      if (failed) throw error;
    },
    async drain() {
      await tail;
      if (failed) throw error;
    },
    size: () => jobs.length,
  };
};

/**
 * Index one historical batch ahead of the previous batch's commit.
 *
 * Runs the batch's indexing functions in memory, detaches the written rows, and
 * queues a commit job (flush + `writeCheckpoint`, one transaction). Returns
 * `false` if the batch cannot be pipelined: the caches are not complete, an
 * indexing function threw, or a store method needed the database. In that case
 * the pipeline has been drained, the partial batch undone, and the caller must
 * index the batch on the sequential path.
 */
export const indexBatchPipelined = async ({
  common,
  database,
  indexing,
  indexingStore,
  indexingCache,
  cachedViemClient,
  commitPipeline,
  events,
  updateIndexingSeconds,
  writeCheckpoint,
  onCommitted,
}: {
  common: Common;
  database: Database;
  indexing: Indexing;
  indexingStore: IndexingStore;
  indexingCache: IndexingCache;
  cachedViemClient: CachedViemClient;
  commitPipeline: CommitPipeline;
  events: Event[];
  updateIndexingSeconds: (event: Event, chain: Chain) => void;
  writeCheckpoint: (tx: QB) => Promise<unknown>;
  onCommitted: () => void;
}): Promise<boolean> => {
  if (
    database.userQB.$dialect !== "postgres" ||
    process.env.PONDER_PIPELINED_FLUSH === "false" ||
    indexingCache.isComplete() === false
  ) {
    await commitPipeline.drain();
    return false;
  }

  const prefetchClock = startClock();

  // Note: Keep at most one batch committing while this one is processed.
  await commitPipeline.waitForDepth(1);

  indexingCache.qb = database.userQB;
  await cachedViemClient.prefetch({ events });
  common.metrics.ponder_historical_transform_duration.inc(
    { step: "prefetch" },
    prefetchClock(),
  );

  const initialCompletedEvents = structuredClone(
    await common.metrics.ponder_indexing_completed_events.get(),
  );

  const indexClock = startClock();
  let isProcessed = false;
  try {
    indexingStore.qb = database.userQB;
    indexingStore.isPipelined = true;
    indexingStore.isProcessingEvents = true;

    await indexing.processHistoricalEvents({ events, updateIndexingSeconds });

    // Note: A user try/catch may have swallowed the fallback error.
    isProcessed = indexingStore.isPipelineFallbackRequested === false;
  } catch {
    // Note: The sequential path re-runs the batch and reports its error.
  } finally {
    indexingStore.isProcessingEvents = false;
    indexingStore.isPipelined = false;
  }

  if (isProcessed === false) {
    // Note: Undo the partial batch, then let the caller run it sequentially.
    await commitPipeline.drain();
    common.metrics.flushIndexingMetrics();
    for (const value of initialCompletedEvents.values) {
      common.metrics.ponder_indexing_completed_events.set(
        value.labels,
        value.value,
      );
    }
    indexingCache.invalidate();
    indexingCache.clear();
    cachedViemClient.clear();
    return false;
  }

  common.metrics.ponder_historical_transform_duration.inc(
    { step: "index" },
    indexClock(),
  );

  const snapshot = indexingCache.detach();
  cachedViemClient.clear();

  commitPipeline.enqueue(async () => {
    const loadClock = startClock();
    await database.userQB.transaction(async (tx) => {
      await indexingCache.flush({ snapshot, qb: tx });
      common.metrics.ponder_historical_transform_duration.inc(
        { step: "load" },
        loadClock(),
      );
      await writeCheckpoint(tx);
    });
    indexingCache.release(snapshot);
    onCommitted();
  });

  await new Promise(setImmediate);
  return true;
};
