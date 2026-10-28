import { RpcRequestError } from "viem";
import { afterEach, expect, test, vi } from "vitest";
import { createBatcher, MAX_BATCH_SIZE } from "./batch.js";
import { isPrivateHost } from "./index.js";

afterEach(() => {
  vi.restoreAllMocks();
});

const call = (i: number) => ({
  method: "eth_call",
  params: [{ to: "0x01", data: `0x${i.toString(16)}` }, "0x1"],
});

/**
 * An endpoint answering every call of a batch with its data; `calls()` counts its requests.
 *
 * Note: The spy's own call count is not used: under bun it includes calls of earlier tests.
 */
const batchEndpoint = () => {
  let calls = 0;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
    calls++;
    const body = JSON.parse(String(init!.body));
    return new Response(
      JSON.stringify(
        body.map((b: any) =>
          b.params?.[0]?.data === "0xbad"
            ? {
                jsonrpc: "2.0",
                id: b.id,
                error: { code: 3, message: "reverted" },
              }
            : {
                jsonrpc: "2.0",
                id: b.id,
                result: b.params?.[0]?.data ?? "0x1",
              },
        ),
      ),
    );
  });
  return { calls: () => calls };
};

test("batcher merges requests of the same turn into batches", async () => {
  const fetch = batchEndpoint();
  const send = vi.fn();
  const batcher = createBatcher({ url: "http://node", timeout: 1_000, send });

  const n = MAX_BATCH_SIZE + 5;
  const results = await Promise.all(
    Array.from({ length: n }, (_, i) => batcher.request(call(i))),
  );
  expect(results).toEqual(
    Array.from({ length: n }, (_, i) => `0x${i.toString(16)}`),
  );
  expect(fetch.calls()).toBe(2);
  expect(send).not.toHaveBeenCalled();
});

test("batcher rejects only the call that failed", async () => {
  batchEndpoint();
  const batcher = createBatcher({
    url: "http://node",
    timeout: 1_000,
    send: vi.fn(),
  });
  const [ok, bad] = await Promise.allSettled([
    batcher.request(call(1)),
    batcher.request({ method: "eth_call", params: [{ data: "0xbad" }, "0x1"] }),
  ]);
  expect(ok).toEqual({ status: "fulfilled", value: "0x1" });
  expect(bad.status).toBe("rejected");
  expect((bad as PromiseRejectedResult).reason).toBeInstanceOf(RpcRequestError);
});

test("batcher falls back to single requests when batches are refused", async () => {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
    const body = JSON.parse(String(init!.body));
    return new Response(
      JSON.stringify(
        body.map((b: any) => ({
          jsonrpc: "2.0",
          id: b.id,
          error: {
            code: 31,
            message: "Batch of more than 3 requests are not allowed",
          },
        })),
      ),
    );
  });
  const send = vi.fn(async (body: any) => body.params[0].data);
  const onSupport = vi.fn();
  const batcher = createBatcher({
    url: "http://node",
    timeout: 1_000,
    send,
    onSupport,
  });

  const results = await Promise.all(
    [1, 2, 3].map((i) => batcher.request(call(i))),
  );
  expect(results).toEqual(["0x1", "0x2", "0x3"]);
  expect(send).toHaveBeenCalledTimes(3);
  expect(onSupport).toHaveBeenCalledWith(false);

  // Later requests go out singly without trying a batch.
  await batcher.request(call(4));
  expect(send).toHaveBeenCalledTimes(4);
});

test("isPrivateHost", () => {
  for (const host of [
    "localhost",
    "127.0.0.1",
    "10.1.2.3",
    "172.16.0.1",
    "192.168.1.5",
    "[::1]",
  ]) {
    expect(isPrivateHost(host), host).toBe(true);
  }
  for (const host of [
    "eth.example.com",
    "8.8.8.8",
    "172.32.0.1",
    "11.0.0.1",
    "localhost.example.com",
  ]) {
    expect(isPrivateHost(host), host).toBe(false);
  }
});
