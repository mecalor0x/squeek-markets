// The wheel's live status is a nice extra from Squeekchain's public API. Markets never depend on it.
export type WheelStatus = { online: boolean; rpm: number; speed: number; distanceMm: number; openLaps: number; cumulativeLaps: number };

const WHEEL_TIMEOUT_MS = 4000;
const number = (value: unknown) => { const n = Number(value); return Number.isFinite(n) && n >= 0 ? n : 0; };

export function parseWheel(status: unknown): WheelStatus {
  if (!status || typeof status !== "object" || !("measurement" in status)) throw new Error("Unexpected wheel data");
  const { measurement: m, builder } = status as { measurement?: Record<string, unknown>; builder?: { queued?: { openRoundWorkUnits?: unknown } } };
  return { online: m?.freshness === "online", rpm: number(m?.rpmMilli) / 1000, speed: number(m?.speedMmPerSecond), distanceMm: number(m?.distanceMm), openLaps: number(builder?.queued?.openRoundWorkUnits), cumulativeLaps: number(m?.cumulativeWorkUnits) };
}

export async function fetchWheel(url: string, request: typeof fetch = fetch) {
  const response = await request(url, { signal: AbortSignal.timeout(WHEEL_TIMEOUT_MS) });
  if (!response.ok) throw new Error(`Wheel API answered ${response.status}`);
  return parseWheel(await response.json());
}
