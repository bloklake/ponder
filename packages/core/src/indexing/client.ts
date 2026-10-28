import {
  type Abi,
  type AbiFunction,
  type AbiParameter,
  type Account,
  BlockNotFoundError,
  type Client,
  type ContractFunctionArgs,
  type ContractFunctionName,
  type ContractFunctionParameters,
  concatHex,
  createClient,
  custom,
  decodeFunctionData,
  decodeFunctionResult,
  encodeAbiParameters,
  encodeFunctionData,
  encodeFunctionResult,
  type GetBlockReturnType,
  type GetTransactionConfirmationsParameters,
  type GetTransactionConfirmationsReturnType,
  type GetTransactionParameters,
  type GetTransactionReceiptParameters,
  type GetTransactionReceiptReturnType,
  type GetTransactionReturnType,
  getAbiItem,
  type Hash,
  type Hex,
  hexToNumber,
  type MulticallParameters,
  type MulticallReturnType,
  multicall3Abi,
  type Prettify,
  type PublicActions,
  type PublicRpcSchema,
  publicActions,
  type ReadContractParameters,
  type ReadContractReturnType,
  type SimulateContractParameters,
  type SimulateContractReturnType,
  TransactionNotFoundError,
  TransactionReceiptNotFoundError,
  type Transport,
  toFunctionSelector,
  toHex,
  type Chain as ViemChain,
} from "viem";
import type { Common } from "@/internal/common.js";
import type {
  Chain,
  Event,
  IndexingBuild,
  SetupEvent,
} from "@/internal/types.js";
import type { RequestParameters, Rpc } from "@/rpc/index.js";
import type { SyncStore } from "@/sync-store/index.js";
import { dedupe } from "@/utils/dedupe.js";
import { toLowerCase } from "@/utils/lowercase.js";
import { orderObject } from "@/utils/order.js";
import { startClock } from "@/utils/timer.js";
import { wait } from "@/utils/wait.js";
import {
  conditionOf,
  getProfilePatternKey,
  recordProfilePattern,
  recoverProfilePattern,
} from "./profile.js";

export type CachedViemClient = {
  getClient: (chain: Chain) => ReadonlyClient;
  /**
   * Predict and load the contract reads of `events`. With `keep`, the loaded results survive
   * the next {@link CachedViemClient.clear} (a prefetch for the following batch).
   */
  prefetch: (params: { events: Event[]; keep?: boolean }) => Promise<void>;
  clear: () => void;
  event: Event | SetupEvent | undefined;
  /** Incremented whenever the profile gains a pattern (predictions may have changed). */
  readonly profileVersion: number;
  /** Called when the profile gains a pattern, while the call that taught it is in flight. */
  onProfileChange: (() => void) | undefined;
};

const MULTICALL_SELECTOR = toFunctionSelector(
  getAbiItem({ abi: multicall3Abi, name: "aggregate3" }),
);

const SAMPLING_RATE = 10;

/**
 * Whether the calls of an event are profiled: every event until an event name has
 * `SAMPLING_RATE` of them (so a batch's calls can be predicted after its first events), then
 * one in `SAMPLING_RATE`.
 */
const isSampled = (eventCount: number) =>
  eventCount < SAMPLING_RATE || eventCount % SAMPLING_RATE === 1;
const DB_PREDICTION_THRESHOLD = 0.2;
const RPC_PREDICTION_THRESHOLD = 0.8;
const MAX_CONSTANT_PATTERN_COUNT = 10;
/** Below this share of predicted requests found cached, prefetch skips the lookup... */
const DB_SKIP_HIT_RATE = 0.01;
/** ...judged on a lookup of at least this many requests... */
const DB_SKIP_MIN_REQUESTS = 100;
/** ...and looks again after this many skipped prefetches. */
const DB_RECHECK_INTERVAL = 10;
/** Constant patterns recorded per contract ({@link ProfilePattern.when}), per event name. */
const MAX_CONDITIONAL_PATTERN_COUNT = 1_000;

/**
 * RPC responses that are not cached. These are valid responses
 * that are sometimes erroneously returned by the RPC.
 *
 * `"0x"` is returned by `eth_call` and causes the `ContractFunctionZeroDataError`.
 * `null` is returned by `eth_getBlockByNumber` and `eth_getBlockByHash` and causes the `BlockNotFoundError`.
 */
const UNCACHED_RESPONSES = ["0x", null] as any[];

/** RPC methods that reference a block number. */
const blockDependentMethods = new Set([
  "eth_getBalance",
  "eth_getTransactionCount",
  "eth_getBlockByNumber",
  "eth_getBlockTransactionCountByNumber",
  "eth_getTransactionByBlockNumberAndIndex",
  "eth_call",
  "eth_estimateGas",
  "eth_feeHistory",
  "eth_getProof",
  "eth_getCode",
  "eth_getStorageAt",
  "eth_getUncleByBlockNumberAndIndex",
  "debug_traceBlockByNumber",
]);

/** RPC methods that don't reference a block number. */
const nonBlockDependentMethods = new Set([
  "eth_getBlockByHash",
  "eth_getTransactionByHash",
  "eth_getBlockTransactionCountByHash",
  "eth_getTransactionByBlockHashAndIndex",
  "eth_getTransactionConfirmations",
  "eth_getTransactionReceipt",
  "eth_getUncleByBlockHashAndIndex",
  "eth_getUncleCountByBlockHash",
  "debug_traceBlockByHash",
  "debug_traceTransaction",
  "debug_traceCall",
]);

