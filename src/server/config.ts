/**
 * Everything this app needs from the environment.
 *
 * JSON-RPC reads Solana Tracker (`api_key` on a `*.solanatracker.io` host).
 * Wallet-identity REST still uses a Helius key when present — that call is
 * not JSON-RPC. Values are read lazily so importing this from a route that
 * never calls it cannot break the build.
 */
function env(name: string): string {
  return (process.env[name] ?? "").trim();
}

function required(name: string): string {
  const value = env(name);
  if (!value) throw new Error(`Missing required env var ${name}`);
  return value;
}

function trackerRpcKey(): string {
  return (
    env("SOLANA_TRACKER_ACCESS_KEY") ||
    env("SOLANA_TRACKER_API_KEY") ||
    env("SOLANATRACKER_API_KEY") ||
    env("TRACKER_API_KEY")
  );
}

function isTrackerRpcUrl(raw: string): boolean {
  try {
    const host = new URL(raw).hostname.toLowerCase();
    return host === "solanatracker.io" || host.endsWith(".solanatracker.io");
  } catch {
    return false;
  }
}

function isSecureTrackerHost(host: string): boolean {
  return /\.secure\.rpc\.solanatracker\.io$/i.test(host);
}

/**
 * Shared Tracker RPC authenticates with `api_key`. Dedicated Secure RPC
 * hosts reject that query param (HTTP 400) and authenticate by subdomain,
 * so never attach `api_key` there. Never leave Helius `api-key` on either.
 */
function withTrackerAuth(raw: string, key: string): string {
  const url = new URL(raw);
  if (isSecureTrackerHost(url.hostname)) {
    url.searchParams.delete("api-key");
    url.searchParams.delete("api_key");
    return url.toString();
  }
  const existing =
    url.searchParams.get("api_key") || url.searchParams.get("api-key") || key;
  url.searchParams.delete("api-key");
  if (existing) url.searchParams.set("api_key", existing);
  return url.toString();
}

/**
 * The JSON-RPC endpoint this app posts to.
 *
 * Prefer a dedicated `*.secure.rpc.solanatracker.io` host (`SECURE_RPC_URL`),
 * then an explicit `SOLANA_TRACKER_RPC_URL`, then the shared Tracker host
 * built from a Tracker API key. Tracker credentials are enough; a Helius
 * key is not required. Helius is only a fallback when no Tracker env is set.
 */
export function resolveRpcUrl(): string {
  const key = trackerRpcKey();
  const dedicated = env("SECURE_RPC_URL");
  const explicit = env("SOLANA_TRACKER_RPC_URL");

  if (dedicated && isTrackerRpcUrl(dedicated)) {
    return withTrackerAuth(dedicated, key);
  }
  if (explicit && isTrackerRpcUrl(explicit)) {
    return withTrackerAuth(explicit, key);
  }
  if (key) {
    return withTrackerAuth("https://rpc-mainnet.solanatracker.io/", key);
  }

  const heliusUrl = env("HELIUS_RPC_URL");
  const heliusKey = env("HELIUS_API_KEY");
  if (heliusUrl || heliusKey) {
    const url = new URL(heliusUrl || "https://mainnet.helius-rpc.com");
    if (heliusKey && !url.searchParams.has("api-key")) {
      url.searchParams.set("api-key", heliusKey);
    }
    return url.toString();
  }

  throw new Error(
    "Missing Solana Tracker RPC credentials. Set SOLANA_TRACKER_RPC_URL, SECURE_RPC_URL, or SOLANA_TRACKER_API_KEY / SOLANA_TRACKER_ACCESS_KEY.",
  );
}

/**
 * Whether this instance refuses to build anything it has not already got.
 *
 * A hosted copy serves a curated set: the owner indexes from their own machine
 * and the site reads the result. There is no administrator login to go with
 * this, and deliberately so — the hosted copy is handed a Supabase key that
 * cannot write, so it could not persist a build even if it made one. A login
 * would be a second lock on a door that does not open.
 */
export function readOnly(): boolean {
  return process.env.TRICKSHOT_READONLY === "1";
}

export const config = {
  /** The raw Helius key, for the wallet-identity REST endpoint only. */
  get apiKey(): string {
    return required("HELIUS_API_KEY");
  },
  get rpcUrl(): string {
    return resolveRpcUrl();
  },
  commitment: (process.env.COMMITMENT ?? "confirmed") as
    | "processed"
    | "confirmed"
    | "finalized",
};
