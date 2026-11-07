"use client";
import { useMemo, useState, type CSSProperties, type PointerEvent } from "react";
import { useCoreStatus, useRecentNights, useRecentRounds, type NightResult } from "@/lib/chain";
import { GENESIS_SECONDS, ROUND_SECONDS } from "@/lib/config";
import { RANGES, bothTimes, nightLabel, rangeOf, roundStart } from "@/lib/markets";

const fmt = (laps: number) => laps.toLocaleString("en-US");
const DAY = 86400;

function detail(row: NightResult) {
  if (row.state === "before") return { laps: "–", range: "Before launch", tip: "SqueekCore wasn’t recording yet." };
  if (row.state === "pending") return { laps: "–", range: "Not certified", tip: "SqueekCore hasn’t certified this whole night yet." };
  if (row.laps === 0) return { laps: "0 · no run", range: "", tip: "No running was recorded." };
  const range = RANGES[rangeOf(row.laps)];
  return { laps: fmt(row.laps), range: range.short, tip: `${fmt(row.laps)} laps, in the range ${range.label}.` };
}

function Nights({ now, openable, onOpen }: { now: number; openable: ReadonlySet<number>; onOpen: (night: number) => void }) {
  const { data, isError } = useRecentNights(now);
  const most = Math.max(1, ...(data ?? []).map((row) => row.laps));
  if (isError && !data) return <p className="tone-error">Couldn’t read past nights from the chain just now.</p>;
  if (!data) return <p className="small">Reading the chain…</p>;
  return (
    <ol className="night-bars">
      {data.map((row) => {
        const { laps, range, tip } = detail(row);
        const body = (
          <>
            <span className="night-laps">{laps}</span>
            <span className="night-track" aria-hidden="true">{row.state === "certified" && row.laps > 0 ? <span className="night-fill" style={{ "--share": row.laps / most } as CSSProperties} /> : null}</span>
            <span className="night-date">{nightLabel(row.night)}</span>
            <span className="night-range">{range}</span>
          </>
        );
        const zero = row.state === "certified" && row.laps === 0;
        return (
          <li key={row.night}>
            {openable.has(row.night)
              ? <button type="button" className="night-bar" data-zero={zero} title={`${nightLabel(row.night)}: ${tip} Open this night’s market.`} onClick={() => onOpen(row.night)}>{body}</button>
              : <div className="night-bar" data-zero={zero} title={`${nightLabel(row.night)}: ${tip}`}>{body}</div>}
          </li>
        );
      })}
    </ol>
  );
}

/** Rounds certified by SqueekCore, one bar each. A thousand of them, so it's one drawing with one hover layer. */
function Rounds() {
  const core = useCoreStatus();
  const { data, isError } = useRecentRounds(core.data?.settled, true);
  const [hover, setHover] = useState<{ round: number; laps: number; left: number } | null>(null);
  const shape = useMemo(() => {
    if (!data) return null;
    const span = data.through - data.after;
    const byRound = new Map(data.laps.map((r) => [r.round, r.laps]));
    const peak = data.laps.reduce((best, r) => (r.laps > best.laps ? r : best), { round: 0, laps: 0 });
    const nights: { left: number; night: number }[] = [];
    for (let round = data.after + 1; round <= data.through; round += 1) {
      const start = GENESIS_SECONDS + (round - 1) * ROUND_SECONDS;
      if (start % DAY === DAY / 2) nights.push({ left: ((round - 1 - data.after) / span) * 100, night: Math.floor(start / DAY) });
    }
    return { span, byRound, peak, nights };
  }, [data]);
  if (isError && !data) return <p className="tone-error">Couldn’t read rounds from SqueekCore just now.</p>;
  if (!data || !shape) return <p className="small">Reading the chain…</p>;
  if (!shape.span) return <p className="small">No certified rounds yet.</p>;
  const { span, byRound, peak, nights } = shape;
  const barWidth = Math.max(1, span / 450);
  const move = (event: PointerEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    const share = Math.min(0.999, Math.max(0, (event.clientX - box.left) / box.width));
    const round = data.after + 1 + Math.floor(share * span);
    setHover({ round, laps: byRound.get(round) ?? 0, left: share * 100 });
  };
  return (
    <>
      <div className="rounds-chart" onPointerMove={move} onPointerDown={move} onPointerLeave={() => setHover(null)}>
        <svg viewBox={`0 0 ${span} 100`} preserveAspectRatio="none" role="img" aria-label={`Laps per round for rounds ${data.after + 1} to ${data.through}. The busiest was round ${peak.round} with ${fmt(peak.laps)} laps.`}>
          {data.laps.filter((r) => r.laps > 0).map((r) => {
            const height = (r.laps / Math.max(1, peak.laps)) * 100;
            return <rect key={r.round} x={r.round - data.after - 1} y={100 - height} width={barWidth} height={height} />;
          })}
        </svg>
        {nights.map((n) => <span key={n.night} className="round-night" style={{ left: `${n.left}%` }}>{nightLabel(n.night)}</span>)}
        {hover ? (
          <>
            <span className="round-cursor" style={{ left: `${hover.left}%` }} />
            <span className="round-tip" data-flip={hover.left > 60} style={{ left: `${hover.left}%` }}><b>Round {hover.round}</b><br />{fmt(hover.laps)} laps<br />{bothTimes(roundStart(hover.round))}</span>
          </>
        ) : null}
      </div>
      <p className="small rounds-note">Rounds {fmt(data.after + 1)}–{fmt(data.through)}, 10 minutes each. Busiest: round {fmt(peak.round)} with {fmt(peak.laps)} laps.</p>
    </>
  );
}

/** Each night's laps and range from the contract's readResult, or every round from SqueekCore. */
export function RecentNights({ now, openable, onOpen }: { now: number; openable: ReadonlySet<number>; onOpen: (night: number) => void }) {
  const [view, setView] = useState<"nights" | "rounds">("nights");
  return (
    <section className="nights" aria-labelledby="nights-title">
      <div className="nights-head">
        <h2 className="section-title" id="nights-title">Last 7 nights</h2>
        <div className="segmented" role="group" aria-label="Show by">
          {(["nights", "rounds"] as const).map((key) => <button key={key} type="button" aria-pressed={view === key} onClick={() => setView(key)}>{key}</button>)}
        </div>
      </div>
      {view === "nights" ? <Nights now={now} openable={openable} onOpen={onOpen} /> : <Rounds />}
    </section>
  );
}
