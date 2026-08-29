import { afterEach, describe, expect, it } from "vitest";
import {
  addressTransactions,
  listSignatures,
  resetAddressLogsForTests,
} from "./addressHistory";

const KEYS = [
  "SOLANA_TRACKER_RPC_URL",
  "SOLANA_TRACKER_API_KEY",
  "SOLANA_TRACKER_ACCESS_KEY",
  "SOLANATRACKER_API_KEY",
  "TRACKER_API_KEY",
  "SECURE_RPC_URL",
  "HELIUS_RPC_URL",
  "HELIUS_API_KEY",
] as const;

describe("addressTransactions uses standard Tracker RPC", () => {
  const saved: Partial<Record<(typeof KEYS)[number], string | undefined>> = {};

  afterEach(() => {
    resetAddressLogsForTests();
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  function isolate() {
    for (const k of KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  }

  it("loads signatures and full txs via standard methods, never gTFA", async () => {
    isolate();
    process.env.SOLANA_TRACKER_API_KEY = "tracker-test-key";
    const methods: string[] = [];
    const original = globalThis.fetch;
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      const payload = JSON.parse(String(init?.body ?? "{}")) as { method?: string };
      methods.push(String(payload.method));
      if (payload.method === "getTokenAccountsByOwner") {
        return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { value: [] } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (payload.method === "getSignaturesForAddress") {
        return new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            result: [
              { signature: "sig-new", blockTime: 200, err: null, slot: 2 },
              { signature: "sig-old", blockTime: 100, err: null, slot: 1 },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (payload.method === "getTransaction") {
        return new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            result: {
              blockTime: 200,
              slot: 2,
              transaction: { signatures: ["sig-new"], message: { accountKeys: [] } },
              meta: { err: null, preTokenBalances: [], postTokenBalances: [] },
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, error: { message: "unexpected" } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;
    try {
      const page = await addressTransactions({
        address: "Pool11111111111111111111111111111111111111",
        transactionDetails: "full",
        sortOrder: "desc",
        limit: 2,
      });
      expect(page?.data.length).toBeGreaterThan(0);
      expect(methods.some((m) => m === "getSignaturesForAddress")).toBe(true);
      expect(methods.some((m) => m === "getTransaction")).toBe(true);
      expect(methods).not.toContain("getTransactionsForAddress");
      expect(methods).not.toContain("getAsset");
    } finally {
      globalThis.fetch = original;
    }
  });

  it("listSignatures counts loaded sigs in a window instead of extrapolating", async () => {
    isolate();
    process.env.SOLANA_TRACKER_API_KEY = "tracker-test-key";
    const original = globalThis.fetch;
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      const payload = JSON.parse(String(init?.body ?? "{}")) as { method?: string };
      if (payload.method === "getSignaturesForAddress") {
        return new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            result: [
              { signature: "a", blockTime: 300, err: null, slot: 3 },
              { signature: "b", blockTime: 200, err: null, slot: 2 },
              { signature: "c", blockTime: 100, err: null, slot: 1 },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { value: [] } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;
    try {
      const all = await listSignatures("Pool11111111111111111111111111111111111111", {
        blockTime: { gte: 150, lt: 250 },
      });
      expect(all.map((s) => s.signature)).toEqual(["b"]);
    } finally {
      globalThis.fetch = original;
    }
  });
});
