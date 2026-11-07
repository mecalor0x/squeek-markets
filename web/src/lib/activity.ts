// Turns the contract's raw events into what the site shows. Nothing here touches the chain.
import type { Address, Hash } from "viem";
import { formatUnits } from "viem";
import { RANGES, nightLabel } from "./markets";

export type ChainLog = { eventName: string; args: Record<string, unknown>; blockNumber: bigint; logIndex: number; transactionHash: Hash };
export type ActivityKind = "BET" | "SPONSOR" | "RESOLVED" | "CLAIMED" | "MARKET CREATED";
export type ActivityRow = { key: string; kind: ActivityKind; address: Address | null; detail: string; block: bigint; logIndex: number; tx: Hash };
export type Standing = { address: Address; profit: bigint; volume: bigint; wins: number };

export const ACTIVITY_PAGE = 10;
const sqkText = (value: bigint) => `${Number(formatUnits(value, 18)).toLocaleString("en-US", { maximumFractionDigits: 2 })} SQK`;
export const shortAddress = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

type Template = { night: number; threshold: number };

/** Player markets announce themselves in MarketCreated. Any other market id is simply its night. */
function describer(logs: readonly ChainLog[]) {
  const templates = new Map<bigint, Template>();
  for (const log of logs) {
    if (log.eventName === "MarketCreated") templates.set(log.args.marketId as bigint, { night: Number(log.args.night), threshold: Number(log.args.threshold) });
  }
  const template = (id: bigint) => templates.get(id);
  const market = (id: bigint) => {
    const t = template(id);
    return t ? `more than ${t.threshold.toLocaleString("en-US")} laps, ${nightLabel(t.night)}` : `night of ${nightLabel(Number(id))}`;
  };
  const outcome = (id: bigint, value: number) => (template(id) ? (value === 1 ? "YES" : "NO") : RANGES[value]?.label ?? `outcome ${value}`);
  return { market, outcome };
}

/** The five kinds of event the activity table shows, newest first. */
export function toActivity(logs: readonly ChainLog[]): ActivityRow[] {
  const { market, outcome } = describer(logs);
  const rows: ActivityRow[] = [];
  for (const log of logs) {
    const id = log.args.marketId as bigint;
    const base = { key: `${log.transactionHash}-${log.logIndex}`, block: log.blockNumber, logIndex: log.logIndex, tx: log.transactionHash };
    const a = log.args;
    if (log.eventName === "BetPlaced") rows.push({ ...base, kind: "BET", address: a.player as Address, detail: `${sqkText(a.amount as bigint)} on ${outcome(id, Number(a.outcome))} · ${market(id)}` });
    if (log.eventName === "Sponsored") rows.push({ ...base, kind: "SPONSOR", address: a.sponsor as Address, detail: `${sqkText(a.amount as bigint)} added · ${market(id)}` });
    if (log.eventName === "MarketResolved") rows.push({ ...base, kind: "RESOLVED", address: null, detail: `${outcome(id, Number(a.winner))} won with ${Number(a.laps).toLocaleString("en-US")} laps · ${market(id)}` });
    if (log.eventName === "Claimed") rows.push({ ...base, kind: "CLAIMED", address: a.player as Address, detail: `${sqkText(a.amount as bigint)} · ${market(id)}` });
    if (log.eventName === "MarketCreated") rows.push({ ...base, kind: "MARKET CREATED", address: a.creator as Address, detail: market(id) });
  }
  return rows.sort((x, y) => (x.block === y.block ? y.logIndex - x.logIndex : x.block > y.block ? -1 : 1));
}

export function pageOf<T>(rows: readonly T[], page: number, size = ACTIVITY_PAGE) {
  const pages = Math.max(1, Math.ceil(rows.length / size));
  const current = Math.min(Math.max(1, page), pages);
  return { rows: rows.slice((current - 1) * size, current * size), page: current, pages };
}

/** Net SQK per address, best first. Open bets count against a player until they settle. */
export function standings(logs: readonly ChainLog[], limit = 25): Standing[] {
  const totals = new Map<Address, Standing>();
  const row = (address: Address) => {
    if (!totals.has(address)) totals.set(address, { address, profit: 0n, volume: 0n, wins: 0 });
    return totals.get(address) as Standing;
  };
  for (const log of logs) {
    if (log.eventName === "BetPlaced") { const r = row(log.args.player as Address); r.profit -= log.args.amount as bigint; r.volume += log.args.amount as bigint; }
    if (log.eventName === "Sponsored") row(log.args.sponsor as Address).profit -= log.args.amount as bigint;
    if (log.eventName === "Claimed") { const r = row(log.args.player as Address); r.profit += log.args.amount as bigint; r.wins += 1; }
  }
  return [...totals.values()].sort((a, b) => (a.profit === b.profit ? 0 : a.profit > b.profit ? -1 : 1)).slice(0, limit);
}

/** Addresses that have placed a bet, across all markets or on one. */
export function countPlayers(logs: readonly ChainLog[], marketId?: bigint) {
  const players = new Set<string>();
  for (const log of logs) {
    if (log.eventName === "BetPlaced" && (marketId === undefined || log.args.marketId === marketId)) players.add(log.args.player as string);
  }
  return players.size;
}

export const countClaims = (logs: readonly ChainLog[]) => logs.filter((log) => log.eventName === "Claimed").length;
