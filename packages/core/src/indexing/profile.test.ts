import { getAbiItem, zeroAddress } from "viem";
import { expect, test } from "vitest";
import { ALICE, BOB } from "@/_test/constants.js";
import { erc20ABI } from "@/_test/generated.js";
import { getBlocksIndexingBuild, getChain } from "@/_test/utils.js";
import type { BlockEvent, LogEvent, TraceEvent } from "@/internal/types.js";
import { ZERO_CHECKPOINT_STRING } from "@/utils/checkpoint.js";
import {
  getProfilePatternKey,
  recordProfilePattern,
  recoverProfilePattern,
} from "./profile.js";

test("recordProfilePattern() with undefined log event args", () => {
  const { eventCallbacks } = getBlocksIndexingBuild({ interval: 1 });

  const event = {
    type: "log",
    chain: getChain(),
    checkpoint: ZERO_CHECKPOINT_STRING,
    eventCallback: eventCallbacks[0]!,
    event: {
      id: ZERO_CHECKPOINT_STRING,
      args: undefined,
      log: {} as LogEvent["event"]["log"],
      transaction: {} as LogEvent["event"]["transaction"],
      block: { number: 5n } as BlockEvent["event"]["block"],
    },
  } satisfies LogEvent;

  const pattern = recordProfilePattern({
    event,
    args: {
      address: zeroAddress,
      abi: [getAbiItem({ abi: erc20ABI, name: "balanceOf" })],
      functionName: "balanceOf",
      args: [ALICE],
    },
    hints: [],
  });

  expect(pattern).toMatchInlineSnapshot(`
    {
      "hasConstant": true,
      "pattern": {
        "abi": [
          {
            "inputs": [
              {
                "internalType": "address",
                "name": "",
                "type": "address",
              },
            ],
            "name": "balanceOf",
            "outputs": [
              {
                "internalType": "uint256",
                "name": "",
                "type": "uint256",
              },
            ],
            "stateMutability": "view",
            "type": "function",
          },
        ],
        "address": {
          "type": "constant",
          "value": "0x0000000000000000000000000000000000000000",
        },
        "args": [
          {
            "type": "constant",
            "value": "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
          },
        ],
        "cache": undefined,
        "functionName": "balanceOf",
      },
    }
  `);

  expect(recoverProfilePattern(pattern!.pattern, event)).toMatchInlineSnapshot(`
    {
      "abi": [
        {
          "inputs": [
            {
              "internalType": "address",
              "name": "",
              "type": "address",
            },
          ],
          "name": "balanceOf",
          "outputs": [
            {
              "internalType": "uint256",
              "name": "",
              "type": "uint256",
            },
          ],
          "stateMutability": "view",
          "type": "function",
        },
      ],
      "address": "0x0000000000000000000000000000000000000000",
      "args": [
        "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
      ],
      "blockNumber": 5n,
      "chainId": 1,
      "functionName": "balanceOf",
    }
  `);
});

test("recordProfilePattern() with undefined trace event args", () => {
  const { eventCallbacks } = getBlocksIndexingBuild({ interval: 1 });
  const event = {
    type: "trace",
    chain: getChain(),
    checkpoint: ZERO_CHECKPOINT_STRING,
    eventCallback: eventCallbacks[0]!,
    event: {
      id: ZERO_CHECKPOINT_STRING,
      args: undefined,
      result: undefined,
      trace: {} as TraceEvent["event"]["trace"],
      transaction: {} as TraceEvent["event"]["transaction"],
      block: { number: 5n } as BlockEvent["event"]["block"],
    },
  } satisfies TraceEvent;

  const pattern = recordProfilePattern({
    event,
    args: {
      address: zeroAddress,
      abi: [getAbiItem({ abi: erc20ABI, name: "balanceOf" })],
      functionName: "balanceOf",
      args: [ALICE],
    },
    hints: [],
  });

  expect(pattern).toMatchInlineSnapshot(`
    {
      "hasConstant": true,
      "pattern": {
        "abi": [
          {
            "inputs": [
              {
                "internalType": "address",
                "name": "",
                "type": "address",
              },
            ],
            "name": "balanceOf",
            "outputs": [
              {
                "internalType": "uint256",
                "name": "",
                "type": "uint256",
              },
            ],
            "stateMutability": "view",
            "type": "function",
          },
        ],
        "address": {
          "type": "constant",
          "value": "0x0000000000000000000000000000000000000000",
        },
        "args": [
          {
            "type": "constant",
            "value": "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
          },
        ],
        "cache": undefined,
        "functionName": "balanceOf",
      },
    }
  `);

  expect(recoverProfilePattern(pattern!.pattern, event)).toMatchInlineSnapshot(`
    {
      "abi": [
        {
          "inputs": [
            {
              "internalType": "address",
              "name": "",
              "type": "address",
            },
          ],
          "name": "balanceOf",
          "outputs": [
            {
              "internalType": "uint256",
              "name": "",
              "type": "uint256",
            },
          ],
          "stateMutability": "view",
          "type": "function",
        },
      ],
      "address": "0x0000000000000000000000000000000000000000",
      "args": [
        "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
      ],
      "blockNumber": 5n,
      "chainId": 1,
      "functionName": "balanceOf",
    }
  `);
});

