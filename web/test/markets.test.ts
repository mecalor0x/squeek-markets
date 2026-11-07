import { describe, expect, it } from "vitest";
import { MIN_CREATOR_BET, MIN_STAKE, RANGES, Status, beforeLaunch, bothTimes, checkNight, checkStake, checkThreshold, closesAt, countdown, currentNight, currentRound, displayPrice, estimatePayout, finishedNights, firstBetText, km, multiplier, nightLabel, nightToDate, noBetsYet, openOutcomes, outcomeLabel, priceCents, question, quoteMultiple, rangeOf, refundReason, roundStart, roundsOf, shareLink, sortByPool, stage } from "../src/lib/markets";

const at = (iso: string) => Date.parse(iso) / 1000;
const SQK = 10n ** 18n;
const NOV_6 = at("2026-11-06T00:00:00Z") / 86400;

describe("nights", () => {
  it("matches the real night of 6 Nov: rounds 386 to 529", () => {
    expect(roundsOf(NOV_6)).toEqual({ startRound: 386, endRound: 529 });
    expect(closesAt(NOV_6)).toBe(at("2026-11-06T12:00:00Z"));
    expect(roundStart(386)).toBe(closesAt(NOV_6));
    expect(currentRound(roundStart(387) - 1)).toBe(386);
  });
  it("the bookable night flips at noon UTC", () => {
    expect(currentNight(at("2026-11-06T11:59:59Z"))).toBe(NOV_6);
    expect(currentNight(at("2026-11-06T12:00:00Z"))).toBe(NOV_6 + 1);
  });
  it("labels dates in UTC", () => {
    expect(nightLabel(NOV_6)).toBe("6 Nov");
    expect(nightToDate(NOV_6)).toBe("2026-11-06");
  });
});

describe("wording", () => {
  it("reads naturally", () => {
    expect(question({ isTemplate: false, night: NOV_6, threshold: 0 })).toBe("How far will Squeektoshi run on the night of 6 Nov?");
    expect(question({ isTemplate: true, night: NOV_6, threshold: 7000 })).toBe("More than 7,000 laps on the night of 6 Nov?");
    expect(outcomeLabel({ isTemplate: true }, 1)).toBe("YES");
    expect(outcomeLabel({ isTemplate: true }, 0)).toBe("NO");
    expect(outcomeLabel({ isTemplate: false }, 3)).toBe("7,500–8,499 laps");
    expect(RANGES).toHaveLength(5);
  });
  it("converts laps to km for display", () => {
    expect(km(7505)).toBeCloseTo(6.589, 2);
    expect(RANGES[0].approx).toBe("under ≈4.4 km");
  });
});

describe("prices", () => {
  it("is each outcome's share of the bets", () => {
    expect(priceCents([25n, 75n], 0)).toBe(25);
    expect(priceCents([1n, 2n], 1)).toBe(66.6);
  });
  it("shows nothing rather than a made-up price before the first bet", () => {
    expect(priceCents([0n, 0n, 0n, 0n, 0n], 2)).toBeNull();
  });
  it("estimates payouts like the contract: 500 on a 500 pool in a 2000 pool wins 1960 when alone on it", () => {
    expect(estimatePayout([1000n * SQK, 0n, 0n, 0n, 500n * SQK], 0n, 3, 500n * SQK)).toBe(1960n * SQK);
  });
  it("counts sponsored SQK in the prize", () => {
    expect(estimatePayout([100n * SQK, 0n], 800n * SQK, 1, 100n * SQK)).toBe(980n * SQK);
  });
});

describe("player market order", () => {
  const m = (name: string, pools: bigint[], sponsored = 0n) => ({ name, pools, sponsored });
  it("puts the biggest pool first, counting sponsored SQK", () => {
    const list = [m("small", [1n, 1n]), m("big", [50n, 60n]), m("sponsored", [1n, 1n], 500n), m("mid", [20n, 0n])];
    expect(sortByPool(list).map((x) => x.name)).toEqual(["sponsored", "big", "mid", "small"]);
  });
  it("keeps equal pools in order and doesn't change the original list", () => {
    const list = [m("newer", [5n, 5n]), m("older", [10n, 0n])];
    expect(sortByPool(list).map((x) => x.name)).toEqual(["newer", "older"]);
    expect(list[0].name).toBe("newer");
  });
});

