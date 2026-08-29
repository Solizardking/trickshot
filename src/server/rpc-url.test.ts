import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { config, resolveRpcUrl } from "./config";
import { rpcSend } from "./rpc";

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

describe("trickshot JSON-RPC uses Solana Tracker", () => {
  const saved: Partial<Record<(typeof KEYS)[number], string | undefined>> = {};

  afterEach(() => {
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

  it("builds a Tracker URL with api_key from a Tracker key alone", () => {
    isolate();
    process.env.SOLANA_TRACKER_API_KEY = "tracker-test-key";
    const resolved = resolveRpcUrl();
    expect(resolved).toBe(config.rpcUrl);
    const url = new URL(resolved);
    expect(url.hostname.endsWith("solanatracker.io")).toBe(true);
    expect(url.searchParams.get("api_key")).toBe("tracker-test-key");
    expect(url.searchParams.has("api-key")).toBe(false);
    expect(resolved).not.toMatch(/helius-rpc\.com/i);
  });

  it("prefers a dedicated Secure RPC host over shared Tracker and Helius", () => {
    isolate();
    process.env.SECURE_RPC_URL = "https://example.secure.rpc.solanatracker.io";
    process.env.SOLANA_TRACKER_RPC_URL =
      "https://rpc-mainnet.solanatracker.io/?api_key=shared";
    process.env.SOLANA_TRACKER_ACCESS_KEY = "access-key";
    process.env.HELIUS_API_KEY = "helius-should-be-ignored";
    process.env.HELIUS_RPC_URL =
      "https://mainnet.helius-rpc.com/?api-key=helius-should-be-ignored";
    const url = new URL(config.rpcUrl);
    expect(url.hostname).toBe("example.secure.rpc.solanatracker.io");
    expect(url.searchParams.has("api_key")).toBe(false);
    expect(url.searchParams.has("api-key")).toBe(false);
    expect(config.rpcUrl).not.toMatch(/helius-rpc\.com/i);
  });

  it("does not require HELIUS_API_KEY when a Tracker URL is set", () => {
    isolate();
    process.env.SOLANA_TRACKER_RPC_URL =
      "https://rpc-mainnet.solanatracker.io/?api_key=from-url";
    const url = new URL(resolveRpcUrl());
    expect(url.hostname.endsWith("solanatracker.io")).toBe(true);
    expect(url.searchParams.get("api_key")).toBe("from-url");
    expect(url.searchParams.has("api-key")).toBe(false);
    expect(url.href).not.toMatch(/helius-rpc\.com/i);
  });

  it("strips api_key from a dedicated Secure RPC host", () => {
    isolate();
    process.env.SECURE_RPC_URL =
      "https://example.secure.rpc.solanatracker.io/?api_key=must-not-stick";
    const url = new URL(resolveRpcUrl());
    expect(url.hostname).toBe("example.secure.rpc.solanatracker.io");
    expect(url.searchParams.has("api_key")).toBe(false);
    expect(url.searchParams.has("api-key")).toBe(false);
  });

  it("strips Helius api-key from a Tracker URL", () => {
    isolate();
    process.env.SOLANA_TRACKER_RPC_URL =
      "https://rpc-mainnet.solanatracker.io/?api-key=misnamed";
    const url = new URL(resolveRpcUrl());
    expect(url.searchParams.has("api-key")).toBe(false);
    expect(url.searchParams.get("api_key")).toBe("misnamed");
  });

  it("rpcSend POSTs JSON-RPC to the Tracker URL with api_key", async () => {
    isolate();
    process.env.SOLANA_TRACKER_API_KEY = "tracker-test-key";
    const seen: { url: string; method?: string; body: string }[] = [];
    const original = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      seen.push({
        url: String(input),
        method: init?.method,
        body: String(init?.body ?? ""),
      });
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "ok" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;
    try {
      const json = await rpcSend({
        jsonrpc: "2.0",
        id: 1,
        method: "getHealth",
        params: [],
      });
      expect(json?.result).toBe("ok");
      expect(seen).toHaveLength(1);
      expect(seen[0]?.method).toBe("POST");
      const url = new URL(seen[0]!.url);
      expect(url.hostname.endsWith("solanatracker.io")).toBe(true);
      expect(url.searchParams.get("api_key")).toBe("tracker-test-key");
      expect(url.searchParams.has("api-key")).toBe(false);
      expect(url.href).not.toMatch(/helius-rpc\.com/i);
      expect(JSON.parse(seen[0]!.body).method).toBe("getHealth");
    } finally {
      globalThis.fetch = original;
    }
  });

  it("JSON-RPC call sites post through the gated sender, not a Helius URL", () => {
    const dir = path.dirname(fileURLToPath(import.meta.url));
    const files = [
      "candles.ts",
      "density.ts",
      "graph.ts",
      "holdings.ts",
      "identity.ts",
      "history.ts",
      "pool.ts",
      "rpc.ts",
      "config.ts",
      "addressHistory.ts",
    ];
    for (const name of files) {
      const src = fs.readFileSync(path.join(dir, name), "utf8");
      if (name === "config.ts") {
        expect(src).toMatch(/solanatracker\.io/);
        expect(src).toMatch(/api_key/);
        continue;
      }
      expect(src, name).not.toMatch(/mainnet\.helius-rpc\.com/);
      if (name !== "rpc.ts") {
        expect(src, name).not.toMatch(/fetch\(\s*config\.rpcUrl/);
      }
      if (name !== "addressHistory.ts") {
        expect(src, name).not.toMatch(/method:\s*"getTransactionsForAddress"/);
      }
    }
    const rpcSrc = fs.readFileSync(path.join(dir, "rpc.ts"), "utf8");
    expect(rpcSrc).toMatch(/fetch\(\s*config\.rpcUrl/);
    const cli = fs.readFileSync(path.join(dir, "../../scripts/index-token.mjs"), "utf8");
    expect(cli).toMatch(/resolveRpcUrl/);
    expect(cli).not.toMatch(/if\s*\(\s*!process\.env\.HELIUS_API_KEY\s*\)/);
  });
});
