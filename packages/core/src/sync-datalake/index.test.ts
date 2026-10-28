import { readFileSync } from "node:fs";
import { afterEach, expect, test, vi } from "vitest";
import { expectSameAsRpc, withMetadata } from "@/_test/datalake.js";
import { createDatalakeClient, splitStreams } from "./client.js";

/**
 * Recorded from a datalake and a JSON-RPC node over the same 5 Robinhood Chain blocks
 * (58,600,000..58,600,004): log filter on one token (with `joinTransactions`), transaction
 * filters from/to one account, receipts. The JSON-RPC side keeps only the transactions the
 * filters require.
 */
const fixture = JSON.parse(
  readFileSync(new URL("./_test/fixture.json", import.meta.url), "utf8"),
);
const body = readFileSync(new URL("./_test/datalake.arrow", import.meta.url));

/** Pages with no rows: every stream (`empty.arrow`, blocks 58,600,000..58,600,001) or only
 * the transactions stream (`partly-empty.arrow`, the fixture's token logs and blocks). */
const empty = readFileSync(new URL("./_test/empty.arrow", import.meta.url));
const partlyEmpty = readFileSync(
  new URL("./_test/partly-empty.arrow", import.meta.url),
);

const arrowResponse = (bytes: Buffer) =>
  new Response(new Uint8Array(bytes), {
    status: 200,
    headers: { "content-type": "application/vnd.apache.arrow.stream" },
  });

const mockDatalake = () =>
  vi.spyOn(globalThis, "fetch").mockResolvedValue(arrowResponse(body));

afterEach(() => {
  vi.restoreAllMocks();
});

const loadPage = async () => {
  mockDatalake();
  const client = createDatalakeClient({ url: "http://datalake.test" });
  return client.query({ ...fixture.request });
};

test("client parses every stream and the stream metadata", async () => {
  const page = await loadPage();
  expect(page.nextBlock).toBe(58_600_005);
  expect(page.archiveHeight).toBe(61_038_669);
  expect(page.unavailableFields).toBeUndefined();
  expect(page.logs!.numRows).toBe(fixture.rpc.logs.length);
  expect(page.blocks!.numRows).toBe(5);
  expect(page.transactions!.numRows).toBe(fixture.rpc.receipts.length);
});

test("client surfaces the JSON error envelope", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(
      JSON.stringify({
        error: { code: "invalid_query", message: "unknown key" },
      }),
      { status: 400 },
    ),
  );
  const client = createDatalakeClient({ url: "http://datalake.test" });
  await expect(client.query({ ...fixture.request })).rejects.toThrow(
    "invalid_query: unknown key",
  );
});

test("encodePage makes the rows of the JSON-RPC path, column for column", async () => {
  const page = await loadPage();
  expectSameAsRpc(page, 4663, true, fixture.rpc);
});

test("client parses pages whose streams have no rows", async () => {
  vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
    arrowResponse(empty),
  );
  const client = createDatalakeClient({ url: "http://datalake.test" });
  const page = await client.query({ ...fixture.request });
  expect(page.nextBlock).toBe(58_600_002);
  expect(page.transactions!.numRows).toBe(0);
  expect(page.logs!.numRows).toBe(0);
  expect(page.blocks!.numRows).toBe(0);

  vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
    arrowResponse(partlyEmpty),
  );
  const partly = await client.query({ ...fixture.request });
  expect(partly.transactions!.numRows).toBe(0);
  expect(partly.logs!.numRows).toBe(fixture.rpc.logs.length);
  expect(partly.blocks!.numRows).toBe(5);
});

test("client rejects a body cut anywhere, message boundaries included", async () => {
  const streams = splitStreams(body);
  expect(streams.length).toBe(3);
  // Note: Cut at every message boundary and inside every message.
  const cuts = new Set<number>();
  for (let offset = 0, i = 0; i < streams.length; i++) {
    offset += streams[i]!.byteLength;
    cuts.add(offset - 8);
    cuts.add(offset - 1);
  }
  for (let cut = 0; cut < body.byteLength; cut += 997) cuts.add(cut);
  cuts.delete(body.byteLength);

  const client = createDatalakeClient(
    { url: "http://datalake.test" },
    { retryBudgetMs: 0 },
  );
  for (const cut of cuts) {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      arrowResponse(body.subarray(0, cut)),
    );
    await expect(
      client.query({ ...fixture.request }),
      `cut at ${cut}`,
    ).rejects.toThrow();
  }
});

test("client reads the unavailable fields and rejects a body without stream metadata", async () => {
  vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
    arrowResponse(
      withMetadata(body, {
        "bl.unavailable_fields": "blocks.total_difficulty,transactions.mint",
      }),
    ),
  );
  const client = createDatalakeClient(
    { url: "http://datalake.test" },
    { retryBudgetMs: 0 },
  );
  const page = await client.query({ ...fixture.request });
  expect(page.unavailableFields).toEqual([
    "blocks.total_difficulty",
    "transactions.mint",
  ]);

  vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
    arrowResponse(withMetadata(body, { "bl.unavailable_fields": "" })),
  );
  expect(
    (await client.query({ ...fixture.request })).unavailableFields,
  ).toEqual([]);

  // Note: A server from before the stream metadata (it sent `X-BL-*` headers instead).
  let calls = 0;
  vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
    calls++;
    return arrowResponse(withMetadata(body, { "bl.streams": undefined }));
  });
  await expect(client.query({ ...fixture.request })).rejects.toThrow(
    "without bl.* stream metadata",
  );
  expect(calls).toBe(1);
});

test("client surfaces the error code and does not retry unknown_set", async () => {
  let calls = 0;
  vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
    calls++;
    return new Response(
      JSON.stringify({
        error: { code: "unknown_set", message: "unknown set 0xab" },
      }),
      { status: 404 },
    );
  });
  const client = createDatalakeClient({ url: "http://datalake.test" });
  await expect(client.query({ ...fixture.request })).rejects.toMatchObject({
    status: 404,
    code: "unknown_set",
  });
  expect(calls).toBe(1);
});

test("client retries a datalake that is behind the requested range", async () => {
  const behind = withMetadata(empty, { "bl.next_block": "58600000" });
  let calls = 0;
  vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
    // Note: An empty page that does not advance, then the real page.
    calls++ < 2 ? arrowResponse(behind) : arrowResponse(body),
  );
  const retries: number[] = [];
  const client = createDatalakeClient(
    { url: "http://datalake.test" },
    { onRetry: ({ attempt }) => retries.push(attempt) },
  );
  const page = await client.query({ ...fixture.request });
  expect(retries).toEqual([1, 2]);
  expect(page.logs!.numRows).toBe(fixture.rpc.logs.length);

  vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
    arrowResponse(behind),
  );
  const impatient = createDatalakeClient(
    { url: "http://datalake.test" },
    { retryBudgetMs: 0 },
  );
  await expect(impatient.query({ ...fixture.request })).rejects.toThrow(
    "Datalake is behind",
  );
});

test("client retries rate limiting and server errors, not bad requests", async () => {
  for (const status of [429, 503]) {
    let calls = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      calls++ === 0 ? new Response("{}", { status }) : arrowResponse(body),
    );
    const client = createDatalakeClient({ url: "http://datalake.test" });
    await client.query({ ...fixture.request });
    expect(calls, `status ${status}`).toBe(2);
  }

  let calls = 0;
  vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
    calls++;
    return new Response("{}", { status: 400 });
  });
  const client = createDatalakeClient({ url: "http://datalake.test" });
  await expect(client.query({ ...fixture.request })).rejects.toThrow("400");
  expect(calls).toBe(1);
});