describe("stages", () => {
  const funded = [10n, 0n, 5n, 0n, 0n];
  const after = at("2026-11-07T13:00:00Z");
  it("walks through a market's life", () => {
    expect(stage(Status.Open, NOV_6, funded, 0, at("2026-11-06T11:00:00Z"))).toBe("betting");
    expect(stage(Status.None, NOV_6, [0n, 0n], 0, at("2026-11-06T11:00:00Z"))).toBe("betting");
    expect(stage(Status.Open, NOV_6, funded, 400, at("2026-11-06T20:00:00Z"))).toBe("live");
    expect(stage(Status.Open, NOV_6, funded, 500, after)).toBe("waiting");
    expect(stage(Status.Open, NOV_6, funded, 529, after)).toBe("resolvable");
    expect(stage(Status.Resolved, NOV_6, funded, 529, after)).toBe("resolved");
    expect(stage(Status.Void, NOV_6, funded, 0, after)).toBe("void");
  });
  it("a one-sided market can be refunded as soon as betting closes", () => {
    expect(stage(Status.Open, NOV_6, [10n, 0n], 0, at("2026-11-06T12:00:01Z"))).toBe("resolvable");
  });
  it("an uncertified night can be refunded after 7 days", () => {
    expect(stage(Status.Open, NOV_6, funded, 500, at("2026-11-14T12:00:01Z"))).toBe("resolvable");
  });
});

describe("input checks", () => {
  it("accepts good stakes", () => {
    expect(checkStake("25").value).toBe(25n * SQK);
    expect(checkStake(" 2.5 ").value).toBe((5n * SQK) / 2n);
    expect(checkStake("1").value).toBe(MIN_STAKE);
  });
  it("refuses bad stakes with plain messages", () => {
    expect(checkStake("").error).toMatch(/how much/);
    expect(checkStake("abc").error).toMatch(/numbers only/);
    expect(checkStake("-5").error).toMatch(/numbers only/);
    expect(checkStake("1e5").error).toMatch(/numbers only/);
    expect(checkStake("1.2.3").error).toMatch(/numbers only/);
    expect(checkStake("0.5").error).toMatch(/minimum/);
    expect(checkStake("10", 5n * SQK).error).toMatch(/more SQK/);
    expect(checkStake("1.0000000000000000001").error).toMatch(/numbers only/);
  });
  it("asks a market's opener for at least 10 SQK", () => {
    expect(checkStake("9.99", undefined, MIN_CREATOR_BET).error).toBe("The minimum is 10 SQK.");
    expect(checkStake("10", undefined, MIN_CREATOR_BET).value).toBe(MIN_CREATOR_BET);
  });
  it("checks laps", () => {
    expect(checkThreshold("7,000").value).toBe(7000);
    expect(checkThreshold("").error).toBeTruthy();
    expect(checkThreshold("0").error).toMatch(/at least 1/);
    expect(checkThreshold("7.5").error).toMatch(/whole/);
    expect(checkThreshold("100001").error).toMatch(/more than/);
  });
  it("checks the night", () => {
    const now = at("2026-11-07T13:00:00Z");
    expect(checkNight("2026-11-08", now).value).toBe(NOV_6 + 2);
    expect(checkNight("2026-11-07", now).error).toMatch(/already closed/);
    expect(checkNight("2026-11-20", now).error).toMatch(/7 days/);
    expect(checkNight("", now).error).toMatch(/Pick a date/);
  });
});