test("recordProfilePattern() with array log event args", () => {
  const { eventCallbacks } = getBlocksIndexingBuild({ interval: 1 });
  const event = {
    type: "log",
    chain: getChain(),
    checkpoint: ZERO_CHECKPOINT_STRING,
    eventCallback: eventCallbacks[0]!,
    event: {
      id: ZERO_CHECKPOINT_STRING,
      args: [],
      log: {} as LogEvent["event"]["log"],
      transaction: {} as LogEvent["event"]["transaction"],
      block: { number: 5n } as BlockEvent["event"]["block"],
    },
  } satisfies LogEvent;

  const pattern = recordProfilePattern({
    event,
    args: {
      address: zeroAddress,
      abi: [getAbiItem({ abi: erc20ABI, name: "balanceOf" })],
      functionName: "balanceOf",
      args: [ALICE],
    },
    hints: [],
  });

  expect(pattern).toMatchInlineSnapshot(`
    {
      "hasConstant": true,
      "pattern": {
        "abi": [
          {
            "inputs": [
              {
                "internalType": "address",
                "name": "",
                "type": "address",
              },
            ],
            "name": "balanceOf",
            "outputs": [
              {
                "internalType": "uint256",
                "name": "",
                "type": "uint256",
              },
            ],
            "stateMutability": "view",
            "type": "function",
          },
        ],
        "address": {
          "type": "constant",
          "value": "0x0000000000000000000000000000000000000000",
        },
        "args": [
          {
            "type": "constant",
            "value": "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
          },
        ],
        "cache": undefined,
        "functionName": "balanceOf",
      },
    }
  `);

  expect(recoverProfilePattern(pattern!.pattern, event)).toMatchInlineSnapshot(`
    {
      "abi": [
        {
          "inputs": [
            {
              "internalType": "address",
              "name": "",
              "type": "address",
            },
          ],
          "name": "balanceOf",
          "outputs": [
            {
              "internalType": "uint256",
              "name": "",
              "type": "uint256",
            },
          ],
          "stateMutability": "view",
          "type": "function",
        },
      ],
      "address": "0x0000000000000000000000000000000000000000",
      "args": [
        "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
      ],
      "blockNumber": 5n,
      "chainId": 1,
      "functionName": "balanceOf",
    }
  `);
});

test("recordProfilePattern() with array trace event args", () => {
  const { eventCallbacks } = getBlocksIndexingBuild({ interval: 1 });
  const event = {
    type: "trace",
    chain: getChain(),
    checkpoint: ZERO_CHECKPOINT_STRING,
    eventCallback: eventCallbacks[0]!,
    event: {
      id: ZERO_CHECKPOINT_STRING,
      args: [],
      result: [],
      trace: {} as TraceEvent["event"]["trace"],
      transaction: {} as TraceEvent["event"]["transaction"],
      block: { number: 5n } as BlockEvent["event"]["block"],
    },
  } satisfies TraceEvent;

  const pattern = recordProfilePattern({
    event,
    args: {
      address: zeroAddress,
      abi: [getAbiItem({ abi: erc20ABI, name: "balanceOf" })],
      functionName: "balanceOf",
      args: [ALICE],
    },
    hints: [],
  });

  expect(pattern).toMatchInlineSnapshot(`
    {
      "hasConstant": true,
      "pattern": {
        "abi": [
          {
            "inputs": [
              {
                "internalType": "address",
                "name": "",
                "type": "address",
              },
            ],
            "name": "balanceOf",
            "outputs": [
              {
                "internalType": "uint256",
                "name": "",
                "type": "uint256",
              },
            ],
            "stateMutability": "view",
            "type": "function",
          },
        ],
        "address": {
          "type": "constant",
          "value": "0x0000000000000000000000000000000000000000",
        },
        "args": [
          {
            "type": "constant",
            "value": "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
          },
        ],
        "cache": undefined,
        "functionName": "balanceOf",
      },
    }
  `);

  expect(recoverProfilePattern(pattern!.pattern, event)).toMatchInlineSnapshot(`
    {
      "abi": [
        {
          "inputs": [
            {
              "internalType": "address",
              "name": "",
              "type": "address",
            },
          ],
          "name": "balanceOf",
          "outputs": [
            {
              "internalType": "uint256",
              "name": "",
              "type": "uint256",
            },
          ],
          "stateMutability": "view",
          "type": "function",
        },
      ],
      "address": "0x0000000000000000000000000000000000000000",
      "args": [
        "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
      ],
      "blockNumber": 5n,
      "chainId": 1,
      "functionName": "balanceOf",
    }
  `);
});

