import { describe, expect, it } from "vitest";
import { fetchWheel, parseWheel } from "../src/lib/wheel";

const answer = (body: string, status = 200) => (async () => new Response(body, { status })) as typeof fetch;

describe("wheel API", () => {
  it("reads a normal answer", async () => {
    const body = JSON.stringify({ measurement: { freshness: "online", rpmMilli: 42000, speedMmPerSecond: 600, distanceMm: 5000000 }, builder: { queued: { openRoundWorkUnits: "12" } } });
    await expect(fetchWheel("x", answer(body))).resolves.toEqual({ online: true, rpm: 42, speed: 600, distanceMm: 5000000, openLaps: 12, cumulativeLaps: 0 });
  });
  it("treats a server error, bad JSON, a wrong shape or no connection as unavailable", async () => {
    await expect(fetchWheel("x", answer("oops", 500))).rejects.toThrow(/500/);
    await expect(fetchWheel("x", answer("<html>"))).rejects.toThrow();
    await expect(fetchWheel("x", answer("{}"))).rejects.toThrow(/Unexpected/);
    await expect(fetchWheel("x", answer("null"))).rejects.toThrow(/Unexpected/);
    await expect(fetchWheel("x", (async () => { throw new TypeError("Failed to fetch"); }) as typeof fetch)).rejects.toThrow(/fetch/);
  });
  it("turns nonsense numbers into zero", () => {
    expect(parseWheel({ measurement: { freshness: "stale", rpmMilli: "abc", distanceMm: -5 } })).toEqual({ online: false, rpm: 0, speed: 0, distanceMm: 0, openLaps: 0, cumulativeLaps: 0 });
  });
});
