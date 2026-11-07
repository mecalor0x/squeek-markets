"use client";
import { useMemo } from "react";
import { useAccount } from "wagmi";
import { EXPLORER } from "@/lib/config";
import { standings } from "@/lib/activity";
import { useHistory } from "@/lib/chain";
import { sqk } from "./Markets";

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

export function Leaderboard() {
  const history = useHistory();
  const { isLoading, isError } = history;
  const data = useMemo(() => (history.data ? standings(history.data) : undefined), [history.data]);
  const { address } = useAccount();
  return (
    <section className="panel" aria-labelledby="lb-title">
      <h2 id="lb-title">Top callers</h2>
      <p className="small">Net SQK from every market, rebuilt from the contract’s own events. Open bets count against you until they settle.</p>
      {isLoading ? <p>Reading the chain…</p> : isError ? <p className="tone-error">Couldn’t read the contract’s history just now.</p> : !data?.length ? <p>Nobody yet. Be the first.</p> : (
        <ol className="lb">
          {data.map((row, i) => (
            <li key={row.address} data-mine={row.address === address}>
              <span className="lb-place">{i + 1}.</span>
              <a href={`${EXPLORER}/address/${row.address}`} target="_blank" rel="noopener">{row.address === address ? "You" : short(row.address)}</a>
              <span className="lb-volume">{sqk(row.volume)} bet</span>
              <b className={row.profit >= 0n ? "yes" : "no"}>{row.profit >= 0n ? "+" : "−"}{sqk(row.profit >= 0n ? row.profit : -row.profit)}</b>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