test("recordProfilePattern() address", () => {
  const { eventCallbacks } = getBlocksIndexingBuild({ interval: 1 });
  const event = {
    type: "log",
    chain: getChain(),
    checkpoint: ZERO_CHECKPOINT_STRING,
    eventCallback: eventCallbacks[0]!,
    event: {
      id: ZERO_CHECKPOINT_STRING,
      args: { address: zeroAddress },
      log: {} as LogEvent["event"]["log"],
      transaction: {} as LogEvent["event"]["transaction"],
      block: {
        number: 1n,
      } as BlockEvent["event"]["block"],
    },
  } satisfies LogEvent;

  const pattern = recordProfilePattern({
    event,
    args: {
      address: zeroAddress,
      abi: [getAbiItem({ abi: erc20ABI, name: "balanceOf" })],
      functionName: "totalSupply",
    },
    hints: [],
  });

  expect(pattern).toMatchInlineSnapshot(`
    {
      "hasConstant": false,
      "pattern": {
        "abi": [
          {
            "inputs": [
              {
                "internalType": "address",
                "name": "",
                "type": "address",
              },
            ],
            "name": "balanceOf",
            "outputs": [
              {
                "internalType": "uint256",
                "name": "",
                "type": "uint256",
              },
            ],
            "stateMutability": "view",
            "type": "function",
          },
        ],
        "address": {
          "type": "derived",
          "value": [
            "args",
            "address",
          ],
        },
        "args": undefined,
        "cache": undefined,
        "functionName": "totalSupply",
      },
    }
  `);

  expect(recoverProfilePattern(pattern!.pattern, event)).toMatchInlineSnapshot(`
    {
      "abi": [
        {
          "inputs": [
            {
              "internalType": "address",
              "name": "",
              "type": "address",
            },
          ],
          "name": "balanceOf",
          "outputs": [
            {
              "internalType": "uint256",
              "name": "",
              "type": "uint256",
            },
          ],
          "stateMutability": "view",
          "type": "function",
        },
      ],
      "address": "0x0000000000000000000000000000000000000000",
      "args": undefined,
      "blockNumber": 1n,
      "chainId": 1,
      "functionName": "totalSupply",
    }
  `);
});

test("recordProfilePattern() args", () => {
  const { eventCallbacks } = getBlocksIndexingBuild({ interval: 1 });
  const event = {
    type: "log",
    chain: getChain(),
    checkpoint: ZERO_CHECKPOINT_STRING,
    eventCallback: eventCallbacks[0]!,
    event: {
      id: ZERO_CHECKPOINT_STRING,
      args: { address: zeroAddress },
      log: {
        address: ALICE,
      } as unknown as LogEvent["event"]["log"],
      transaction: {} as LogEvent["event"]["transaction"],
      block: { number: 5n } as BlockEvent["event"]["block"],
    },
  } satisfies LogEvent;

  const pattern = recordProfilePattern({
    event,
    args: {
      address: zeroAddress,
      abi: [getAbiItem({ abi: erc20ABI, name: "balanceOf" })],
      functionName: "balanceOf",
      args: [ALICE],
    },
    hints: [],
  });

  expect(pattern).toMatchInlineSnapshot(`
    {
      "hasConstant": false,
      "pattern": {
        "abi": [
          {
            "inputs": [
              {
                "internalType": "address",
                "name": "",
                "type": "address",
              },
            ],
            "name": "balanceOf",
            "outputs": [
              {
                "internalType": "uint256",
                "name": "",
                "type": "uint256",
              },
            ],
            "stateMutability": "view",
            "type": "function",
          },
        ],
        "address": {
          "type": "derived",
          "value": [
            "args",
            "address",
          ],
        },
        "args": [
          {
            "type": "derived",
            "value": [
              "log",
              "address",
            ],
          },
        ],
        "cache": undefined,
        "functionName": "balanceOf",
      },
    }
  `);

  expect(recoverProfilePattern(pattern!.pattern, event)).toMatchInlineSnapshot(`
    {
      "abi": [
        {
          "inputs": [
            {
              "internalType": "address",
              "name": "",
              "type": "address",
            },
          ],
          "name": "balanceOf",
          "outputs": [
            {
              "internalType": "uint256",
              "name": "",
              "type": "uint256",
            },
          ],
          "stateMutability": "view",
          "type": "function",
        },
      ],
      "address": "0x0000000000000000000000000000000000000000",
      "args": [
        "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
      ],
      "blockNumber": 5n,
      "chainId": 1,
      "functionName": "balanceOf",
    }
  `);
});

