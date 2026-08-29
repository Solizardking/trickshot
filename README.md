# Trickshot

Rebuild any Solana token from the chain and replay what a wallet did on it — as
a chart you can record and post.

Give it a mint. It reconstructs the price history as candles, ranks who made and
lost the most, and for any wallet plays its buys and sells back on the bars with
its PnL stepping alongside. Nothing is indexed ahead of time.

Live: **[trickshot-memes.vercel.app](https://trickshot-memes.vercel.app)**

## Run it

    cp .env.example .env.local     # add Solana Tracker RPC credentials
    npm install
    npm run dev

JSON-RPC needs a Solana Tracker endpoint — `SECURE_RPC_URL` (preferred dedicated
host), `SOLANA_TRACKER_RPC_URL`, or `SOLANA_TRACKER_API_KEY` /
`SOLANA_TRACKER_ACCESS_KEY`. Wallet names still come from Helius identity REST
when `HELIUS_API_KEY` is set; that call is not JSON-RPC. Everything else is
optional.

Paste a mint and press build. A busy token takes about ten seconds the first
time; results are cached in `.trickshot-cache/`, so it is quick after that.

There is a command-line path too, which is also how tokens get added to a
hosted copy:

    npm run index -- <mint>                    chart and trader board
    npm run index -- <mint> --top 5            …and linked wallets for the top 5
    npm run index -- <mint> --wallets <a>,<b>  …for specific wallets
    npm run index -- <mint> --include <a>      pin a wallet onto the board
    npm run index -- <mint> --update           re-read the board

Set `SUPABASE_URL` and `SUPABASE_KEY` and the cache moves to Supabase instead
of the local directory, which is what a deployment reads from. See
`.env.example` for the rest of the settings.

## How it talks to the chain

JSON-RPC goes to **Solana Tracker** on a `*.solanatracker.io` (or
`*.rpc.solanatracker.io`) host. Shared RPC authenticates with the `api_key`
query param. Dedicated Secure RPC authenticates by subdomain — do not put
`api_key` on those URLs. Prefer a dedicated Secure RPC URL when you have one.

**Address history** is built from standard JSON-RPC (`getSignaturesForAddress`
plus `getTransaction`). Two details still make the project possible at all:

- `filters.blockTime` reaches a window days old directly instead of paging back
  to it, so a month-old token costs a few hundred calls rather than millions.
- `filters.tokenTransfer.mint` returns only the transactions that actually
  traded the token. Ask a busy pool for a five-minute window and you get 11,085
  transactions; ask with this filter and you get the 310 that were swaps — every
  one of them, and nothing else.

Point it at the **pool**, not the mint. A mint's transactions are mostly bots
referencing it without trading; a pool's are trades. Everything else depends on
that.

**Standard RPC** — `getTokenLargestAccounts`, `getMultipleAccounts`,
`getTokenSupply` — finds the pools and the holders.

**DAS** (`getAsset`, `searchAssets`) gives token names, artwork, and wallet
holdings.

**Wallet Identity** is still Helius REST (`/v1/wallet/batch-identity`) when a
Helius key is set. It puts names to addresses where it knows them — exchanges,
protocols, a few thousand known traders — and is not JSON-RPC.

Prices come from **balances**, never from decoding instructions. A swap is two
balances moving in opposite directions inside one pool and the transaction
states both, so it works for venues no decoder knows — and a wallet's own token
delta cannot double-count a swap routed through three pools.

**SOL/USD by the minute** comes from Binance's public price mirror. A USD figure
needs the SOL price at the time of the trade.

## What it does not do

Worth knowing before trusting a number.

- **The chart is one book.** A token trades on many pools at slightly different
  prices, so candles come from the busiest. A wallet's PnL counts every venue,
  because that path reads the wallet rather than a pool.
- **Long spans are sampled.** Past a few thousand swaps a bar is priced from
  trades spread across it. The prices are real trades; the volume is an estimate.
  The page says which a chart is.
- **The trader board is a shortlist.** Every figure shown is exact — each wallet
  is read in full — but a wallet that was never nominated is absent.
- **Fills are priced at the bar's mark**, not the exact execution price. The
  payer is often not the holder, so there is no reliable SOL leg on the wallet.
- **Transferred tokens have no cost basis.** They count toward a position and not
  toward profit.
- **A linked wallet is inference**, from funding and timing. Not proof of common
  ownership, and nothing is combined unless you ask.

## Layout

    src/app/api/          history · board · tokens · related
    src/server/pool       which book to read, and its vaults
    src/server/candles    windows to bars, priced from balances
    src/server/positions  PnL, and the replay curve
    src/server/graph      a wallet's counterparties
    src/server/store      anything built, kept between requests
    src/components        the chart, the replay, the boards
    src/lib/record        the replay, recorded to MP4
    src/lib/sound         a till on a sell, a fanfare every $20K

The reasoning behind each decision — and the measurements that forced it — is in
the comments, next to the code it explains.