/** Viem actions where the `block` property is optional and implicit. */
const blockDependentActions = [
  "getBalance",
  "call",
  "estimateGas",
  "getFeeHistory",
  "getProof",
  "getCode",
  "getStorageAt",
  "getEnsAddress",
  "getEnsAvatar",
  "getEnsName",
  "getEnsResolver",
  "getEnsText",
  "readContract",
  "multicall",
  "simulateContract",
] as const satisfies readonly (keyof ReturnType<typeof publicActions>)[];

/** Viem actions where the `block` property is required. */
const blockRequiredActions = [
  "getBlock",
  "getTransactionCount",
  "getBlockTransactionCount",
] as const satisfies readonly (keyof ReturnType<typeof publicActions>)[];

/** Viem actions where the `block` property is non-existent. */
const nonBlockDependentActions = [
  "getTransaction",
  "getTransactionReceipt",
  "getTransactionConfirmations",
] as const satisfies readonly (keyof ReturnType<typeof publicActions>)[];

/** Viem actions that should be retried if they fail. */
const retryableActions = [
  "readContract",
  "simulateContract",
  "multicall",
  "getBlock",
  "getTransaction",
  "getTransactionReceipt",
  "getTransactionConfirmations",
] as const satisfies readonly (keyof ReturnType<typeof publicActions>)[];

type BlockOptions =
  | {
      cache?: undefined;
      blockNumber?: undefined;
    }
  | {
      cache: "immutable";
      blockNumber?: undefined;
    }
  | {
      cache?: undefined;
      blockNumber: bigint;
    };

type RequiredBlockOptions =
  | {
      /** Hash of the block. */
      blockHash: Hash;
      blockNumber?: undefined;
    }
  | {
      blockHash?: undefined;
      /** The block number. */
      blockNumber: bigint;
    };

type RetryableOptions = {
  /**
   * Whether or not to retry the action if the response is empty.
   *
   * @default true
   */
  retryEmptyResponse?: boolean;
};

type BlockDependentAction<
  fn extends (client: any, args: any) => unknown,
  ///
  params = Parameters<fn>[0],
  returnType = ReturnType<fn>,
> = (
  args: Omit<params, "blockTag" | "blockNumber"> & BlockOptions,
) => returnType;

export type PonderActions = Omit<
  {
    [action in (typeof blockDependentActions)[number]]: BlockDependentAction<
      ReturnType<typeof publicActions>[action]
    >;
  } & Pick<PublicActions, (typeof nonBlockDependentActions)[number]> &
    Pick<PublicActions, (typeof blockRequiredActions)[number]>,
  (typeof retryableActions)[number]
> & {
  // Types for `retryableActions` are manually defined.
  readContract: <
    const abi extends Abi | readonly unknown[],
    functionName extends ContractFunctionName<abi, "pure" | "view">,
    const args extends ContractFunctionArgs<abi, "pure" | "view", functionName>,
  >(
    args: Omit<
      ReadContractParameters<abi, functionName, args>,
      "blockTag" | "blockNumber"
    > &
      BlockOptions &
      RetryableOptions,
  ) => Promise<ReadContractReturnType<abi, functionName, args>>;
  simulateContract: <
    const abi extends Abi | readonly unknown[],
    functionName extends ContractFunctionName<abi, "nonpayable" | "payable">,
    const args extends ContractFunctionArgs<
      abi,
      "nonpayable" | "payable",
      functionName
    >,
  >(
    args: Omit<
      SimulateContractParameters<abi, functionName, args>,
      "blockTag" | "blockNumber"
    > &
      BlockOptions &
      RetryableOptions,
  ) => Promise<SimulateContractReturnType<abi, functionName, args>>;
  multicall: <
    const contracts extends readonly unknown[],
    allowFailure extends boolean = true,
  >(
    args: Omit<
      MulticallParameters<contracts, allowFailure>,
      "blockTag" | "blockNumber"
    > &
      BlockOptions &
      RetryableOptions,
  ) => Promise<MulticallReturnType<contracts, allowFailure>>;
  getBlock: <includeTransactions extends boolean = false>(
    args: {
      /** Whether or not to include transaction data in the response. */
      includeTransactions?: includeTransactions | undefined;
    } & RequiredBlockOptions &
      RetryableOptions,
  ) => Promise<GetBlockReturnType<ViemChain | undefined, includeTransactions>>;
  getTransaction: (
    args: GetTransactionParameters & RetryableOptions,
  ) => Promise<GetTransactionReturnType>;
  getTransactionReceipt: (
    args: GetTransactionReceiptParameters & RetryableOptions,
  ) => Promise<GetTransactionReceiptReturnType>;
  getTransactionConfirmations: (
    args: GetTransactionConfirmationsParameters & RetryableOptions,
  ) => Promise<GetTransactionConfirmationsReturnType>;
};

export type ReadonlyClient<
  transport extends Transport = Transport,
  chain extends ViemChain | undefined = ViemChain | undefined,
> = Prettify<
  Omit<
    Client<transport, chain, undefined, PublicRpcSchema, PonderActions>,
    | "extend"
    | "key"
    | "batch"
    | "cacheTime"
    | "account"
    | "type"
    | "uid"
    | "chain"
    | "name"
    | "pollingInterval"
    | "transport"
    | "ccipRead"
  >
