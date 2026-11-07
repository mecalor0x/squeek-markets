// Pure market logic: nights, ranges, prices and input checks. Nothing here touches the chain.
import { parseUnits } from "viem";
import { GENESIS_SECONDS, MM_PER_WORK, ROUND_SECONDS } from "./config";

export const Status = { None: 0, Open: 1, Resolved: 2, Void: 3 } as const;
export const NO = 0;
export const YES = 1;
export const ROUNDS_PER_NIGHT = 144;
export const MAX_NIGHTS_AHEAD = 7;
export const MAX_THRESHOLD = 100_000;
export const MIN_STAKE = 10n ** 18n;
export const MIN_CREATOR_BET = 10n * MIN_STAKE;
export const RESOLVE_TIMEOUT = 7 * 86400;
const DAY = 86400;
const NOON = 12 * 3600;
const FEE_BPS = 200n;
const BPS = 10_000n;

export const km = (laps: number | bigint) => (Number(laps) * MM_PER_WORK) / 1e6;
const kmText = (laps: number) => `${km(laps).toFixed(1)} km`;

/** The automatic market's five ranges, exactly as the contract's boundaries set them. */
export const RANGES = [
  { label: "Under 5,000 laps", short: "Under 5,000", approx: `under ≈${kmText(5000)}` },
  { label: "5,000–6,499 laps", short: "5,000–6,499", approx: `≈${kmText(5000)} to ${kmText(6500)}` },
  { label: "6,500–7,499 laps", short: "6,500–7,499", approx: `≈${kmText(6500)} to ${kmText(7500)}` },
  { label: "7,500–8,499 laps", short: "7,500–8,499", approx: `≈${kmText(7500)} to ${kmText(8500)}` },
  { label: "8,500 laps or more", short: "8,500+", approx: `≈${kmText(8500)} or more` },
];
const RANGE_EDGES = [5000, 6500, 7500, 8500];

/** Which range a lap count falls in. A value on a boundary is in the higher range, same as the contract. */
export function rangeOf(laps: number | bigint) {
  const index = RANGE_EDGES.findIndex((edge) => Number(laps) < edge);
  return index === -1 ? RANGES.length - 1 : index;
}

export const roundStart = (round: number) => GENESIS_SECONDS + (round - 1) * ROUND_SECONDS;
export const currentRound = (nowSeconds: number) => (nowSeconds < GENESIS_SECONDS ? 0 : Math.floor((nowSeconds - GENESIS_SECONDS) / ROUND_SECONDS) + 1);

/** The night still taking bets: today's until noon UTC, then tomorrow's. Same rule as the contract. */
export function currentNight(nowSeconds: number) {
  const today = Math.floor(nowSeconds / DAY);
  return nowSeconds < today * DAY + NOON ? today : today + 1;
}
export const closesAt = (night: number) => night * DAY + NOON;
export function roundsOf(night: number) {
  const startRound = Math.floor((closesAt(night) - GENESIS_SECONDS) / ROUND_SECONDS) + 1;
  return { startRound, endRound: startRound + ROUNDS_PER_NIGHT - 1 };
}
export const nightLabel = (night: number) => new Date(night * DAY * 1000).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
const clock = (date: Date, timeZone?: string) => date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone });
const dateText = (date: Date, timeZone?: string) => date.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone });
export const localClock = (seconds: number, timeZone?: string) => clock(new Date(seconds * 1000), timeZone);
/** A moment in UTC and in the reader's own time, with the local date only when it's a different day. */
export function bothTimes(seconds: number, timeZone?: string) {
  const date = new Date(seconds * 1000);
  const localDate = dateText(date, timeZone);
  const utcDate = dateText(date, "UTC");
  return `${utcDate}, ${clock(date, "UTC")} UTC (${localDate === utcDate ? "" : `${localDate}, `}${clock(date, timeZone)} your time)`;
}
/** The nights that have fully ended, oldest first. The night before the one taking bets is still running. */
export function finishedNights(nowSeconds: number, count = 7) {
  const running = currentNight(nowSeconds) - 1;
  return Array.from({ length: count }, (_, i) => running - count + i);
}
export const beforeLaunch = (night: number) => closesAt(night) < GENESIS_SECONDS;
export const nightToDate = (night: number) => new Date(night * DAY * 1000).toISOString().slice(0, 10);

