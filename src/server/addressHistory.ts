/**
 * Address history on standard JSON-RPC.
 *
 * Tracker (and most Solana nodes) do not implement Helius
 * `getTransactionsForAddress`. Signatures come from `getSignaturesForAddress`
 * (newest first) and full transactions from `getTransaction`. A per-address
 * log is filled on demand so later time windows reuse pages already fetched.
 */
import { isProgramDerived } from "./address";
import { rpcPost } from "./rpc";

export interface HistoryFilters {
  blockTime?: { gte?: number; lt?: number; lte?: number; gt?: number };
  tokenTransfer?: {
    mint?: string;
    with?: string;
    direction?: "in" | "out" | "any";
    amount?: { gt?: number; gte?: number; lt?: number; lte?: number };
  };
  status?: "succeeded" | "failed" | "any";
}

export interface AddressHistoryOpts {
  address: string;
  transactionDetails?: "full" | "signatures";
  sortOrder?: "asc" | "desc";
  limit?: number;
  filters?: HistoryFilters;
  paginationToken?: string;
}

export interface SignatureInfo {
  signature: string;
  slot?: number;
  err?: unknown;
  blockTime?: number | null;
}

interface Log {
  items: SignatureInfo[];
  complete: boolean;
  loading?: Promise<void>;
}

const SIG_PAGE = 1_000;
const SIG_CAP = Number(process.env.HISTORY_SIG_CAP ?? 100_000);
const logs = new Map<string, Log>();
const tokenAccountsCache = new Map<string, string[]>();

export function resetAddressLogsForTests(): void {
  logs.clear();
  tokenAccountsCache.clear();
}

async function tokenAccountPubkeys(owner: string, mint: string): Promise<string[]> {
  const key = `${owner}:${mint}`;
  const hit = tokenAccountsCache.get(key);
  if (hit) return hit;
  const res = await rpcPost<{ value?: { pubkey: string }[] }>(
    {
      jsonrpc: "2.0",
      id: "history",
      method: "getTokenAccountsByOwner",
      params: [owner, { mint }, { encoding: "jsonParsed" }],
    },
    20_000,
  );
  const found = (res?.value ?? []).map((a) => a.pubkey).filter(Boolean);
  tokenAccountsCache.set(key, found);
  return found;
}

async function signaturePage(address: string, before?: string): Promise<SignatureInfo[] | null> {
  const config: Record<string, unknown> = { limit: SIG_PAGE };
  if (before) config.before = before;
  return rpcPost<SignatureInfo[]>(
    {
      jsonrpc: "2.0",
      id: "history",
      method: "getSignaturesForAddress",
      params: [address, config],
    },
    25_000,
  );
}

async function ensureLog(address: string, untilTime?: number): Promise<Log> {
  let log = logs.get(address);
  if (!log) {
    log = { items: [], complete: false };
    logs.set(address, log);
  }
  for (;;) {
    if (log.complete || log.items.length >= SIG_CAP) return log;
    if (untilTime != null && log.items.length > 0) {
      const oldest = log.items[log.items.length - 1];
      if ((oldest?.blockTime ?? 0) > 0 && (oldest?.blockTime ?? 0) <= untilTime) {
        return log;
      }
    }
    if (log.loading) {
      await log.loading;
      continue;
    }
    const held = log;
    held.loading = (async () => {
      const before = held.items[held.items.length - 1]?.signature;
      const page = await signaturePage(address, before);
      if (!page || page.length === 0) {
        held.complete = true;
        return;
      }
      held.items.push(...page);
      if (page.length < SIG_PAGE) held.complete = true;
    })();
    try {
      await held.loading;
    } finally {
      held.loading = undefined;
    }
  }
}

/**
 * All loaded signatures for an address in a time window.
 *
 * Fills the per-address log until it covers `filters.blockTime.gte` (or the
 * cap), then filters in memory. Density and exact-window counts use this
 * instead of extrapolating a recent burst across the token's whole life.
 */
export async function listSignatures(
  address: string,
  filters?: HistoryFilters,
): Promise<SignatureInfo[]> {
  const until = filters?.blockTime?.gte ?? filters?.blockTime?.gt;
  const log = await ensureLog(address, until);
  return log.items.filter((sig) => {
    if (!inTime(sig.blockTime, filters?.blockTime)) return false;
    if (filters?.status === "succeeded" && sig.err) return false;
    if (filters?.status === "failed" && !sig.err) return false;
    return true;
  });
}

function inTime(bt: number | null | undefined, spec?: HistoryFilters["blockTime"]): boolean {
  if (!spec) return true;
  const t = bt ?? 0;
  if (spec.gte != null && t < spec.gte) return false;
  if (spec.gt != null && t <= spec.gt) return false;
  if (spec.lt != null && t >= spec.lt) return false;
  if (spec.lte != null && t > spec.lte) return false;
  return true;
}

function mintDelta(
  tx: {
    meta?: {
      preTokenBalances?: {
        mint?: string;
        accountIndex?: number;
        uiTokenAmount?: { amount?: string };
      }[];
      postTokenBalances?: {
        mint?: string;
        accountIndex?: number;
        uiTokenAmount?: { amount?: string };
      }[];
    };
  },
  mint: string,
): number {
  let max = 0;
  const pre = tx.meta?.preTokenBalances ?? [];
  const post = tx.meta?.postTokenBalances ?? [];
  for (const after of post) {
    if (after.mint !== mint) continue;
    const before = pre.find((p) => p.accountIndex === after.accountIndex);
    const delta = Math.abs(
      Number(after.uiTokenAmount?.amount ?? 0) -
        Number(before?.uiTokenAmount?.amount ?? 0),
    );
    if (delta > max) max = delta;
  }
  return max;
}