>;

/**
 * RPC request.
 */
export type Request = Pick<
  ReadContractParameters,
  "abi" | "address" | "functionName" | "args"
> & { blockNumber: bigint | "latest"; chainId: number };
/**
 * Serialized RPC request for uniquely identifying a request.
 *
 * @dev Encoded from {@link Request} using `abi`.
 *
 * @example
 * "{
 *   "method": "eth_call",
 *   "params": [{"data": "0x123", "to": "0x456"}, "0x789"]
 * }"
 */
type CacheKey = string;
/**
 * Response of an RPC request.
 *
 * @example
 * "0x123"
 *
 * @example
 * ""0x123456789""
 */
type Response = string;
/**
 * Recorded RPC request pattern.
 *
 * @example
 * {
 *   "address": ["args", "from"],
 *   "abi": [...],
 *   "functionName": "balanceOf",
 *   "args": ["log", "address"],
 * }
 */
export type ProfilePattern = Pick<
  ReadContractParameters,
  "abi" | "functionName"
> & {
  address:
    | { type: "constant"; value: unknown }
    | { type: "derived"; value: string[] };
  args?: (
    | { type: "constant"; value: unknown }
    | { type: "derived"; value: string[] }
  )[];
  cache?: "immutable";
  /** For a pattern with constants: the contract of the log events it was recorded for. */
  when?: string;
};
/**
 * Serialized {@link ProfilePattern} for unique identification.
 *
 * @example
 * "{
 *   "address": ["args", "from"],
 *   "args": ["log", "address"],
 *   "functionName": "balanceOf",
 * }"
 */
type ProfileKey = string;
/**
 * Event name.
 *
 * @example
 * "Erc20:Transfer"
 *
 * @example
 * "Erc20.mint()"
 */
type EventName = string;
/**
 * Metadata about RPC request patterns for each event.
 *
 * @dev Only profile "eth_call" requests.
 */
type Profile = Map<
  EventName,
  Map<
    ProfileKey,
    { pattern: ProfilePattern; hasConstant: boolean; count: number }
  >
>;
/**
 * LRU cache of {@link ProfilePattern} in {@link Profile} with constant args.
 *
 * @dev Used to determine which {@link ProfilePattern} should be evicted.
 */
type ProfileConstantLRU = Map<EventName, Set<ProfileKey>>;
/**
 * Cache of RPC responses.
 */
type Cache = Map<number, Map<CacheKey, Promise<Response | Error> | Response>>;

export const getCacheKey = (request: RequestParameters) => {
  return toLowerCase(JSON.stringify(orderObject(request)));
};

/** Per ABI and function name: the function's selector and inputs, when it is not overloaded. */
const functionEncodings = new WeakMap<
  Abi,
  Map<string, { selector: Hex; inputs: readonly AbiParameter[] } | null>
>();

/**
 * `encodeFunctionData`, with the function selector computed once per ABI and function name
 * instead of hashing the signature on every call.
 */
export const encodeCallData = ({
  abi,
  functionName,
  args,
}: {
  abi: Abi;
  functionName: string;
  args?: readonly unknown[];
}): Hex => {
  let byName = functionEncodings.get(abi);
  if (byName === undefined) {
    byName = new Map();
    functionEncodings.set(abi, byName);
  }
  let encoding = byName.get(functionName);
  if (encoding === undefined) {
    const items = abi.filter(
      (item): item is AbiFunction =>
        item.type === "function" && item.name === functionName,
    );
    encoding =
      items.length === 1
        ? { selector: toFunctionSelector(items[0]!), inputs: items[0]!.inputs }
        : null;
    byName.set(functionName, encoding);
  }
  // Note: Overloads are resolved from the arguments by viem.
  if (encoding === null) {
    return encodeFunctionData({ abi, functionName, args } as any);
  }
  if (encoding.inputs.length === 0) return encoding.selector;
  return concatHex([
    encoding.selector,
    encodeAbiParameters(encoding.inputs, (args ?? []) as readonly unknown[]),
  ]);
};

export const encodeRequest = (request: Request) =>
  ({
    method: "eth_call",
    params: [
      {
        to: request.address,
        data: encodeCallData({
          abi: request.abi,
          functionName: request.functionName,
          args: request.args,
        }),
      },
      request.blockNumber === "latest" ? "latest" : toHex(request.blockNumber),
    ],
  }) satisfies RequestParameters;

export const decodeResponse = (response: Response) => {
  // Note: I don't actually remember why we had to add the try catch.
  try {
    return JSON.parse(response);
  } catch (_error) {
    return response;
  }
};