describe("time left", () => {
  it("formats", () => {
    expect(countdown(0)).toBe("now");
    expect(countdown(90)).toBe("1m 30s");
    expect(countdown(3700)).toBe("1h 1m");
    expect(countdown(90000)).toBe("1d 1h");
  });
});

describe("the seven-night chart", () => {
  it("puts a lap count in the same range as the contract, with a boundary in the higher range", () => {
    expect([0, 4999, 5000, 6499, 6500, 7499, 7500, 8499, 8500, 90000].map(rangeOf)).toEqual([0, 0, 1, 1, 2, 2, 3, 3, 4, 4]);
    expect(rangeOf(3817)).toBe(0);
    expect(rangeOf(7231)).toBe(2);
    expect(rangeOf(7505)).toBe(3);
  });

  it("uses only nights that have ended, oldest first", () => {
    const nights = finishedNights(at("2026-11-07T14:45:00Z"));
    expect(nights).toHaveLength(7);
    expect(nights[6]).toBe(NOV_6);
    expect(nights[0]).toBe(NOV_6 - 6);
    expect(finishedNights(at("2026-11-07T11:59:59Z"))[6]).toBe(NOV_6 - 1);
    expect(finishedNights(at("2026-11-07T12:00:00Z"))[6]).toBe(NOV_6);
  });

  it("treats a night starting before genesis as unavailable, same as the contract", () => {
    expect(beforeLaunch(NOV_6 - 3)).toBe(true);
    expect(beforeLaunch(NOV_6 - 2)).toBe(false);
  });
});

describe("price rows", () => {
  it("gives the multiple of the final pool after the 2% burn", () => {
    expect(multiplier([50n * SQK, 50n * SQK], 0n, 0)).toBe(1.96);
    expect(multiplier([25n * SQK, 75n * SQK], 0n, 0)).toBe(3.92);
    expect(multiplier([50n * SQK, 50n * SQK], 100n * SQK, 1)).toBe(3.92);
  });

  it("gives no multiple while the market would refund, or for an outcome nobody has bet on", () => {
    expect(multiplier([0n, 0n, 0n, 0n, 0n], 0n, 2)).toBeNull();
    expect(multiplier([0n, 10n * SQK, 0n, 0n, 0n], 0n, 1)).toBeNull();
    expect(multiplier([5n * SQK, 10n * SQK, 0n, 0n, 0n], 0n, 2)).toBeNull();
  });

  it("uses the agreed first-bet wording", () => {
    expect(firstBetText(false)).toBe("Be the first! Needs bets on at least 2 ranges, otherwise everyone is refunded.");
    expect(firstBetText(true)).toContain("both YES and NO");
  });
});

describe("times", () => {
  it("shows UTC and the reader's own time", () => {
    const noon = at("2026-11-08T12:00:00Z");
    expect(bothTimes(noon, "Europe/Istanbul")).toBe("8 Nov, 12:00 UTC (15:00 your time)");
    expect(bothTimes(noon, "UTC")).toBe("8 Nov, 12:00 UTC (12:00 your time)");
  });

  it("names the local date when it's a different day", () => {
    expect(bothTimes(at("2026-11-08T12:00:00Z"), "Pacific/Auckland")).toBe("8 Nov, 12:00 UTC (9 Nov, 01:00 your time)");
  });
});

describe("sharing", () => {
  it("links to the card and carries the question", () => {
    const link = new URL(shareLink({ id: 20765n, isTemplate: false, night: 20765, threshold: 0 }, "https://squeek.example/"));
    expect(link.origin + link.pathname).toBe("https://x.com/intent/post");
    expect(link.searchParams.get("url")).toBe("https://squeek.example/#market-20765");
    expect(link.searchParams.get("text")).toContain("8 Nov");
  });
});

