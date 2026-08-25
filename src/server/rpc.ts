import { config } from "./config";

/**
 * Every RPC this app makes goes through one gate.
 *
 * MEASURED on a full board build: nomination alone fired six hundred requests
 * as one Promise.all — 480 of them from `bigTrades` — and the key answered
 * 418 of those with 429. Worse, everything fired AFTER the burst was still
 * being refused, so `walletSize` measured all 220 candidates at zero
 * transactions each, the board was ranked empty, and the empty board was
 * cached as if it were the answer. Nothing errored anywhere; the page just
 * said "no wallets with a known cost basis" for good.
 *
 * So the gate bounds how many requests are in flight and how fast new ones
 * start, and a 429 is retried with backoff rather than read as an empty page.
 * Both numbers are the key's plan rather than a constant, hence the env.
 */
const MAX_IN_FLIGHT = Number(process.env.HISTORY_RPC_CONCURRENCY ?? 10);
const MIN_SPACING_MS = Math.ceil(1_000 / Number(process.env.HISTORY_RPC_RPS ?? 20));
/** The throttle outlives the burst that caused it, so the waits grow steeply. */
const BACKOFF_MS = [500, 1_000, 2_000, 4_000, 8_000];

let inFlight = 0;
let lastStart = 0;
const waiters: (() => void)[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;

/**
 * Wake one waiter when the spacing window opens, if nobody else will.
 *
 * A waiter blocked on spacing rather than capacity would otherwise sleep past
 * the moment it could run: releases only happen when a request finishes, and
 * once the gate is empty nothing finishes any more.
 */
function scheduleWake(): void {
  if (timer || waiters.length === 0) return;
  timer = setTimeout(
    () => {
      timer = null;
      waiters.shift()?.();
    },
    Math.max(0, lastStart + MIN_SPACING_MS - Date.now()),
  );
}

async function slot(): Promise<void> {
  for (;;) {
    if (inFlight < MAX_IN_FLIGHT && Date.now() - lastStart >= MIN_SPACING_MS) {
      inFlight += 1;
      lastStart = Date.now();
      return;
    }
    await new Promise<void>((resolve) => {
      waiters.push(resolve);
      scheduleWake();
    });
  }
}

function release(): void {
  inFlight -= 1;
  waiters.shift()?.();
}

/**
 * One gated, retried POST, returning the whole JSON body.
 *
 * For callers that must read more than `result` — the DAS index has shipped
 * its payload at the top level under `assets` in one era and under `result` in
 * another, and betting the page on which one today's is loses either way.
 */
export async function rpcSend(
  body: Record<string, unknown>,
  timeoutMs = 20_000,
): Promise<Record<string, unknown> | null> {
  for (let attempt = 0; ; attempt += 1) {
    let res: Response;
    try {
      await slot();
      try {
        res = await fetch(config.rpcUrl, {
          method: "POST",
          headers: { "content-type": "application/json" },
          signal: AbortSignal.timeout(timeoutMs),
          body: JSON.stringify(body),
        });
      } finally {
        release();
      }
    } catch (error) {
      console.warn(
        `[trickshot] rpc ${String(body.method)} failed: ${error instanceof Error ? error.message : "network"}`,
      );
      return null;
    }

    /**
     * "Later", not "no". Read as a miss, a throttled probe measures every
     * candidate wallet at zero transactions — which is exactly the fabrication
     * `exactBoard` exists to prevent — so the request is worth waiting for.
     */
    if (res.status === 429 && attempt < BACKOFF_MS.length) {
      const after = Number(res.headers.get("retry-after"));
      const wait =
        Number.isFinite(after) && after > 0 ? after * 1_000 : BACKOFF_MS[attempt];
      await new Promise((resolve) => setTimeout(resolve, wait));
      continue;
    }

    if (!res.ok) {
      // A board build that fails quietly ranks empty and caches the emptiness,
      // which reads to the page as "no trades found for this mint". Loud here
      // costs nothing; silent cost a day of it.
      console.warn(`[trickshot] rpc ${String(body.method)} answered ${res.status}`);
      return null;
    }
    try {
      return (await res.json()) as Record<string, unknown>;
    } catch {
      console.warn(`[trickshot] rpc ${String(body.method)} returned unparseable json`);
      return null;
    }
  }
}

/**
 * One JSON-RPC POST, gated and retried. Returns `result`, or null — the same
 * shape every caller here already handled, so adopting the gate changes
 * nothing about how a miss reads downstream.
 */
export async function rpcPost<T>(
  body: Record<string, unknown>,
  timeoutMs = 20_000,
): Promise<T | null> {
  const json = await rpcSend(body, timeoutMs);
  return (json?.result as T) ?? null;
}
