"use client";

import { useState } from "react";
import {
  fetchWalletTokens,
  type WalletHolding,
  type WalletTokens,
} from "@/lib/replay";
import { Label, Panel, TokenMark } from "./ui";

/**
 * A wallet's holdings, as a grid you can click straight into.
 *
 * The mint box asks for an address nobody remembers; a bag is how people
 * actually think about their exposure. Paste any address — your own first —
 * and every fungible position it holds becomes one card, each of which opens
 * that token's replay like a gallery tile would. Balances come off the chain
 * at request time, so what is shown is held, not held once upon a time.
 */
export function WalletHoldings({ onOpen }: { onOpen: (mint: string) => void }) {
  const [wallet, setWallet] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<WalletTokens | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  async function look() {
    const address = wallet.trim();
    if (!address || loading) return;
    setLoading(true);
    setFailed(null);
    try {
      const found = await fetchWalletTokens(address);
      if (!found || found.error) {
        setFailed(found?.error ?? "could not read this wallet");
        setResult(found && found.tokens.length > 0 ? found : null);
      } else {
        setResult(found);
      }
    } finally {
      setLoading(false);
    }
  }

  const tokens = result?.tokens ?? [];

  return (
    <Panel className="mt-4 p-4 sm:p-5">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void look();
        }}
        className="flex flex-col gap-4 sm:flex-row sm:items-end"
      >
        <label className="flex min-w-0 flex-[3] flex-col gap-1.5">
          <span className="flex items-baseline gap-2 font-mono text-[9.5px] tracking-[0.14em] text-tx3 uppercase">
            Wallet holdings
            <span className="tracking-normal normal-case">
              what does this address hold?
            </span>
          </span>
          <input
            value={wallet}
            onChange={(e) => setWallet(e.target.value)}
            placeholder="paste a wallet to see its tokens"
            spellCheck={false}
            autoComplete="off"
            className="min-w-0 rounded-xs border border-line-strong bg-ink-900 px-3 py-2.5 font-mono text-[12px] text-tx placeholder:text-tx3 focus:border-amber/50 focus:outline-none"
          />
        </label>
        <button
          type="submit"
          disabled={loading || !wallet.trim()}
          className="shrink-0 cursor-pointer rounded-xs border border-line-strong px-5 py-2.5 font-mono text-[10px] tracking-[0.12em] text-tx2 uppercase hover:text-tx disabled:cursor-default disabled:opacity-40"
        >
          {loading ? "reading…" : "read wallet"}
        </button>
      </form>

      {failed && (
        <p className="mt-4 border-t border-line pt-3 font-mono text-[11px] text-signal">
          {failed}
        </p>
      )}

      {!failed && result && tokens.length === 0 && (
        <p className="mt-4 border-t border-line pt-3 font-mono text-[11px] text-tx3">
          No fungible tokens in this wallet.
        </p>
      )}

      {tokens.length > 0 && (
        <section className="mt-4 border-t border-line pt-4">
          <div className="mb-3 flex items-baseline justify-between">
            <Label>Holding</Label>
            <span className="tnum font-mono text-[10.5px] text-tx3">
              {tokens.length} token{tokens.length === 1 ? "" : "s"} · pick one to
              replay
            </span>
          </div>
          <div className="grid max-h-[380px] gap-3 overflow-y-auto sm:grid-cols-2 lg:grid-cols-3">
            {tokens.map((t) => (
              <HoldingCard key={t.mint} holding={t} onOpen={onOpen} />
            ))}
          </div>
        </section>
      )}
    </Panel>
  );
}

/**
 * One position. The balance is the number a holder scans for, so it leads;
 * the name and the art only identify which position it belongs to.
 */
function HoldingCard({
  holding,
  onOpen,
}: {
  holding: WalletHolding;
  onOpen: (mint: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onOpen(holding.mint)}
      title={`Replay ${holding.name ?? holding.symbol ?? holding.mint}`}
      className="group flex cursor-pointer items-center gap-3 rounded-md border border-line bg-ink-800 p-3 text-left transition-colors hover:border-line-strong hover:bg-ink-700 focus-visible:border-amber/50 focus-visible:outline-none"
    >
      <TokenMark image={holding.image} symbol={holding.symbol ?? holding.name} />
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="truncate font-display text-[15px] font-semibold text-tx">
          {holding.symbol ?? holding.name ?? "Unnamed"}
        </span>
        <span className="tnum truncate font-mono text-[13px] font-bold text-mint">
          {amount(holding.amount)}
        </span>
      </span>
    </button>
  );
}

/**
 * A balance the way a holder reads it: compact above a billion, separators and
 * no decimals through the thousands, two decimals through single digits, then
 * whatever precision dust needs to not round into nothing.
 */
function amount(v: number): string {
  if (!Number.isFinite(v)) return "0";
  if (v >= 1_000_000_000) return `${(v / 1_000_000_000).toFixed(2)}B`;
  if (v >= 1_000) return v.toLocaleString("en-US", { maximumFractionDigits: 0 });
  if (v >= 1) return v.toLocaleString("en-US", { maximumFractionDigits: 2 });
  return v.toLocaleString("en-US", { maximumFractionDigits: 6 });
}
