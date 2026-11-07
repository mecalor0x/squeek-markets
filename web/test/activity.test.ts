import { describe, expect, it } from "vitest";
import { ACTIVITY_PAGE, countClaims, countPlayers, pageOf, shortAddress, standings, toActivity, type ChainLog } from "../src/lib/activity";
import { lapsSoFar, roundLaps } from "../src/lib/markets";

const SQK = 10n ** 18n;
const ALICE = "0x1111111111111111111111111111111111111111";
const BOB = "0x2222222222222222222222222222222222222222";
const NIGHT = 20765n; // 8 Nov 2026
const TEMPLATE = 987654321987654321n;
let index = 0;
const log = (eventName: string, block: number, args: Record<string, unknown>): ChainLog => ({ eventName, args, blockNumber: BigInt(block), logIndex: index++, transactionHash: `0x${String(block).padStart(64, "0")}` });

const logs = [
  log("RoundOpened", 1, { marketId: NIGHT }),
  log("BetPlaced", 1, { marketId: NIGHT, player: ALICE, outcome: 2, amount: 100n * SQK }),
  log("MarketCreated", 2, { marketId: TEMPLATE, creator: BOB, night: 20765, threshold: 7000n }),
  log("BetPlaced", 2, { marketId: TEMPLATE, player: BOB, outcome: 1, amount: 10n * SQK }),
  log("Sponsored", 3, { marketId: NIGHT, sponsor: BOB, amount: 5n * SQK }),
  log("BetPlaced", 3, { marketId: NIGHT, player: ALICE, outcome: 3, amount: 50n * SQK }),
  log("MarketResolved", 4, { marketId: NIGHT, winner: 3, laps: 7800n }),
  log("Claimed", 5, { marketId: NIGHT, player: ALICE, amount: 151n * SQK }),
  log("DustBurned", 5, { marketId: NIGHT, amount: 1n }),
];

describe("activity table", () => {
  const rows = toActivity(logs);
  it("shows only the five kinds of event, newest first", () => {
    expect(rows.map((r) => r.kind)).toEqual(["CLAIMED", "RESOLVED", "BET", "SPONSOR", "BET", "MARKET CREATED", "BET"]);
    expect(rows.map((r) => r.block)).toEqual([...rows.map((r) => r.block)].sort((a, b) => (a > b ? -1 : 1)));
  });
  it("describes range markets and player markets in words", () => {
    const by = (kind: string) => rows.filter((r) => r.kind === kind);
    expect(by("BET").at(-1)?.detail).toBe("100 SQK on 6,500–7,499 laps · night of 8 Nov");
    expect(by("BET")[1].detail).toBe("10 SQK on YES · more than 7,000 laps, 8 Nov");
    expect(by("RESOLVED")[0]).toMatchObject({ address: null, detail: "7,500–8,499 laps won with 7,800 laps · night of 8 Nov" });
    expect(by("MARKET CREATED")[0]).toMatchObject({ address: BOB, detail: "more than 7,000 laps, 8 Nov" });
    expect(by("CLAIMED")[0].detail).toBe("151 SQK · night of 8 Nov");
    expect(by("SPONSOR")[0].detail).toBe("5 SQK added · night of 8 Nov");
  });
  it("gives every row its own key and transaction", () => {
    expect(new Set(rows.map((r) => r.key)).size).toBe(rows.length);
    expect(rows[0].tx).toBe(`0x${"5".padStart(64, "0")}`);
  });
  it("orders events in the same block by their position, including past nine", () => {
    const same = [9, 10, 2].map((logIndex) => ({ ...log("Claimed", 7, { marketId: NIGHT, player: ALICE, amount: SQK }), logIndex }));
    expect(toActivity(same).map((r) => r.logIndex)).toEqual([10, 9, 2]);
  });
  it("shortens addresses", () => {
    expect(shortAddress(ALICE)).toBe("0x1111…1111");
  });
});

describe("paging", () => {
  const items = Array.from({ length: 25 }, (_, i) => i);
  it("splits into pages", () => {
    expect(pageOf(items, 1)).toMatchObject({ page: 1, pages: 3 });
    expect(pageOf(items, 1).rows).toHaveLength(ACTIVITY_PAGE);
    expect(pageOf(items, 3).rows).toEqual([20, 21, 22, 23, 24]);
  });
  it("stays on a real page when asked for one that doesn't exist", () => {
    expect(pageOf(items, 99).page).toBe(3);
    expect(pageOf(items, 0).page).toBe(1);
    expect(pageOf([], 1)).toEqual({ rows: [], page: 1, pages: 1 });
  });
});

describe("counts from events", () => {
  it("counts each address once, overall and per market", () => {
    expect(countPlayers(logs)).toBe(2);
    expect(countPlayers(logs, NIGHT)).toBe(1);
    expect(countPlayers(logs, 1n)).toBe(0);
    expect(countClaims(logs)).toBe(1);
  });
  it("keeps the leaderboard's sums: bets and sponsoring count against, claims for", () => {
    const [first, second] = standings(logs);
    expect(first).toMatchObject({ address: ALICE, profit: SQK, volume: 150n * SQK, wins: 1 });
    expect(second).toMatchObject({ address: BOB, profit: -15n * SQK, volume: 10n * SQK, wins: 0 });
  });
});

describe("rounds and laps", () => {
  it("turns SqueekCore's running totals into laps per round", () => {
    expect(roundLaps(100, [{ round: 5, cumulative: 106 }, { round: 9, cumulative: 356 }])).toEqual([{ round: 5, laps: 6 }, { round: 9, laps: 250 }]);
    expect(roundLaps(100, [])).toEqual([]);
  });
  it("uses the live count only when it's ahead of what's certified", () => {
    expect(lapsSoFar(100, 150, 170)).toBe(70);
    expect(lapsSoFar(100, 150, 120)).toBe(50);
    expect(lapsSoFar(100, 150)).toBe(50);
  });
});