type MarketShape = { isTemplate: boolean; night: number; threshold: number };

export function question(m: MarketShape) {
  return m.isTemplate
    ? `More than ${m.threshold.toLocaleString("en-US")} laps on the night of ${nightLabel(m.night)}?`
    : `How far will Squeektoshi run on the night of ${nightLabel(m.night)}?`;
}

export function outcomeLabel(m: { isTemplate: boolean }, outcome: number) {
  if (m.isTemplate) return outcome === YES ? "YES" : "NO";
  return RANGES[outcome].label;
}

const sum = (values: readonly bigint[]) => values.reduce((a, b) => a + b, 0n);
export const fundedOutcomes = (pools: readonly bigint[]) => pools.filter((pool) => pool > 0n).length;

/** An outcome's price is its share of the bets, in cents. Null while nobody has bet, rather than a made-up number. */
export function priceCents(pools: readonly bigint[], outcome: number) {
  const total = sum(pools);
  if (total === 0n) return null;
  return Number((pools[outcome] * 1000n) / total) / 10;
}

/** Laps per round from SqueekCore's cumulative records. Rounds it doesn't list had no running. */
export function roundLaps(start: number, records: readonly { round: number; cumulative: number }[]) {
  let previous = start;
  return records.map(({ round, cumulative }) => {
    const laps = cumulative - previous;
    previous = cumulative;
    return { round, laps };
  });
}

/** Laps in the running night. The wheel's live count is used when it's ahead of what's certified, and never lowers it. */
export const lapsSoFar = (start: number, certified: number, live?: number) => Math.max(certified, live ?? 0) - start;

/** What a stake would get back if this outcome wins and the pools stay as they are. Same sum as the contract's quote(). */
export function estimatePayout(pools: readonly bigint[], sponsored: bigint, outcome: number, stake: bigint) {
  const total = sum(pools) + sponsored + stake;
  return (stake * (total - (total * FEE_BPS) / BPS)) / (pools[outcome] + stake);
}

/** What each SQK staked here returns if this outcome wins and the pools stay as they are. Null when it can't be said yet. */
export function multiplier(pools: readonly bigint[], sponsored: bigint, outcome: number) {
  if (fundedOutcomes(pools) < 2 || pools[outcome] === 0n) return null;
  const total = sum(pools) + sponsored;
  return Number(((total - (total * FEE_BPS) / BPS) * 1000n) / pools[outcome]) / 1000;
}

/** Shown instead of an estimated payout while a market would still refund everyone. */
export const firstBetText = (isTemplate: boolean) => (isTemplate
  ? "Be the first! Needs bets on both YES and NO, otherwise everyone is refunded."
  : "Be the first! Needs bets on at least 2 ranges, otherwise everyone is refunded.");

export function shareLink(m: MarketShape & { id: bigint }, pageUrl: string) {
  const params = new URLSearchParams({ text: `${question(m)} Make your call on Squeek Markets (Sepolia testnet).`, url: `${pageUrl}#market-${m.id}` });
  return `https://x.com/intent/post?${params}`;
}

/** Biggest pool first. Equal pools keep their order, which is newest first. */
export function sortByPool<T extends { pools: readonly bigint[]; sponsored: bigint }>(markets: readonly T[]) {
  const size = (m: T) => sum(m.pools) + m.sponsored;
  return [...markets].sort((a, b) => { const x = size(a), y = size(b); return x === y ? 0 : x > y ? -1 : 1; });
}

export type Stage = "betting" | "live" | "waiting" | "resolvable" | "resolved" | "void";

/** The price to show. A market that can't pay anyone beyond their own stake has no meaningful price, so 100¢ never appears, and nor does 0¢ on an outcome nobody has bet on. */
export function displayPrice(pools: readonly bigint[], outcome: number, refunding = false) {
  return refunding || fundedOutcomes(pools) < 2 || pools[outcome] === 0n ? null : priceCents(pools, outcome);
}