export const createCachedViemClient = ({
  common,
  indexingBuild,
  syncStore,
  eventCount,
}: {
  common: Common;
  indexingBuild: Pick<IndexingBuild, "chains" | "rpcs">;
  syncStore: SyncStore;
  eventCount: { [eventName: string]: number };
}): CachedViemClient => {
  let event: Event | SetupEvent = undefined!;
  const cache: Cache = new Map();
  const profile: Profile = new Map();
  const profileConstantLRU: ProfileConstantLRU = new Map();
  const profileConditionalLRU: ProfileConstantLRU = new Map();
  let profileVersion = 0;
  /** `cache`, under a name the action wrappers do not shadow. */
  const resultCache = cache;
  const keepKey = (chainId: number, key: string) => {
    if (keptKeys.has(chainId) === false) keptKeys.set(chainId, new Set());
    keptKeys.get(chainId)!.add(key);
  };
  /** Per chain: cache keys loaded by a `keep` prefetch, kept by the next `clear`. */
  const keptKeys = new Map<number, Set<string>>();
  /** Per chain: results to write to `ponder_sync`, flushed once per event loop turn. */
  const pendingInserts = new Map<
    number,
    {
      request: RequestParameters;
      blockNumber: number | undefined;
      result: string;
    }[]
  >();
  let isInsertScheduled = false;
  const queueInsert = (
    chainId: number,
    entry: {
      request: RequestParameters;
      blockNumber: number | undefined;
      result: string;
    },
  ) => {
    if (pendingInserts.has(chainId) === false) pendingInserts.set(chainId, []);
    pendingInserts.get(chainId)!.push(entry);
    if (isInsertScheduled) return;
    isInsertScheduled = true;
    setImmediate(() => {
      isInsertScheduled = false;
      for (const [chainId, requests] of pendingInserts) {
        // Note: As for a single request, a failed insert only costs the cache entry.
        syncStore
          .insertRpcRequestResults({ requests, chainId })
          .catch(() => {});
      }
      pendingInserts.clear();
    });
  };
  let onProfileChange: (() => void) | undefined;
  /** Sampled log events per event name and contract (see {@link ProfilePattern.when}). */
  const sampledLogEvents = new Map<EventName, Map<string, number>>();
  /** Sampled events per event name: the denominator of a prediction's expected use. */
  const sampledEvents = new Map<EventName, number>();
  /** Per chain: share of the last cache lookup's requests found, prefetches since. */
  const dbLookup = new Map<number, { hitRate: number; skipped: number }>();

  const constantLRU = (eventName: EventName, pattern: ProfilePattern) => {
    const lrus =
      pattern.when === undefined ? profileConstantLRU : profileConditionalLRU;
    if (lrus.has(eventName) === false) lrus.set(eventName, new Set());
    return lrus.get(eventName)!;
  };

  for (const chain of indexingBuild.chains) {
    cache.set(chain.id, new Map());
  }

  const ponderActions = <
    TTransport extends Transport = Transport,
    TChain extends ViemChain | undefined = ViemChain | undefined,
    TAccount extends Account | undefined = Account | undefined,
  >(
    client: Client<TTransport, TChain, TAccount>,
  ): PonderActions => {
    const actions = {} as PonderActions;
    const _publicActions = publicActions(client);

    const addProfilePattern = ({
      pattern,
      hasConstant,
    }: {
      pattern: ProfilePattern;
      hasConstant: boolean;
    }) => {
      const profilePatternKey = getProfilePatternKey(pattern);
      const eventName = (event as Event).eventCallback.name;

      if (profile.get(eventName)!.has(profilePatternKey)) {
        profile.get(eventName)!.get(profilePatternKey)!.count++;

        if (hasConstant) {
          const lru = constantLRU(eventName, pattern);
          lru.delete(profilePatternKey);
          lru.add(profilePatternKey);
        }
      } else {
        profile
          .get(eventName)!
          .set(profilePatternKey, { pattern, hasConstant, count: 1 });
        profileVersion++;
        onProfileChange?.();

        if (hasConstant) {
          const lru = constantLRU(eventName, pattern);
          lru.add(profilePatternKey);
          if (
            lru.size >
            (pattern.when === undefined
              ? MAX_CONSTANT_PATTERN_COUNT
              : MAX_CONDITIONAL_PATTERN_COUNT)
          ) {
            const firstKey = lru.keys().next().value;
            if (firstKey) {
              profile.get(eventName)!.delete(firstKey);
              lru.delete(firstKey);
            }
          }
        }
      }
    };

    const getPonderAction = <
      action extends (typeof blockDependentActions)[number],
    >(
      action: action,
    ) => {
      return ({
        cache,
        blockNumber: userBlockNumber,
        ...args
      }: Parameters<PonderActions[action]>[0]) => {
        // Note: prediction only possible when block number is managed by Ponder.

        if (
          event.type !== "setup" &&
          userBlockNumber === undefined &&
          isSampled(eventCount[event.eventCallback.name]!)
        ) {
          const eventName = event.eventCallback.name;

          if (profile.has(eventName) === false) {
            profile.set(eventName, new Map());
            profileConstantLRU.set(eventName, new Set());
          }

          // profile "readContract" and "multicall" actions
          if (action === "readContract") {
            const recordPatternResult = recordProfilePattern({
              event: event,
              args: { ...args, cache } as Parameters<
                PonderActions["readContract"]
              >[0],
              hints: Array.from(profile.get(eventName)!.values()),
            });
            if (recordPatternResult) {
              addProfilePattern(recordPatternResult);
            }
          } else if (action === "multicall") {
            const contracts = (
              { ...args, cache } as Parameters<PonderActions["multicall"]>[0]
            ).contracts as ContractFunctionParameters[];

            if (contracts.length < 10) {
              for (const contract of contracts) {
                const recordPatternResult = recordProfilePattern({
                  event: event,
                  args: contract,
                  hints: Array.from(profile.get(eventName)!.values()),
                });
                if (recordPatternResult) {
                  addProfilePattern(recordPatternResult);
                }
              }
            }
          }
        }

        const blockNumber =
          event.type === "setup" ? event.block : event.event.block.number;

        const viemAction = () =>
          // @ts-expect-error
          _publicActions[action]({
            ...args,
            ...(cache === "immutable"
              ? { blockTag: "latest" }
              : { blockNumber: userBlockNumber ?? blockNumber }),
          } as Parameters<ReturnType<typeof publicActions>[action]>[0]);

        // Note: A read that was prefetched is answered from the cache directly, without
        // encoding it again and going through the transport; anything else (a miss, an
        // error, an empty result) takes the viem path, which reports errors as usual.
        if (action === "readContract" && event.type !== "setup") {
          const read = args as unknown as Parameters<
            PonderActions["readContract"]
          >[0];
          const chainId = event.chain.id;
          const requestBlock =
            cache === "immutable" ? "latest" : (userBlockNumber ?? blockNumber);
          const request = encodeRequest({
            address: read.address,
            abi: read.abi as Abi,
            functionName: read.functionName,
            args: read.args as readonly unknown[] | undefined,
            blockNumber: requestBlock,
            chainId,
          });
          const cached = resultCache.get(chainId)?.get(getCacheKey(request));
          if (cached !== undefined) {
            return (async () => {
              const result = cached instanceof Promise ? await cached : cached;
              if (typeof result !== "string") return viemAction();
              const data = decodeResponse(result);
              if (typeof data !== "string" || data === "0x")
                return viemAction();
              common.metrics.ponder_indexing_rpc_requests_total.inc({
                chain: event.chain.name,
                method: "eth_call",
                type:
                  cached instanceof Promise
                    ? "prefetch_rpc"
                    : "prefetch_database",
              });
              if (cached instanceof Promise) {
                queueInsert(chainId, {
                  request,
                  blockNumber:
                    requestBlock === "latest" ? 0 : Number(requestBlock),
                  result,
                });
              }
              return decodeFunctionResult({
                abi: read.abi as Abi,
                functionName: read.functionName,
                args: read.args as readonly unknown[] | undefined,
                data: data as Hex,
              });
            })();
          }
        }

        return viemAction();
      };
    };

    const getRetryAction = (
      action: PonderActions[keyof PonderActions],
      actionName: keyof PonderActions,
    ) => {
      return async (...args: Parameters<typeof action>) => {
        const RETRY_COUNT = 9;
        const BASE_DURATION = 125;
        for (let i = 0; i <= RETRY_COUNT; i++) {
          try {
            // @ts-expect-error
            return await action(...args);
          } catch (error) {
            const eventName =
              event.type === "setup"
                ? event.setupCallback.name
                : event.eventCallback.name;
            if (
              (error instanceof BlockNotFoundError === false &&
                error instanceof TransactionNotFoundError === false &&
                error instanceof TransactionReceiptNotFoundError === false &&
                // Note: Another way to catch this error is:
                // `error instanceof ContractFunctionExecutionError && error.cause instanceOf ContractFunctionZeroDataError`
                (error as Error)?.message?.includes("returned no data") ===
                  false) ||
              i === RETRY_COUNT ||
              (args[0] as RetryableOptions).retryEmptyResponse === false
            ) {
              const chain = indexingBuild.chains.find(
                (n) => n.id === event.chain.id,
              )!;
              common.logger.warn({
                msg: "Failed 'context.client' action",
                action: actionName,
                event: eventName,
                chain: chain.name,
                chain_id: chain.id,
                retry_count: i,
                error: error as Error,
              });

              throw error;
            }

            const duration = BASE_DURATION * 2 ** i;
            const chain = indexingBuild.chains.find(
              (n) => n.id === event.chain.id,
            )!;
            common.logger.warn({
              msg: "Failed 'context.client' action",
              action: actionName,
              event: eventName,
              chain: chain.name,
              chain_id: chain.id,
              retry_count: i,
              retry_delay: duration,
              error: error as Error,
            });
            await wait(duration);
          }
        }
      };
    };

    for (const action of blockDependentActions) {
      actions[action] = getPonderAction(action);
    }

    for (const action of nonBlockDependentActions) {
      // @ts-expect-error
      actions[action] = _publicActions[action];
    }

    for (const action of blockRequiredActions) {
      // @ts-expect-error
      actions[action] = _publicActions[action];
    }

    for (const action of retryableActions) {
      actions[action] = getRetryAction(actions[action], action);
    }

    const actionsWithMetrics = {} as PonderActions;

    for (const [action, actionFn] of Object.entries(actions)) {
      // @ts-expect-error
      actionsWithMetrics[action] = async (
        ...args: Parameters<PonderActions[keyof PonderActions]>
      ) => {
        const endClock = startClock();
        try {
          // @ts-expect-error
          return await actionFn(...args);
        } finally {
          common.metrics.ponder_indexing_rpc_action_duration.observe(
            { action },
            endClock(),
          );
        }
      };
    }

    return actionsWithMetrics;
  };

  return {
    getClient(chain) {
      const rpc = indexingBuild.rpcs[indexingBuild.chains.indexOf(chain)]!;

      return createClient({
        transport: cachedTransport({
          common,
          chain,
          rpc,
          syncStore,
          cache,
          event: () => event,
        }),
        chain: chain.viemChain,
        // @ts-expect-error overriding `readContract` is not supported by viem
      }).extend(ponderActions);
    },
    async prefetch({ events, keep = false }) {
      const context = {
        logger: common.logger.child({ action: "prefetch_rpc_requests" }),
      };
      const prefetchEndClock = startClock();

      // Use profiling metadata + next event batch to determine which
      // rpc requests are going to be made, and preload them into the cache.

      const prediction: { ev: number; request: Request }[] = [];

      for (const event of events) {
        if (profile.has(event.eventCallback.name)) {
          const when = conditionOf(event);
          for (const [, { pattern, count }] of profile.get(
            event.eventCallback.name,
          )!) {
            // Expected value of times the prediction will be used.
            let ev: number;
            if (pattern.when === undefined) {
              ev =
                count /
                (sampledEvents.get(event.eventCallback.name) ??
                  Number.POSITIVE_INFINITY);
            } else {
              if (pattern.when !== when) continue;
              ev =
                count /
                (sampledLogEvents.get(event.eventCallback.name)?.get(when) ??
                  Number.POSITIVE_INFINITY);
            }
            prediction.push({
              ev,
              request: recoverProfilePattern(pattern, event),
            });
          }
        }
      }

      const chainRequests: Map<
        number,
        { ev: number; request: RequestParameters }[]
      > = new Map();
      for (const chain of indexingBuild.chains) {
        chainRequests.set(chain.id, []);
      }

      for (const { ev, request } of dedupe(prediction, ({ request }) =>
        getCacheKey(encodeRequest(request)),
      )) {
        // Note: Already cached or in flight (a prefetch of the same events ahead).
        const key = getCacheKey(encodeRequest(request));
        if (cache.get(request.chainId)!.has(key)) {
          if (keep) keepKey(request.chainId, key);
          continue;
        }
        chainRequests.get(request.chainId)!.push({
          ev,
          request: encodeRequest(request),
        });
      }

      await Promise.all(
        Array.from(chainRequests.entries()).map(async ([chainId, requests]) => {
          const i = indexingBuild.chains.findIndex((n) => n.id === chainId);
          const chain = indexingBuild.chains[i]!;
          const rpc = indexingBuild.rpcs[i]!;

          const dbRequests = requests.filter(
            ({ ev }) => ev > DB_PREDICTION_THRESHOLD,
          );

          // Note: Without the rpc request cache, all requests miss the database.
          let cachedResults: (string | undefined)[] = [];
          if (chain.cacheRpcRequests) {
            common.metrics.ponder_indexing_rpc_prefetch_total.inc(
              {
                chain: chain.name,
                method: "eth_call",
                type: "database",
              },
              dbRequests.length,
            );

            // Note: When the previous lookups found (almost) nothing cached — a range indexed
            // for the first time — the requests go out without waiting for another lookup;
            // every `DB_RECHECK_INTERVAL`th prefetch still looks.
            const state = dbLookup.get(chainId) ?? { hitRate: 1, skipped: 0 };
            const skipLookup =
              state.hitRate < DB_SKIP_HIT_RATE &&
              state.skipped < DB_RECHECK_INTERVAL;
            cachedResults = skipLookup
              ? new Array<undefined>(dbRequests.length)
              : await syncStore.getRpcRequestResults(
                  {
                    requests: dbRequests.map(({ request }) => request),
                    chainId,
                  },
                  context,
                );
            if (skipLookup) {
              state.skipped++;
            } else if (dbRequests.length >= DB_SKIP_MIN_REQUESTS) {
              state.hitRate =
                cachedResults.filter((r) => r !== undefined).length /
                dbRequests.length;
              state.skipped = 0;
            }
            dbLookup.set(chainId, state);
          }

          for (let i = 0; i < dbRequests.length; i++) {
            const request = dbRequests[i]!;
            const cachedResult = cachedResults[i];

            if (cachedResult !== undefined) {
              cache
                .get(chainId)!
                .set(getCacheKey(request.request), cachedResult);
              if (keep) keepKey(chainId, getCacheKey(request.request));
            } else if (request.ev > RPC_PREDICTION_THRESHOLD) {
              const resultPromise = rpc
                .request(request.request, context)
                .then((result) => JSON.stringify(result))
                .catch((error) => error as Error);

              common.metrics.ponder_indexing_rpc_prefetch_total.inc({
                chain: chain.name,
                method: "eth_call",
                type: "rpc",
              });

              // Note: Unawaited request added to cache
              cache
                .get(chainId)!
                .set(getCacheKey(request.request), resultPromise);
              if (keep) keepKey(chainId, getCacheKey(request.request));
            }
          }

          if (dbRequests.length > 0) {
            common.logger.debug({
              msg: "Prefetched JSON-RPC requests",
              chain: chain.name,
              chain_id: chain.id,
              request_count: dbRequests.length,
              duration: prefetchEndClock(),
            });
          }
        }),
      );
    },
    clear() {
      for (const chain of indexingBuild.chains) {
        const kept = keptKeys.get(chain.id);
        const chainCache = cache.get(chain.id)!;
        if (kept === undefined || kept.size === 0) {
          chainCache.clear();
          continue;
        }
        for (const key of chainCache.keys()) {
          if (kept.has(key) === false) chainCache.delete(key);
        }
      }
      // Note: Kept entries are cleared with the batch they were loaded for.
      keptKeys.clear();
    },
    get profileVersion() {
      return profileVersion;
    },
    get onProfileChange() {
      return onProfileChange;
    },
    set onProfileChange(callback: (() => void) | undefined) {
      onProfileChange = callback;
    },
    set event(_event: Event | SetupEvent) {
      event = _event;
      // Note: The same sampling as the profiling of the event's calls.
      if (
        _event.type !== "setup" &&
        isSampled(eventCount[_event.eventCallback.name]!)
      ) {
        const name = _event.eventCallback.name;
        sampledEvents.set(name, (sampledEvents.get(name) ?? 0) + 1);
      }
      if (
        _event.type === "log" &&
        isSampled(eventCount[_event.eventCallback.name]!)
      ) {
        const name = _event.eventCallback.name;
        const when = conditionOf(_event)!;
        if (sampledLogEvents.has(name) === false) {
          sampledLogEvents.set(name, new Map());
        }
        const counts = sampledLogEvents.get(name)!;
        counts.set(when, (counts.get(when) ?? 0) + 1);
      }
    },
  };
};