function txTouchesMint(
  tx: {
    meta?: {
      preTokenBalances?: { mint?: string }[];
      postTokenBalances?: { mint?: string }[];
    };
  },
  mint: string,
): boolean {
  const rows = [
    ...(tx.meta?.preTokenBalances ?? []),
    ...(tx.meta?.postTokenBalances ?? []),
  ];
  return rows.some((r) => r.mint === mint);
}

function keysOf(list: unknown): string[] {
  if (!Array.isArray(list)) return [];
  return list.map((item) => {
    if (typeof item === "string") return item;
    if (item && typeof item === "object" && "pubkey" in item) {
      return String((item as { pubkey: string }).pubkey);
    }
    return "";
  }).filter(Boolean);
}

function normalizeTx(tx: Record<string, unknown>): Record<string, unknown> {
  const meta = (tx.meta ?? {}) as Record<string, unknown>;
  const loaded = (meta.loadedAddresses ?? {}) as {
    writable?: unknown;
    readonly?: unknown;
  };
  return {
    ...tx,
    meta: {
      ...meta,
      loadedAddresses: {
        writable: keysOf(loaded.writable),
        readonly: keysOf(loaded.readonly),
      },
    },
  };
}

export async function transactionsBySignature(
  signatures: string[],
): Promise<Record<string, unknown>[]> {
  const txs = await fetchTransactions(signatures);
  const out: Record<string, unknown>[] = [];
  for (const tx of txs) {
    if (tx?.meta) out.push(normalizeTx(tx));
  }
  return out;
}

async function fetchTransactions(sigs: string[]): Promise<(Record<string, unknown> | null)[]> {
  return Promise.all(
    sigs.map((signature) =>
      rpcPost<Record<string, unknown>>(
        {
          jsonrpc: "2.0",
          id: "history",
          method: "getTransaction",
          params: [
            signature,
            {
              encoding: "jsonParsed",
              maxSupportedTransactionVersion: 0,
            },
          ],
        },
        25_000,
      ),
    ),
  );
}

/**
 * One page of address history in the shape Helius `getTransactionsForAddress`
 * used: `{ data, paginationToken }`.
 */
export async function addressTransactions(
  opts: AddressHistoryOpts,
): Promise<{ data: unknown[]; paginationToken?: string } | null> {
  const limit = Math.max(1, opts.limit ?? SIG_PAGE);
  const sortOrder = opts.sortOrder ?? "desc";
  const details = opts.transactionDetails ?? "full";
  const filters = opts.filters;
  const mint = filters?.tokenTransfer?.mint;
  const until =
    filters?.blockTime?.gte ??
    filters?.blockTime?.gt ??
    (sortOrder === "asc" && limit <= 2 && !opts.paginationToken ? 1 : undefined);

  let sources = [opts.address];
  // Wallets: ATA signatures are the mint's history. Pools are PDAs — keep
  // reading the pool account; their vaults are often under-indexed.
  if (mint && !isProgramDerived(opts.address)) {
    const atas = await tokenAccountPubkeys(opts.address, mint);
    if (atas.length > 0) sources = atas.slice(0, 4);
  }

  const merged: SignatureInfo[] = [];
  const seen = new Set<string>();
  for (const source of sources) {
    const log = await ensureLog(source, until);
    for (const item of log.items) {
      if (seen.has(item.signature)) continue;
      seen.add(item.signature);
      merged.push(item);
    }
  }
  merged.sort((a, b) => (b.blockTime ?? 0) - (a.blockTime ?? 0) || (b.slot ?? 0) - (a.slot ?? 0));

  const matching = merged.filter((sig) => {
    if (!inTime(sig.blockTime, filters?.blockTime)) return false;
    if (filters?.status === "succeeded" && sig.err) return false;
    if (filters?.status === "failed" && !sig.err) return false;
    return true;
  });
  const orderedLog = sortOrder === "asc" ? [...matching].reverse() : matching;

  let start = 0;
  if (opts.paginationToken) {
    const at = orderedLog.findIndex((s) => s.signature === opts.paginationToken);
    start = at >= 0 ? at + 1 : 0;
  }
  const ordered = orderedLog.slice(start, start + limit);
  const paginationToken =
    start + ordered.length < orderedLog.length
      ? ordered[ordered.length - 1]?.signature
      : undefined;

  if (details === "signatures") {
    const amount = filters?.tokenTransfer?.amount;
    if (!mint || !amount) {
      return { data: ordered, paginationToken };
    }
  }

  const txs = await fetchTransactions(ordered.map((s) => s.signature));
  const data: unknown[] = [];
  for (let i = 0; i < ordered.length; i += 1) {
    const tx = txs[i];
    const sig = ordered[i];
    if (!tx || !sig) continue;
    if (!tx.meta) continue;
    if (mint && !txTouchesMint(tx, mint)) continue;
    if (mint && filters?.tokenTransfer?.amount) {
      const delta = mintDelta(tx, mint);
      const spec = filters.tokenTransfer.amount;
      if (spec.gte != null && delta < spec.gte) continue;
      if (spec.gt != null && delta <= spec.gt) continue;
      if (spec.lte != null && delta > spec.lte) continue;
      if (spec.lt != null && delta >= spec.lt) continue;
    }
    if (details === "signatures") {
      data.push(sig);
    } else {
      data.push(normalizeTx(tx));
    }
  }
  return { data, paginationToken };
}
