"use client";
import { useMemo, useState } from "react";
import { pageOf, shortAddress, toActivity, type ChainLog } from "@/lib/activity";
import { useBlockTimes } from "@/lib/chain";
import { EXPLORER } from "@/lib/config";
import { bothTimes } from "@/lib/markets";

/** Everything that has happened, rebuilt from the contract's own events. */
export function Activity({ logs, isLoading, isError }: { logs?: readonly ChainLog[]; isLoading: boolean; isError: boolean }) {
  const [page, setPage] = useState(1);
  const all = useMemo(() => (logs ? toActivity(logs) : []), [logs]);
  const shown = pageOf(all, page);
  const blockList = useMemo(() => shown.rows.map((row) => row.block), [shown.rows]);
  const times = useBlockTimes(blockList);
  return (
    <section className="activity" aria-labelledby="activity-title">
      <div className="section-head">
        <h2 className="section-title" id="activity-title">Activity</h2>
        <span className="small">{all.length.toLocaleString("en-US")} events, from the contract</span>
      </div>
      {isLoading ? <p className="small">Reading the chain…</p> : isError && !logs ? <p className="tone-error">Couldn’t read the contract’s events just now.</p> : !all.length ? <p className="empty">No activity yet.</p> : (
        <>
          <table className="activity-table">
            <thead><tr><th scope="col">Event</th><th scope="col">Time</th><th scope="col">Address</th><th scope="col">Detail</th><th scope="col">TX</th></tr></thead>
            <tbody>
              {shown.rows.map((row) => {
                const at = times.data?.get(row.block);
                return (
                  <tr key={row.key}>
                    <td data-label="Event"><span className="event" data-kind={row.kind}>{row.kind}</span></td>
                    <td data-label="Time">{at ? bothTimes(at) : "…"}</td>
                    <td data-label="Address">{row.address ? <a href={`${EXPLORER}/address/${row.address}`} target="_blank" rel="noopener" title={row.address}>{shortAddress(row.address)}</a> : "–"}</td>
                    <td data-label="Detail">{row.detail}</td>
                    <td data-label="TX"><a href={`${EXPLORER}/tx/${row.tx}`} target="_blank" rel="noopener" aria-label={`Transaction ${row.tx}`}>{row.tx.slice(0, 8)}… ↗</a></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <nav className="pager" aria-label="Activity pages">
            <button type="button" className="ghost" disabled={shown.page <= 1} onClick={() => setPage(shown.page - 1)}>Prev</button>
            <span>Page {shown.page} of {shown.pages}</span>
            <button type="button" className="ghost" disabled={shown.page >= shown.pages} onClick={() => setPage(shown.page + 1)}>Next</button>
          </nav>
        </>
      )}
    </section>
  );
}
