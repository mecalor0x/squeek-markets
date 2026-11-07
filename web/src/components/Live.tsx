"use client";
import { useCoreStatus, useWheel } from "@/lib/chain";
import { currentRound, roundStart, countdown } from "@/lib/markets";

export function Live({ now }: { now: number }) {
  const wheel = useWheel();
  const core = useCoreStatus();
  const isError = wheel.isError;
  // Old numbers must not look live while the API is down.
  const data = isError ? undefined : wheel.data;
  const round = currentRound(now);
  const running = Boolean(data?.online && data.rpm > 0);
  const stateText = isError ? "Live wheel data is unavailable right now. Markets still work." : !data ? "Listening for the wheel…" : !data.online ? "Wheel signal offline" : running ? "Squeektoshi is running!" : "Squeektoshi is resting";
  const spin = running && data ? `${Math.max(0.25, 60 / data.rpm)}s` : "0s";
  return (
    <section className="live" data-running={running} aria-label="Live wheel">
      <div className="wheel" style={{ animationDuration: spin }} aria-hidden="true"><span>🐹</span></div>
      <div className="live-copy">
        <p className="live-state" role="status">{stateText}</p>
        <dl className="live-stats">
          <div><dt>Speed</dt><dd>{running && data ? `${Math.round(data.rpm)} rpm` : "0 rpm"}</dd></div>
          <div><dt>This night</dt><dd>{data ? `${(data.distanceMm / 1e6).toFixed(2)} km` : "–"}</dd></div>
          <div><dt>This round</dt><dd>{data ? `${data.openLaps} laps` : "–"}</dd></div>
          <div><dt>{now ? `Round ${round} ends in` : "This round ends in"}</dt><dd>{now ? countdown(roundStart(round + 1) - now) : "–"}</dd></div>
          <div><dt>Certified through</dt><dd>{core.data === undefined ? "–" : core.data.settled === 0 ? "none yet" : `round ${core.data.settled}`}</dd></div>
        </dl>
      </div>
      <a className="watch" href="https://squeekchain.com" target="_blank" rel="noopener">Watch him live ↗</a>
    </section>
  );
}
