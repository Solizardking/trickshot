import { listSignatures } from "./addressHistory";
import { tradeFilter } from "./pool";

/**
 * How busy the book was, minute by minute, before anything is fetched.
 *
 * A token does not trade evenly and this one is the extreme case: MEASURED
 * across its 27 days, 7.5 swaps a second in the first hour falling to 0.08 a
 * second three weeks later — a hundredfold range. Any plan made without
 * knowing that is wrong at one end or the other. Reading a fixed number of
 * transactions per bucket wastes calls on the quiet weeks and captures a
 * rounding error of the launch.
 *
 * Signatures are the cheap way to ask. They cost TEN CREDITS FLAT however many
 * come back, so a probe that returns a thousand of them costs the same as one
 * that returns three, and each one carries a blockTime — a thousand signatures
 * spanning 134 seconds means 7.5 swaps a second, with no transaction fetched.
 *
 * MEASURED: forty probes across the whole life, run in parallel, 510ms.
 */

const PROBES = Number(process.env.HISTORY_DENSITY_PROBES ?? 40);

export interface Density {
  /** Probe points, ascending, with the local swap rate at each. */
  points: { t: number; rate: number }[];
  /** Swaps over the whole span, by integrating the rate. */
  total: number;
}

export async function densityMap(
  pool: string,
  mint: string,
  first: number,
  last: number,
  /**
   * Bins to spend. Scaled by the caller to the work being planned: mapping a
   * token's whole life is worth forty, and deciding how to draw the six bars a
   * cached chart is missing is not.
   */
  probes: number = PROBES,
): Promise<Density> {
  const span = Math.max(last - first, 1);
  const count = Math.max(1, Math.min(probes, PROBES));
  const step = span / count;
  const sigs = await listSignatures(pool, {
    ...tradeFilter(mint),
    blockTime: { gte: first, lt: last + 1 },
  });
  const bins = Array.from({ length: count }, (_, i) => ({
    t: Math.floor(first + i * step),
    n: 0,
  }));
  for (const sig of sigs) {
    const t = sig.blockTime ?? 0;
    const i = Math.min(count - 1, Math.max(0, Math.floor((t - first) / step)));
    const bin = bins[i];
    if (bin) bin.n += 1;
  }
  const points = bins.map((b) => ({ t: b.t, rate: b.n / step }));
  return { points, total: sigs.length };
}

/**
 * Swaps expected in a window, by integrating the probed rate across it.
 *
 * An estimate, and used only where an estimate is the right tool: deciding
 * whether a window is small enough to read exactly, and scaling a sampled
 * bucket's volume. Nothing on the chart is priced from it.
 */
export function expectedSwaps(d: Density, from: number, to: number): number {
  if (d.points.length === 0 || to <= from) return 0;
  let total = 0;
  for (let i = 0; i < d.points.length; i += 1) {
    const point = d.points[i];
    if (!point) continue;
    const start = point.t;
    const end = d.points[i + 1]?.t ?? Infinity;
    const overlap = Math.min(to, end) - Math.max(from, start);
    if (overlap > 0) total += point.rate * overlap;
  }
  return total;
}

/**
 * Exactly how many swaps a window holds, up to a ceiling.
 *
 * The density map is a probe grid and a token's activity swings by two orders
 * of magnitude across its life, so its estimate for any particular window can
 * be fifty-fold wrong. That is fine for planning and not fine for deciding
 * whether a window can be read whole: guessing low meant speculatively pulling
 * four thousand full transactions — some eighty megabytes — discovering the
 * window was bigger, and throwing all of it away.
 *
 * Signatures answer it properly. They cost ten credits flat per page whatever
 * they return, and a handful of pages settles any window worth reading whole.
 */
export async function countSwaps(
  pool: string,
  mint: string,
  from: number,
  to: number,
  ceiling: number,
): Promise<{ count: number; complete: boolean }> {
  const sigs = await listSignatures(pool, {
    ...tradeFilter(mint),
    blockTime: { gte: from, lt: to },
  });
  if (sigs.length > ceiling) return { count: ceiling, complete: false };
  return { count: sigs.length, complete: true };
}
