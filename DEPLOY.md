# Trickshot on musebook.trade — deploy notes

App: Next.js 16, served at **musebook.trade/trickshot** via the
musebook-proxy worker reverse proxy (`/trickshot/*` zone route already live).

## What is done

- Source staged here from the upload, fixed for the flattened layout:
  `src/server/rpc.ts` is the current RPC gate (was `rpc-2.ts`),
  `src/server/decode/normalizeTx.ts` restored, `public/sfx/kaching.mp3`
  placed where `src/lib/sound.ts` expects it, `vitest` added so
  `npm test` runs.
- `basePath: "/trickshot"` in `next.config.ts`; client API calls in
  `src/lib/replay.ts` use `/trickshot/api/*`.
- Musebook header added in `src/app/layout.tsx`. The replay chart palette
  is intentionally untouched (recordings must look identical anywhere).
- Worker: `handleTrickshotProxy` in `musebook/cloudflare/worker.js`
  (deployed 2026-09-20), zone route `musebook.trade/trickshot/*` ->
  `musebook-proxy` added. API paths rate-limited to 20 req/min per IP;
  page and assets unthrottled. Without `TRICKSHOT_UPSTREAM` the route 503s.

## To finish (needs the Vercel account owner)

1. Deploy this directory to Vercel (the account that hosts
   trickshot-memes.vercel.app). Framework preset: Next.js. No build
   config changes needed.
2. Vercel env vars (Production):
   - `HELIUS_API_KEY` — the Helius key ("our rpc"). Required: the engine
     falls back to Helius JSON-RPC without Tracker env, and wallet
     identity REST (`/v1/wallet/batch-identity`) requires it.
   - `SUPABASE_URL` + `SUPABASE_KEY` — recommended. Without a shared
     cache every cold serverless instance rebuilds each token from chain
     (~10s and repeated RPC spend). SQL:
     ```sql
     create table trickshot_cache (
       id text primary key,
       payload jsonb not null,
       updated_at timestamptz not null default now()
     );
     ```
   - Leave `TRICKSHOT_READONLY` unset — the point is on-demand builds
     ("nothing is indexed ahead of time").
   - Optional tuning: `HISTORY_RPC_CONCURRENCY` (default 10),
     `HISTORY_RPC_RPS` (default 20), `HISTORY_SIG_CAP` (default 100000).
3. Give the Vercel deployment URL to Clawd; it sets the worker's
   `TRICKSHOT_UPSTREAM` plain-text binding (one settings PATCH, no
   redeploy of the app) and verifies `musebook.trade/trickshot/` end to end.

## Validation already done (2026-09-20)

- `npm install` (415 pkgs), `npm run typecheck` clean, `npm test` 9/9,
  `npm run build` green.
- Local prod server: `/trickshot/` 200 with "Trickshot · Musebook" title +
  header, `/trickshot/api/tokens` 200 `{"tokens":[]}`,
  `/trickshot/api/wallet?address=nope` 400 validation JSON.
- Live worker: `/trickshot/` and `/trickshot/api/tokens` 503 (unconfigured,
  as designed); `/api/telemetry/stats` still 200.