export const cachedTransport =
  ({
    common,
    chain,
    rpc,
    syncStore,
    cache,
    event,
  }: {
    common: Common;
    chain: Chain;
    rpc: Rpc;
    syncStore: SyncStore;
    cache: Cache;
    event: () => Event | SetupEvent;
  }): Transport =>
  ({ chain: viemChain }) =>
    custom({
      async request({ method, params }) {
        const _event = event();
        const context = {
          logger: common.logger.child({
            action: "cache JSON-RPC request",
            event:
              _event.type === "setup"
                ? _event.setupCallback.name
                : _event.eventCallback.name,
          }),
        };
        const body = { method, params };

        // multicall
        if (
          method === "eth_call" &&
          params[0]?.data?.startsWith(MULTICALL_SELECTOR)
        ) {
          let blockNumber: Hex | "latest" | undefined;
          [, blockNumber] = params;

          const multicallRequests = decodeFunctionData({
            abi: multicall3Abi,
            data: params[0]!.data,
          }).args[0];

          if (multicallRequests.length === 0) {
            // empty multicall result
            return "0x00000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000000";
          }

          const requests = multicallRequests.map(
            (call) =>
              ({
                method: "eth_call",
                params: [
                  {
                    to: call.target,
                    data: call.callData,
                  },
                  blockNumber ?? "latest",
                ],
              }) as const satisfies RequestParameters,
          );
          const results = new Map<
            RequestParameters,
            {
              success: boolean;
              returnData: `0x${string}`;
            }
          >();
          const requestsToInsert = new Set<RequestParameters>();

          for (const request of requests) {
            const cacheKey = getCacheKey(request);

            if (cache.get(chain.id)!.has(cacheKey)) {
              const cachedResult = cache.get(chain.id)!.get(cacheKey)!;

              if (cachedResult instanceof Promise) {
                common.metrics.ponder_indexing_rpc_requests_total.inc({
                  chain: chain.name,
                  method,
                  type: "prefetch_rpc",
                });
                const result = await cachedResult;

                // Note: we don't attempt to cache or prefetch errors, instead relying on the eventual RPC request.

                if (result instanceof Error) continue;

                if (UNCACHED_RESPONSES.includes(result) === false) {
                  requestsToInsert.add(request);
                }

                results.set(request, {
                  success: true,
                  returnData: decodeResponse(result),
                });
              } else {
                common.metrics.ponder_indexing_rpc_requests_total.inc({
                  chain: chain.name,
                  method,
                  type: "prefetch_database",
                });
                results.set(request, {
                  success: true,
                  returnData: decodeResponse(cachedResult),
                });
              }
            }
          }

          const dbRequests = requests.filter(
            (request) => results.has(request) === false,
          );

          const dbResults = chain.cacheRpcRequests
            ? await syncStore.getRpcRequestResults(
                { requests: dbRequests, chainId: chain.id },
                context,
              )
            : [];

          for (let i = 0; i < dbRequests.length; i++) {
            const request = dbRequests[i]!;
            const result = dbResults[i];

            if (result !== undefined) {
              common.metrics.ponder_indexing_rpc_requests_total.inc({
                chain: chain.name,
                method,
                type: "database",
              });

              results.set(request, {
                success: true,
                returnData: decodeResponse(result),
              });
            }
          }

          if (results.size < requests.length) {
            const _requests = requests.filter(
              (request) => results.has(request) === false,
            );

            const multicallResult = await rpc
              .request(
                {
                  method: "eth_call",
                  params: [
                    {
                      to: params[0]!.to,
                      data: encodeFunctionData({
                        abi: multicall3Abi,
                        functionName: "aggregate3",
                        args: [
                          multicallRequests.filter(
                            (_, i) => results.has(requests[i]!) === false,
                          ),
                        ],
                      }),
                    },
                    blockNumber!,
                  ],
                },
                context,
              )
              .then((result) =>
                decodeFunctionResult({
                  abi: multicall3Abi,
                  functionName: "aggregate3",
                  data: result,
                }),
              );

            for (let i = 0; i < _requests.length; i++) {
              const request = _requests[i]!;
              const result = multicallResult[i]!;

              if (
                result.success &&
                UNCACHED_RESPONSES.includes(result.returnData) === false
              ) {
                requestsToInsert.add(request);
              }

              common.metrics.ponder_indexing_rpc_requests_total.inc({
                chain: chain.name,
                method,
                type: "rpc",
              });

              results.set(request, result);
            }
          }

          const encodedBlockNumber =
            blockNumber === undefined
              ? undefined
              : blockNumber === "latest"
                ? 0
                : hexToNumber(blockNumber);

          // Note: insertRpcRequestResults errors can be ignored and not awaited, since
          // the response is already fetched.
          if (chain.cacheRpcRequests) {
            syncStore
              .insertRpcRequestResults(
                {
                  requests: Array.from(requestsToInsert).map((request) => ({
                    request,
                    blockNumber: encodedBlockNumber,
                    result: JSON.stringify(results.get(request)!.returnData),
                  })),
                  chainId: chain.id,
                },
                context,
              )
              .catch(() => {});
          }

          // Note: at this point, it is an invariant that either `allowFailure` is true or
          // there are no failed requests.

          // Note: viem <= 2.23.6 had a bug with `encodeFunctionResult` which can be worked around by adding
          // another layer of array nesting.
          // Fixed by this commit https://github.com/wevm/viem/commit/9c442de0ff38ac1f654b5c751d292e9a9f8d574c

          const resultsToEncode = requests.map(
            (request) => results.get(request)!,
          );

          try {
            return encodeFunctionResult({
              abi: multicall3Abi,
              functionName: "aggregate3",
              result: resultsToEncode,
            });
          } catch (_e) {
            return encodeFunctionResult({
              abi: multicall3Abi,
              functionName: "aggregate3",
              result: [
                // @ts-expect-error known issue in viem <= 2.23.6
                resultsToEncode,
              ],
            });
          }
        } else if (
          blockDependentMethods.has(method) ||
          nonBlockDependentMethods.has(method)
        ) {
          const blockNumber = extractBlockNumberParam(body);
          const encodedBlockNumber =
            blockNumber === undefined
              ? undefined
              : blockNumber === "latest"
                ? 0
                : hexToNumber(blockNumber);

          const cacheKey = getCacheKey(body);

          if (cache.get(chain.id)!.has(cacheKey)) {
            const cachedResult = cache.get(chain.id)!.get(cacheKey)!;

            // `cachedResult` is a Promise if the request had to be fetched from the RPC.
            if (cachedResult instanceof Promise) {
              common.metrics.ponder_indexing_rpc_requests_total.inc({
                chain: chain.name,
                method,
                type: "prefetch_rpc",
              });
              const result = await cachedResult;

              if (result instanceof Error) throw result;

              if (
                chain.cacheRpcRequests &&
                UNCACHED_RESPONSES.includes(result) === false
              ) {
                // Note: insertRpcRequestResults errors can be ignored and not awaited, since
                // the response is already fetched.
                syncStore
                  .insertRpcRequestResults(
                    {
                      requests: [
                        {
                          request: body,
                          blockNumber: encodedBlockNumber,
                          result,
                        },
                      ],
                      chainId: chain.id,
                    },
                    context,
                  )
                  .catch(() => {});
              }

              return decodeResponse(result);
            } else {
              common.metrics.ponder_indexing_rpc_requests_total.inc({
                chain: chain.name,
                method,
                type: "prefetch_database",
              });
            }

            return decodeResponse(cachedResult);
          }

          const [cachedResult] = chain.cacheRpcRequests
            ? await syncStore.getRpcRequestResults(
                { requests: [body], chainId: chain.id },
                context,
              )
            : [undefined];

          if (cachedResult !== undefined) {
            common.metrics.ponder_indexing_rpc_requests_total.inc({
              chain: chain.name,
              method,
              type: "database",
            });

            return decodeResponse(cachedResult);
          }

          common.metrics.ponder_indexing_rpc_requests_total.inc({
            chain: chain.name,
            method,
            type: "rpc",
          });

          const response = await rpc.request(body, context);

          if (
            chain.cacheRpcRequests &&
            UNCACHED_RESPONSES.includes(response) === false
          ) {
            // Note: insertRpcRequestResults errors can be ignored and not awaited, since
            // the response is already fetched.
            syncStore
              .insertRpcRequestResults(
                {
                  requests: [
                    {
                      request: body,
                      blockNumber: encodedBlockNumber,
                      result: JSON.stringify(response),
                    },
                  ],
                  chainId: chain.id,
                },
                context,
              )
              .catch(() => {});
          }
          return response;
        } else {
          return rpc.request(body, context);
        }
      },
    })({ chain: viemChain, retryCount: 0 });

export const extractBlockNumberParam = (request: RequestParameters) => {
  let blockNumber: Hex | "latest" | undefined;

  switch (request.method) {
    case "eth_getBlockByNumber":
    case "eth_getBlockTransactionCountByNumber":
    case "eth_getTransactionByBlockNumberAndIndex":
    case "eth_getUncleByBlockNumberAndIndex":
    case "debug_traceBlockByNumber":
      // @ts-expect-error
      [blockNumber] = request.params;
      break;
    case "eth_getBalance":
    case "eth_call":
    case "eth_getCode":
    case "eth_estimateGas":
    case "eth_feeHistory":
    case "eth_getTransactionCount":
      // @ts-expect-error
      [, blockNumber] = request.params;
      break;

    case "eth_getProof":
    case "eth_getStorageAt":
      // @ts-expect-error
      [, , blockNumber] = request.params;
      break;
  }

  return blockNumber;
};