test("recordProfilePattern() constants", () => {
  const { eventCallbacks } = getBlocksIndexingBuild({ interval: 1 });
  const event = {
    type: "log",
    chain: getChain(),
    checkpoint: ZERO_CHECKPOINT_STRING,
    eventCallback: eventCallbacks[0]!,
    event: {
      id: ZERO_CHECKPOINT_STRING,
      args: { address: zeroAddress },
      log: {} as unknown as LogEvent["event"]["log"],
      transaction: {} as LogEvent["event"]["transaction"],
      block: { number: 5n } as BlockEvent["event"]["block"],
    },
  } satisfies LogEvent;

  const pattern = recordProfilePattern({
    event,
    args: {
      address: zeroAddress,
      abi: [getAbiItem({ abi: erc20ABI, name: "balanceOf" })],
      functionName: "balanceOf",
      args: [ALICE],
    },
    hints: [],
  });

  expect(pattern).toMatchInlineSnapshot(`
    {
      "hasConstant": true,
      "pattern": {
        "abi": [
          {
            "inputs": [
              {
                "internalType": "address",
                "name": "",
                "type": "address",
              },
            ],
            "name": "balanceOf",
            "outputs": [
              {
                "internalType": "uint256",
                "name": "",
                "type": "uint256",
              },
            ],
            "stateMutability": "view",
            "type": "function",
          },
        ],
        "address": {
          "type": "derived",
          "value": [
            "args",
            "address",
          ],
        },
        "args": [
          {
            "type": "constant",
            "value": "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
          },
        ],
        "cache": undefined,
        "functionName": "balanceOf",
      },
    }
  `);

  expect(recoverProfilePattern(pattern!.pattern, event)).toMatchInlineSnapshot(`
    {
      "abi": [
        {
          "inputs": [
            {
              "internalType": "address",
              "name": "",
              "type": "address",
            },
          ],
          "name": "balanceOf",
          "outputs": [
            {
              "internalType": "uint256",
              "name": "",
              "type": "uint256",
            },
          ],
          "stateMutability": "view",
          "type": "function",
        },
      ],
      "address": "0x0000000000000000000000000000000000000000",
      "args": [
        "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
      ],
      "blockNumber": 5n,
      "chainId": 1,
      "functionName": "balanceOf",
    }
  `);
});

