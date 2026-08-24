/**
 * What a wallet actually holds, read straight off the chain.
 *
 * The boards answer "how did a wallet do on ONE token"; this answers "what is
 * this wallet even in", which is where every session should be able to start —
 * paste your own address and pick from what comes back rather than hunting
 * for mint addresses at all.
 *
 * Served through the same Helius endpoint the rest of the app reads, using
 * DAS `searchAssets` filtered to fungible tokens: NFTs are positions too, but
 * they have no pool to rebuild a chart from, so listing them here would only
 * invite clicks that go nowhere.
 */
import { config } from "@/server/config";

/** One fungible position, already converted out of its raw units. */
export interface WalletHolding {
  mint: string;
  name?: string;
  symbol?: string;
  image?: string;
  /** Whole tokens, not lamport-scale raw units. */
  amount: number;
  decimals: number;
}

export interface WalletTokens {
  wallet: string;
  tokens: WalletHolding[];
  error?: string;
}

/** A page of results is this big; walk pages until one comes back short. */
const PAGE_LIMIT = 500;
/** Ten pages is five thousand positions — far past any wallet worth charting. */
const MAX_PAGES = 10;

export async function walletTokens(address: string): Promise<WalletTokens> {
  const holdings = new Map<string, WalletHolding>();

  try {
    for (let page = 1; page <= MAX_PAGES; page++) {
      const res = await fetch(config.rpcUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: AbortSignal.timeout(20_000),
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: "wallet",
          method: "searchAssets",
          params: {
            ownerAddress: address,
            tokenType: "fungible",
            displayOptions: { showCollectionMetadata: false },
            sortBy: { sortBy: "recent_action", sortDirection: "desc" },
            page,
            limit: PAGE_LIMIT,
          },
        }),
      });
      if (!res.ok) throw new Error(`Helius answered ${res.status}`);

      /**
       * The DAS index has shipped this payload at the top level, under
       * `assets`, and under `result` depending on the era; accept all three
       * rather than bet the page on which one today's is.
       */
      const body = (await res.json()) as {
        result?: AssetsPage;
        assets?: AssetsPage;
      };
      const found = body.result ?? body.assets ?? {};
      for (const asset of found.items ?? []) {
        const info = asset.token_info;
        const raw = Number(info?.balance ?? info?.supply ?? 0);
        const decimals = Number(info?.decimals ?? 0);
        if (!(raw > 0)) continue;
        holdings.set(asset.id, {
          mint: asset.id,
          name: asset.content?.metadata?.name || undefined,
          symbol: asset.content?.metadata?.symbol || undefined,
          image: asset.content?.links?.image ?? asset.content?.files?.[0]?.cdn_uri ?? asset.content?.files?.[0]?.uri,
          amount: raw / 10 ** decimals,
          decimals,
        });
      }

      if ((found.items?.length ?? 0) < PAGE_LIMIT) break;
    }
  } catch (error) {
    return { wallet: address, tokens: [...holdings.values()], error: (error as Error).message };
  }

  return {
    wallet: address,
    tokens: [...holdings.values()].sort((a, b) => b.amount - a.amount),
  };
}

interface AssetsPage {
  total?: number;
  page?: number;
  items?: Array<{
    id: string;
    content?: {
      metadata?: { name?: string; symbol?: string };
      links?: { image?: string };
      files?: Array<{ uri?: string; cdn_uri?: string }>;
    };
    token_info?: { balance?: number; supply?: number; decimals?: number };
  }>;
}
