"use client";
import { useMemo } from "react";
import { countPlayers, type ChainLog } from "@/lib/activity";
import { useCoreStatus, useNightProgress, useWheel, type Market } from "@/lib/chain";
import { bothTimes, closesAt, countdown, currentNight, km, lapsSoFar, nightLabel } from "@/lib/markets";
import { sqk } from "./Markets";

function Stat({ label, value, unit, detail }: { label: string; value: string; unit?: string; detail: string }) {
  return (
    <div className="stat">
      <dt>{label}</dt>
      <dd><span className="stat-value">{value}</span>{unit ? <span className="stat-unit">{unit}</span> : null}</dd>
      <dd className="stat-detail">{detail}</dd>
    </div>
  );
}

export function Stats({ now, tonight, logs }: { now: number; tonight: Market | null; logs?: readonly ChainLog[] }) {
  const betNight = now ? currentNight(now) : 0;
  const runningNight = betNight ? betNight - 1 : 0;
  const core = useCoreStatus();
  const wheel = useWheel();
  const progress = useNightProgress(runningNight, core.data?.settled);
  const live = wheel.isError ? undefined : wheel.data?.cumulativeLaps;
  const laps = progress.data ? lapsSoFar(progress.data.start, progress.data.certified, live) : null;
  const pool = tonight ? tonight.pools.reduce((a, b) => a + b, 0n) + tonight.sponsored : null;
  const players = useMemo(() => (logs ? { all: countPlayers(logs), tonight: tonight ? countPlayers(logs, tonight.id) : 0 } : null), [logs, tonight]);
  return (
    <dl className="stats" aria-label="At a glance">
      <Stat label="Tonight’s pool" value={pool === null ? "–" : sqk(pool)} unit="SQK" detail={betNight ? `Night of ${nightLabel(betNight)}` : "–"} />
      <Stat label="Laps so far" value={laps === null ? "–" : laps.toLocaleString("en-US")} detail={laps === null ? "Running night" : `Night of ${nightLabel(runningNight)}, running · ≈${km(laps).toFixed(2)} km`} />
      <Stat label="Betting closes in" value={betNight ? countdown(closesAt(betNight) - now) : "–"} detail={betNight ? bothTimes(closesAt(betNight)) : "–"} />
      <Stat label="Players" value={players ? players.all.toLocaleString("en-US") : "–"} detail={players ? `${players.tonight.toLocaleString("en-US")} on tonight’s market` : "All markets"} />
    </dl>
  );
}