test("recordProfilePattern() hint", () => {
  const { eventCallbacks } = getBlocksIndexingBuild({ interval: 1 });
  const event = {
    type: "log",
    chain: getChain(),
    checkpoint: ZERO_CHECKPOINT_STRING,
    eventCallback: eventCallbacks[0]!,
    event: {
      id: ZERO_CHECKPOINT_STRING,
      args: { address: zeroAddress },
      log: {} as unknown as LogEvent["event"]["log"],
      transaction: {} as LogEvent["event"]["transaction"],
      block: { number: 5n } as BlockEvent["event"]["block"],
    },
  } satisfies LogEvent;

  let pattern = recordProfilePattern({
    event,
    args: {
      address: zeroAddress,
      abi: [getAbiItem({ abi: erc20ABI, name: "balanceOf" })],
      functionName: "balanceOf",
      args: [ALICE],
    },
    hints: [],
  });

  pattern = recordProfilePattern({
    event,
    args: {
      address: zeroAddress,
      abi: [getAbiItem({ abi: erc20ABI, name: "balanceOf" })],
      functionName: "balanceOf",
      args: [ALICE],
    },
    hints: [pattern!],
  });

  expect(pattern).toMatchInlineSnapshot(`
    {
      "hasConstant": true,
      "pattern": {
        "abi": [
          {
            "inputs": [
              {
                "internalType": "address",
                "name": "",
                "type": "address",
              },
            ],
            "name": "balanceOf",
            "outputs": [
              {
                "internalType": "uint256",
                "name": "",
                "type": "uint256",
              },
            ],
            "stateMutability": "view",
            "type": "function",
          },
        ],
        "address": {
          "type": "derived",
          "value": [
            "args",
            "address",
          ],
        },
        "args": [
          {
            "type": "constant",
            "value": "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
          },
        ],
        "cache": undefined,
        "functionName": "balanceOf",
      },
    }
  `);

  expect(recoverProfilePattern(pattern!.pattern, event)).toMatchInlineSnapshot(`
    {
      "abi": [
        {
          "inputs": [
            {
              "internalType": "address",
              "name": "",
              "type": "address",
            },
          ],
          "name": "balanceOf",
          "outputs": [
            {
              "internalType": "uint256",
              "name": "",
              "type": "uint256",
            },
          ],
          "stateMutability": "view",
          "type": "function",
        },
      ],
      "address": "0x0000000000000000000000000000000000000000",
      "args": [
        "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
      ],
      "blockNumber": 5n,
      "chainId": 1,
      "functionName": "balanceOf",
    }
  `);
});

test("recordProfilePattern() hint with different args", () => {
  const { eventCallbacks } = getBlocksIndexingBuild({ interval: 1 });
  const event = {
    type: "log",
    chain: getChain(),
    checkpoint: ZERO_CHECKPOINT_STRING,
    eventCallback: eventCallbacks[0]!,
    event: {
      id: ZERO_CHECKPOINT_STRING,
      args: { from: ALICE, to: BOB },
      log: {} as unknown as LogEvent["event"]["log"],
      transaction: {} as LogEvent["event"]["transaction"],
      block: { number: 5n } as BlockEvent["event"]["block"],
    },
  } satisfies LogEvent;

  const hint = recordProfilePattern({
    event,
    args: {
      address: zeroAddress,
      abi: [getAbiItem({ abi: erc20ABI, name: "balanceOf" })],
      functionName: "balanceOf",
      args: [ALICE],
    },
    hints: [],
  });

  const pattern = recordProfilePattern({
    event,
    args: {
      address: zeroAddress,
      abi: [getAbiItem({ abi: erc20ABI, name: "balanceOf" })],
      functionName: "balanceOf",
      args: [BOB],
    },
    hints: [hint!],
  });

  expect(pattern).not.toBe(hint);
  expect(pattern!.pattern.args).toStrictEqual([
    { type: "derived", value: ["args", "to"] },
  ]);
  expect(recoverProfilePattern(pattern!.pattern, event).args).toStrictEqual([
    BOB,
  ]);
});

test("recordProfilePattern() cache immutable", () => {
  const { eventCallbacks } = getBlocksIndexingBuild({ interval: 1 });
  const event = {
    type: "log",
    chain: getChain(),
    checkpoint: ZERO_CHECKPOINT_STRING,
    eventCallback: eventCallbacks[0]!,
    event: {
      id: ZERO_CHECKPOINT_STRING,
      args: undefined,
      log: {} as LogEvent["event"]["log"],
      transaction: {} as LogEvent["event"]["transaction"],
      block: { number: 5n } as BlockEvent["event"]["block"],
    },
  } satisfies LogEvent;

  const pattern = recordProfilePattern({
    event,
    args: {
      address: zeroAddress,
      abi: [getAbiItem({ abi: erc20ABI, name: "balanceOf" })],
      functionName: "balanceOf",
      args: [ALICE],
      cache: "immutable",
    },
    hints: [],
  });

  expect(pattern).toMatchInlineSnapshot(`
    {
      "hasConstant": true,
      "pattern": {
        "abi": [
          {
            "inputs": [
              {
                "internalType": "address",
                "name": "",
                "type": "address",
              },
            ],
            "name": "balanceOf",
            "outputs": [
              {
                "internalType": "uint256",
                "name": "",
                "type": "uint256",
              },
            ],
            "stateMutability": "view",
            "type": "function",
          },
        ],
        "address": {
          "type": "constant",
          "value": "0x0000000000000000000000000000000000000000",
        },
        "args": [
          {
            "type": "constant",
            "value": "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
          },
        ],
        "cache": "immutable",
        "functionName": "balanceOf",
      },
    }
  `);

  expect(recoverProfilePattern(pattern!.pattern, event)).toMatchInlineSnapshot(`
    {
      "abi": [
        {
          "inputs": [
            {
              "internalType": "address",
              "name": "",
              "type": "address",
            },
          ],
          "name": "balanceOf",
          "outputs": [
            {
              "internalType": "uint256",
              "name": "",
              "type": "uint256",
            },
          ],
          "stateMutability": "view",
          "type": "function",
        },
      ],
      "address": "0x0000000000000000000000000000000000000000",
      "args": [
        "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
      ],
      "blockNumber": "latest",
      "chainId": 1,
      "functionName": "balanceOf",
    }
  `);
});

