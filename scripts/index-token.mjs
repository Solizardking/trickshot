/**
 * Index a token into the shared cache, from your own machine.
 *
 * Everything the hosted site serves is built here: the chart, the trader
 * board, and — for whichever wallets you name — their linked wallets. The
 * deployment reads and never builds, so a token that has not been through this
 * script is not on the site.
 *
 * Writes wherever the store is configured. With SUPABASE_URL and
 * SUPABASE_SERVICE_ROLE_KEY set, that is the shared cache the deployment
 * reads; without them it is .trickshot-cache/ next to the project, which is
 * only useful locally.
 *
 *   npm run index -- <mint> [<mint>…] [--wallets a,b,c] [--top N] [options]
 *
 *   --wallets a,b  work out linked wallets for these addresses
 *   --top N        …and for the top N and bottom N of the board
 *   --include a,b  pin these wallets onto the board, whatever nomination thinks
 *   --update       re-read the board even if one is already cached
 *   --retries N    attempts per step before giving up (default 3)
 *   --help         this text
 *
 * A failed step is retried with a pause between attempts, because RPC rate
 * limits are common on a long run and every one of them is transient. The
 * script exits non-zero when any step still failed; the summary at the end
 * says exactly what was built and what was not.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

// The app reads its configuration from the environment; load .env.local the
// way `next dev` would, so the script needs no separate setup.
for (const name of [".env.local", ".env"]) {
  const file = path.join(root, name);
  if (!fs.existsSync(file)) continue;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const entry = line.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!entry || line.trimStart().startsWith("#")) continue;
    if (!process.env[entry[1]]) {
      process.env[entry[1]] = entry[2].replace(/^["']|["']$/g, "");
    }
  }
}

const USAGE = [
  "usage: npm run index -- <mint> [<mint>…] [options]",
  "",
  "  --wallets a,b  linked wallets for these addresses",
  "  --include a,b  pin these wallets onto the board",
  "  --top N        also graph the top N and bottom N of the board",
  "  --update       re-read the board even if one is cached",
  "  --retries N    attempts per step before giving up (default 3)",
].join("\n");

/** Flags that take a value, so the parser knows what to consume next. */
const VALUE_FLAGS = new Set(["--wallets", "--include", "--top", "--retries"]);

const argv = process.argv.slice(2);
const mints = [];
const named = [];
const pinned = [];
let wantsUpdate = false;
let topN = 0;
let retries = 3;

function fail(message) {
  console.error(`index-token: ${message}`);
  console.error(USAGE);
  process.exit(1);
}

const csv = (value) => value.split(",").map((w) => w.trim()).filter(Boolean);

for (let i = 0; i < argv.length; i++) {
  const arg = argv[i];
  if (arg === "--help" || arg === "-h") {
    console.log(USAGE);
    process.exit(0);
  }
  if (!arg.startsWith("--")) {
    mints.push(arg);
    continue;
  }
  if (!VALUE_FLAGS.has(arg)) fail(`unknown flag ${arg}`);

  const value = argv[++i];
  if (value === undefined || value.startsWith("--")) fail(`${arg} needs a value`);

  if (arg === "--top") {
    const n = Number(value);
    if (!Number.isInteger(n) || n < 0) fail(`--top wants a whole number, got "${value}"`);
    topN = n;
  } else if (arg === "--retries") {
    const r = Number(value);
    if (!Number.isInteger(r) || r < 1) fail(`--retries wants a positive whole number`);
    retries = r;
  } else if (arg === "--wallets") {
    named.push(...csv(value));
  } else {
    pinned.push(...csv(value));
  }
}
if (argv.includes("--update")) wantsUpdate = true;

const uniqueMints = [...new Set(mints)];
if (uniqueMints.length === 0) {
  console.error(USAGE);
  process.exit(1);
}
if (mints.length !== uniqueMints.length) {
  console.log(`(${mints.length - uniqueMints.length} duplicate mint(s) skipped)`);
}

