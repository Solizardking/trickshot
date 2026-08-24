import { NextResponse } from "next/server";
import { walletTokens } from "@/server/holdings";

/**
 * The fungible tokens a wallet holds, straight off the chain.
 *
 * Read-only and uncached — a balance is only true the moment you read it.
 */
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const address = new URL(request.url).searchParams.get("address")?.trim();
  if (!address || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) {
    return NextResponse.json({ error: "a Solana address is required" }, { status: 400 });
  }
  try {
    return NextResponse.json(await walletTokens(address));
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