/** Outcomes a player could be first on: nobody has bet there yet, but others have bet elsewhere. */
export function openOutcomes(pools: readonly bigint[]) {
  if (noBetsYet(pools)) return [];
  return pools.flatMap((pool, outcome) => (pool === 0n ? [outcome] : []));
}

/** The contract's quote() as a multiple of the stake. */
export const quoteMultiple = (quote: bigint, amount: bigint) => Number((quote * 1000n) / amount) / 1000;

export const noBetsYet = (pools: readonly bigint[]) => sum(pools) === 0n;

type RefundShape = { status: number; isTemplate: boolean; night: number; threshold: number; pools: readonly bigint[] };

/** Why settling this market will refund everyone, using the same checks as the contract's resolve(). Null if it won't, or can't be known yet. */
export function refundReason(m: RefundShape, settled: number, nowSeconds: number, laps?: number) {
  if (stage(m.status, m.night, m.pools, settled, nowSeconds) !== "resolvable" || m.status !== Status.Open) return null;
  const funded = fundedOutcomes(m.pools);
  if (funded === 0) return "no bets were placed";
  if (funded === 1) return m.isTemplate ? "only one side was bet" : "only one range was bet";
  if (settled < roundsOf(m.night).endRound) return "the night wasn’t certified in time";
  if (laps === undefined) return null;
  const winner = m.isTemplate ? (laps > m.threshold ? YES : NO) : rangeOf(laps);
  return m.pools[winner] === 0n ? "nobody picked the winner" : null;
}

/** Where a market is in its life, given the last round SqueekCore has certified. */
export function stage(status: number, night: number, pools: readonly bigint[], settled: number, nowSeconds: number): Stage {
  if (status === Status.Resolved) return "resolved";
  if (status === Status.Void) return "void";
  if (nowSeconds < closesAt(night)) return "betting";
  if (status === Status.None) return "void";
  const { endRound } = roundsOf(night);
  if (fundedOutcomes(pools) < 2 || settled >= endRound || nowSeconds > roundStart(endRound + 1) + RESOLVE_TIMEOUT) return "resolvable";
  return nowSeconds < roundStart(endRound + 1) ? "live" : "waiting";
}

export function countdown(seconds: number) {
  if (seconds <= 0) return "now";
  const d = Math.floor(seconds / DAY);
  const h = Math.floor((seconds % DAY) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m ${Math.floor(seconds % 60)}s`;
}

type Checked<T> = { value: T; error?: undefined } | { value?: undefined; error: string };

export function checkStake(text: string, balance?: bigint, minimum = MIN_STAKE): Checked<bigint> {
  const clean = text.trim();
  if (!clean) return { error: "Enter how much SQK to use." };
  if (!/^\d+(\.\d{1,18})?$/.test(clean)) return { error: "Use numbers only, like 25 or 2.5." };
  const value = parseUnits(clean, 18);
  if (value < minimum) return { error: `The minimum is ${minimum / MIN_STAKE} SQK.` };
  if (balance !== undefined && value > balance) return { error: "That's more SQK than you have." };
  return { value };
}

export function checkThreshold(text: string): Checked<number> {
  const clean = text.trim().replace(/,/g, "");
  if (!clean) return { error: "Enter a number of laps." };
  if (!/^\d+$/.test(clean)) return { error: "Laps must be a whole number, like 7000." };
  const value = Number(clean);
  if (value < 1) return { error: "Laps must be at least 1." };
  if (value > MAX_THRESHOLD) return { error: `Laps can't be more than ${MAX_THRESHOLD.toLocaleString("en-US")}.` };
  return { value };
}

export function checkNight(dateText: string, nowSeconds: number): Checked<number> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateText)) return { error: "Pick a date." };
  const parsed = Date.parse(`${dateText}T00:00:00Z`);
  if (Number.isNaN(parsed)) return { error: "Pick a date." };
  const night = parsed / (DAY * 1000);
  if (closesAt(night) <= nowSeconds) return { error: "Betting on that night has already closed. Pick a later date." };
  if (closesAt(night) > nowSeconds + MAX_NIGHTS_AHEAD * DAY) return { error: `You can only open markets up to ${MAX_NIGHTS_AHEAD} days ahead.` };
  return { value: night };
}