describe("markets that will refund", () => {
  const range = (pools: bigint[]) => ({ status: Status.Open, isTemplate: false, night: NOV_6, threshold: 0, pools });
  const yesNo = (pools: bigint[]) => ({ status: Status.Open, isTemplate: true, night: NOV_6, threshold: 7000, pools });
  const { endRound } = roundsOf(NOV_6);
  const afterClose = closesAt(NOV_6) + 60;
  const afterEnd = roundStart(endRound + 1) + 60;
  const two = [0n, SQK, SQK, 0n, 0n];

  it("shows no price for one-sided, empty or refunding markets", () => {
    expect(displayPrice([0n, 10n * SQK, 0n, 0n, 0n], 1)).toBeNull();
    expect(displayPrice([0n, 0n, 0n, 0n, 0n], 1)).toBeNull();
    expect(displayPrice([0n, SQK, 3n * SQK, 0n, 0n], 2, true)).toBeNull();
    expect(displayPrice([0n, SQK, 3n * SQK, 0n, 0n], 2)).toBe(75);
    expect(displayPrice([0n, SQK, 3n * SQK, 0n, 0n], 0)).toBeNull();
  });

  it("knows an empty pool, and sponsorship doesn't count as a bet", () => {
    expect(noBetsYet([0n, 0n, 0n, 0n, 0n])).toBe(true);
    expect(noBetsYet([0n, 1n, 0n, 0n, 0n])).toBe(false);
  });

  it("says nothing while betting is open, because the other side can still bet", () => {
    expect(refundReason(yesNo([0n, SQK]), 0, closesAt(NOV_6) - 60)).toBeNull();
  });

  it("names a one-sided market as soon as betting closes, as the contract allows", () => {
    expect(refundReason(yesNo([0n, SQK]), 0, afterClose)).toBe("only one side was bet");
    expect(refundReason(range([0n, SQK, 0n, 0n, 0n]), 0, afterClose)).toBe("only one range was bet");
    expect(refundReason(range([0n, 0n, 0n, 0n, 0n]), 0, afterClose)).toBe("no bets were placed");
  });

  it("names a night that was never certified, only after the timeout", () => {
    expect(refundReason(range(two), endRound - 1, afterEnd)).toBeNull();
    expect(refundReason(range(two), endRound - 1, afterEnd + 7 * 86400)).toBe("the night wasn’t certified in time");
  });

  it("names a winner nobody picked, using the contract's boundaries", () => {
    expect(refundReason(range(two), endRound, afterEnd, 7500)).toBe("nobody picked the winner");
    expect(refundReason(range(two), endRound, afterEnd, 7499)).toBeNull();
    expect(refundReason(yesNo([SQK, 0n]), endRound, afterEnd, 7001)).toBe("only one side was bet");
    expect(refundReason(yesNo([SQK, SQK]), endRound, afterEnd, 7000)).toBeNull();
  });

  it("can't say yet while the result is unknown, and stops once the market is final", () => {
    expect(refundReason(range(two), endRound, afterEnd)).toBeNull();
    expect(refundReason({ ...range([0n, SQK, 0n, 0n, 0n]), status: Status.Void }, endRound, afterEnd)).toBeNull();
  });
});

describe("being first on an outcome", () => {
  it("offers only outcomes nobody has bet on, and only once someone has bet", () => {
    expect(openOutcomes([0n, SQK, 3n * SQK, 0n, 0n])).toEqual([0, 3, 4]);
    expect(openOutcomes([0n, SQK, 0n, 0n, 0n])).toEqual([0, 2, 3, 4]);
    expect(openOutcomes([0n, 0n, 0n, 0n, 0n])).toEqual([]);
    expect(openOutcomes([SQK, SQK])).toEqual([]);
  });
  it("turns a quote into a multiple of the stake that was entered", () => {
    const pools = [0n, 40n * SQK, 50n * SQK, 0n, 0n];
    const quote = estimatePayout(pools, 0n, 3, 10n * SQK);
    expect(quote).toBe(98n * SQK);
    expect(quoteMultiple(quote, 10n * SQK)).toBe(9.8);
    expect(quoteMultiple(estimatePayout(pools, 0n, 3, 100n * SQK), 100n * SQK)).toBe(1.862);
  });
});