// Base58, 32–44 characters — the same shape the API insists on. Catches a
// pasted URL or a typo before it turns into minutes of reading an empty pool.
const isAddress = (value) => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value);
for (const bad of uniqueMints.filter((m) => !isAddress(m))) fail(`not a Solana address: ${bad}`);
for (const bad of [...new Set(named)].filter((w) => !isAddress(w))) fail(`--wallets: not a Solana address: ${bad}`);
for (const bad of [...new Set(pinned)].filter((w) => !isAddress(w))) fail(`--include: not a Solana address: ${bad}`);

const jiti = createJiti(import.meta.url);
try {
  const { resolveRpcUrl } = await jiti.import(path.join(root, "src/server/config.ts"));
  resolveRpcUrl();
} catch (error) {
  console.error(`index-token: ${error instanceof Error ? error.message : error}`);
  process.exit(1);
}

const engine = await jiti.import(path.join(root, "src/server/history.ts"));

const shared = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
console.log(
  shared
    ? "Writing to Supabase — the deployment will see this."
    : "Writing to .trickshot-cache/ — local only. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to publish.",
);

const failures = [];
const started = Date.now();

for (const mint of uniqueMints) {
  console.log(`\n${mint}`);

  let chart;
  try {
    chart = await step("chart", () => engine.reconstruct(mint));
  } catch (error) {
    failures.push(`${mint} chart: ${error.message}`);
    continue;
  }
  if (!chart) {
    console.log("  no pool found — nothing to index");
    continue;
  }
  console.log(
    `        ${chart.name ?? "?"} ${chart.symbol ?? ""} · ${chart.candles.length} bars · ${Math.round(chart.swaps ?? 0).toLocaleString()} swaps`,
  );

  let board = null;
  try {
    board = await step("board", () => engine.traderBoard(mint, wantsUpdate, pinned));
    if (board) console.log(`        ${board.wallets} wallets ranked`);
  } catch (error) {
    failures.push(`${mint} board: ${error.message}`);
  }

  // Anything pinned is worth a graph too — you named it for a reason.
  const wallets = new Set([...named, ...pinned]);
  if (topN > 0 && board) {
    for (const row of board.top.slice(0, topN)) wallets.add(row.wallet);
    for (const row of board.bottom.slice(0, topN)) wallets.add(row.wallet);
  }
  for (const wallet of wallets) {
    try {
      const report = await step(`links ${short(wallet)}`, () =>
        engine.relatedWallets(mint, wallet),
      );
      const linked = report && report !== "not computed" ? report.linked.length : 0;
      console.log(`        ${linked} linked`);
    } catch (error) {
      failures.push(`${mint} links ${wallet}: ${error.message}`);
    }
  }
}

console.log(`\nDone in ${Math.round((Date.now() - started) / 1000)}s across ${uniqueMints.length} token(s).`);
if (failures.length > 0) {
  console.log("\nFailed steps:");
  for (const f of failures) console.log(`  - ${f}`);
  process.exitCode = 1;
}

function short(address) {
  return `${address.slice(0, 8)}…`;
}

/**
 * One unit of work, timed, retried, and reported in place.
 *
 * The RPC answers 429 under sustained reads and the occasional connection dies
 * mid-flight; both clear on their own, so each attempt waits a little longer
 * than the last before the error is finally allowed to stand.
 */
async function step(label, run) {
  const at = Date.now();
  process.stdout.write(`  ${label.padEnd(20)}`);
  let lastError;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const result = await run();
      process.stdout.write(`${String(Date.now() - at).padStart(6)}ms\n`);
      return result;
    } catch (error) {
      lastError = error;
      if (attempt < retries) {
        process.stdout.write(" retrying… ");
        await new Promise((resolve) => setTimeout(resolve, attempt * 2_000));
      }
    }
  }

  process.stdout.write(`  failed after ${retries}: ${lastError?.message}\n`);
  throw lastError;
}
