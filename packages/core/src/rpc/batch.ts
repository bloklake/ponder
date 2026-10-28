import { HttpRequestError, RpcRequestError, TimeoutError } from "viem";
import { stringify } from "viem/utils";
import type { RpcRequest } from "./http.js";

/** JSON-RPC methods whose concurrent requests are merged into batch requests. */
export const BATCH_METHODS = new Set(["eth_call"]);
/** Largest JSON-RPC batch sent. */
export const MAX_BATCH_SIZE = 100;

type Pending = {
  body: RpcRequest;
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
};

/**
 * Merges the requests made in the same event loop turn into JSON-RPC batch requests (at most
 * {@link MAX_BATCH_SIZE} each). Each request still resolves or rejects on its own, with the
 * same errors as a single request. An endpoint that rejects batches is sent single requests
 * from then on (`send`).
 */
export const createBatcher = ({
  url,
  timeout,
  send,
  onSupport,
}: {
  url: string;
  timeout: number;
  /** A single request, as without batching. */
  send: (body: RpcRequest) => Promise<unknown>;
  /** Called when the endpoint is found to accept (or not) batch requests. */
  onSupport?: (supported: boolean) => void;
}) => {
  let pending: Pending[] = [];
  let scheduled = false;
  let supported: boolean | undefined;

  const single = (item: Pending) => {
    send(item.body).then(item.resolve, item.reject);
  };

  const setSupported = (value: boolean) => {
    if (supported === value) return;
    supported = value;
    onSupport?.(value);
  };

  const post = async (items: Pending[]) => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    const bodies = items.map((item, id) => ({
      jsonrpc: "2.0" as const,
      id,
      method: item.body.method,
      params: item.body.params,
    }));

    let response: Response;
    let data: unknown;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: stringify(bodies),
        signal: controller.signal,
      });
      const text = await response.text();
      try {
        data = JSON.parse(text || "null");
      } catch {
        data = text;
      }
    } catch (error) {
      for (const item of items) {
        item.reject(
          (error as Error).name === "AbortError"
            ? new TimeoutError({ body: item.body, url })
            : new HttpRequestError({
                body: item.body,
                cause: error as Error,
                url,
              }),
        );
      }
      return;
    } finally {
      clearTimeout(timeoutId);
    }

    if (response.status === 429) {
      for (const item of items) {
        item.reject(
          new HttpRequestError({
            body: item.body,
            details: stringify(data) || response.statusText,
            headers: response.headers,
            status: response.status,
            url,
          }),
        );
      }
      return;
    }

    const responses = Array.isArray(data) ? data : undefined;
    // Note: A batch refused as a whole (an HTTP error, an error object instead of an array,
    // or every item refused with the same batch error) means no batch support.
    const refused =
      response.ok === false ||
      responses === undefined ||
      (responses.length > 0 &&
        responses.every(
          (r: any) =>
            r?.error !== undefined &&
            /batch/i.test(String(r.error?.message ?? "")),
        ));
    if (refused) {
      setSupported(false);
      for (const item of items) single(item);
      return;
    }

    setSupported(true);
    const byId = new Map<number, any>();
    for (const r of responses) byId.set(Number(r?.id), r);
    for (const [id, item] of items.entries()) {
      const r = byId.get(id);
      if (r === undefined) {
        item.reject(
          new HttpRequestError({
            body: item.body,
            details: "Missing response in JSON-RPC batch",
            url,
          }),
        );
      } else if (r.error !== undefined) {
        item.reject(
          new RpcRequestError({ body: item.body, error: r.error, url }),
        );
      } else {
        item.resolve(r.result);
      }
    }
  };

  const flush = () => {
    scheduled = false;
    const items = pending;
    pending = [];
    if (items.length === 1 || supported === false) {
      for (const item of items) single(item);
      return;
    }
    for (let i = 0; i < items.length; i += MAX_BATCH_SIZE) {
      const chunk = items.slice(i, i + MAX_BATCH_SIZE);
      if (chunk.length === 1) single(chunk[0]!);
      else post(chunk);
    }
  };

  return {
    /**
     * Find out whether the endpoint accepts batch requests (two `eth_chainId` calls), so the
     * first real batch does not have to. Errors leave the support unknown.
     */
    probe() {
      if (supported !== undefined) return;
      const noop = () => {};
      post([
        { body: { method: "eth_chainId" }, resolve: noop, reject: noop },
        { body: { method: "eth_chainId" }, resolve: noop, reject: noop },
      ]).catch(noop);
    },
    request(body: RpcRequest): Promise<unknown> {
      if (supported === false) return send(body);
      return new Promise((resolve, reject) => {
        pending.push({ body, resolve, reject });
        if (pending.length >= MAX_BATCH_SIZE) flush();
        else if (scheduled === false) {
          scheduled = true;
          setImmediate(flush);
        }
      });
    },
  };
};