test("recordProfilePattern() constants per contract", () => {
  const { eventCallbacks } = getBlocksIndexingBuild({ interval: 1 });
  const POOL_A = "0x000000000000000000000000000000000000000A";
  const POOL_B = "0x000000000000000000000000000000000000000b";
  const eventOf = (address: `0x${string}`) =>
    ({
      type: "log",
      chain: getChain(),
      checkpoint: ZERO_CHECKPOINT_STRING,
      eventCallback: eventCallbacks[0]!,
      event: {
        id: ZERO_CHECKPOINT_STRING,
        args: undefined,
        log: { address } as unknown as LogEvent["event"]["log"],
        transaction: {} as LogEvent["event"]["transaction"],
        block: { number: 5n } as BlockEvent["event"]["block"],
      },
    }) satisfies LogEvent;
  // Note: The token address comes from the database, not from the event.
  const balanceOf = (pool: `0x${string}`) => ({
    address: ALICE,
    abi: [getAbiItem({ abi: erc20ABI, name: "balanceOf" })],
    functionName: "balanceOf" as const,
    args: [pool] as const,
  });

  const a = recordProfilePattern({
    event: eventOf(POOL_A),
    args: balanceOf(POOL_A),
    hints: [],
  });
  expect(a).toMatchObject({
    hasConstant: true,
    pattern: {
      address: { type: "constant", value: ALICE },
      args: [{ type: "derived", value: ["log", "address"] }],
      when: POOL_A.toLowerCase(),
    },
  });

  // The pattern of pool A is not a hint for pool B.
  const b = recordProfilePattern({
    event: eventOf(POOL_B),
    args: balanceOf(POOL_B),
    hints: [a!],
  });
  expect(b).not.toBe(a);
  expect(b!.pattern.when).toBe(POOL_B.toLowerCase());
  expect(getProfilePatternKey(a!.pattern)).not.toBe(
    getProfilePatternKey(b!.pattern),
  );

  // It is for pool A.
  expect(
    recordProfilePattern({
      event: eventOf(POOL_A),
      args: balanceOf(POOL_A),
      hints: [b!, a!],
    }),
  ).toBe(a);
});

test("recordProfilePattern() hint with different args", () => {
  const { eventCallbacks } = getBlocksIndexingBuild({ interval: 1 });
  const event = {
    type: "log",
    chain: getChain(),
    checkpoint: ZERO_CHECKPOINT_STRING,
    eventCallback: eventCallbacks[0]!,
    event: {
      id: ZERO_CHECKPOINT_STRING,
      args: { address: zeroAddress },
      log: {} as unknown as LogEvent["event"]["log"],
      transaction: {} as LogEvent["event"]["transaction"],
      block: { number: 5n } as BlockEvent["event"]["block"],
    },
  } satisfies LogEvent;
  const balanceOf = (owner: `0x${string}`) => ({
    address: zeroAddress,
    abi: [getAbiItem({ abi: erc20ABI, name: "balanceOf" })],
    functionName: "balanceOf" as const,
    args: [owner] as const,
  });

  const alice = recordProfilePattern({
    event,
    args: balanceOf(ALICE),
    hints: [],
  });
  const bob = recordProfilePattern({
    event,
    args: balanceOf(BOB),
    hints: [alice!],
  });
  expect(bob).not.toBe(alice);
  expect(bob!.pattern.args).toEqual([{ type: "constant", value: BOB }]);
});
