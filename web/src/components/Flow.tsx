"use client";
import { Fragment } from "react";
import { countClaims, type ChainLog } from "@/lib/activity";
import { IS_DEPLOYED } from "@/lib/config";
import { useCoreStatus, useWheel } from "@/lib/chain";
import { currentRound } from "@/lib/markets";
import { sqk } from "./Markets";

type Tone = "good" | "wait" | "bad";
type Step = { name: string; job: string; tone: Tone; status: string };
// SqueekCore settles in batches, so being a couple of hours behind is normal.
const CORE_LAG_ROUNDS = 12;

/** How a result reaches a payout, with each stage's real state read live. */
export function Flow({ now, genuine, claimable, logs }: { now: number; genuine?: boolean; claimable: bigint; logs?: readonly ChainLog[] }) {
  const wheel = useWheel();
  const core = useCoreStatus();
  const w = wheel.isError ? undefined : wheel.data;
  const wheelStep: Pick<Step, "tone" | "status"> = !w ? { tone: wheel.isError ? "bad" : "wait", status: wheel.isError ? "No signal" : "Reading" } : !w.online ? { tone: "bad", status: "Offline" } : w.rpm > 0 ? { tone: "good", status: "Running" } : { tone: "wait", status: "Resting" };
  const c = core.data;
  const coreStep: Pick<Step, "tone" | "status"> = !c ? { tone: core.isError ? "bad" : "wait", status: core.isError ? "Unreachable" : "Reading" } : c.paused ? { tone: "bad", status: "Paused" } : now && currentRound(now) - c.settled > CORE_LAG_ROUNDS ? { tone: "wait", status: `Behind · round ${c.settled}` } : { tone: "good", status: `Round ${c.settled}` };
  const marketStep: Pick<Step, "tone" | "status"> = !IS_DEPLOYED ? { tone: "wait", status: "Not deployed" } : genuine === undefined ? { tone: "wait", status: "Reading" } : genuine ? { tone: "good", status: "Bound to Core" } : { tone: "bad", status: "Unverified" };
  const claims = logs ? countClaims(logs) : 0;
  const claimStep: Pick<Step, "tone" | "status"> = claimable > 0n ? { tone: "good", status: `${sqk(claimable)} SQK ready` } : claims > 0 ? { tone: "good", status: `${claims.toLocaleString("en-US")} paid` } : { tone: "wait", status: "None yet" };
  const steps: Step[] = [
    { name: "Wheel", job: "A sensor counts each lap", ...wheelStep },
    { name: "SqueekCore", job: "Certifies rounds on Ethereum", ...coreStep },
    { name: "Squeek Markets", job: "Reads the result, no admin", ...marketStep },
    { name: "Claim", job: "Winners collect their SQK", ...claimStep },
  ];
  return (
    <section className="flow-panel" aria-labelledby="flow-title">
      <h2 className="section-title" id="flow-title">How a result gets here</h2>
      <ol className="flow">
        {steps.map((step, i) => (
          <Fragment key={step.name}>
            {i > 0 ? (
              // Squares only move when the stage feeding them is healthy, so the motion means something.
              <li className="flow-link" aria-hidden="true" data-on={steps[i - 1].tone === "good"}><i /><i /><i /></li>
            ) : null}
            <li className="flow-step">
              <span className="pill status" data-tone={step.tone}>{step.status}</span>
              <div className="flow-box"><b>{step.name}</b><span>{step.job}</span></div>
            </li>
          </Fragment>
        ))}
      </ol>
    </section>
  );
}
