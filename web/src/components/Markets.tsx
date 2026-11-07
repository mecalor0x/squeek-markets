"use client";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { formatUnits, type Address } from "viem";
import { usePublicClient } from "wagmi";
import { CHAIN_ID, EXPLORER, MARKETS_ADDRESS, TESTNET_NOTICE } from "@/lib/config";
import { explainError, templateExists, useNightResult, useQuotes, useWalletState, verifyNight, type Market, type Position, type useActions } from "@/lib/chain";
import { MAX_NIGHTS_AHEAD, MIN_CREATOR_BET, NO, RANGES, YES, bothTimes, checkNight, checkStake, checkThreshold, closesAt, countdown, currentNight, displayPrice, estimatePayout, firstBetText, fundedOutcomes, km, multiplier, nightToDate, noBetsYet, openOutcomes, outcomeLabel, question, quoteMultiple, rangeOf, refundReason, roundsOf, shareLink, stage, type Stage } from "@/lib/markets";

export const sqk = (value: bigint) => Number(formatUnits(value, 18)).toLocaleString("en-US", { maximumFractionDigits: value < 10n ** 19n ? 2 : 0 });
type Actions = ReturnType<typeof useActions>;
const ONE = 10n ** 18n;
const STAGE_TEXT: Record<Stage, string> = { betting: "Open", live: "Running now", waiting: "Waiting for Ethereum", resolvable: "Ready to settle", resolved: "Settled", void: "Refunded" };
const walletLabel = (state: ReturnType<typeof useWalletState>, ready: string) => (state.ready ? ready : state.needsSwitch ? "Switch to Sepolia" : "Connect a wallet");
const PRICE_NOTE = "Price can change until betting closes; payout uses final pools.";

export type Review = { title: string; rows: [string, ReactNode][]; note?: string; confirm: string; run: () => void };

/** Every transaction goes through this summary, so nobody signs something they haven't read. */
export function ReviewDialog({ review, onClose }: { review: Review; onClose: () => void }) {
  const confirmRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    confirmRef.current?.focus();
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="modal-back" onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="review-title">
        <h2 id="review-title">{review.title}</h2>
        <dl className="review-rows">
          {review.rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
        </dl>
        {review.note ? <p className="small">{review.note}</p> : null}
        <div className="modal-actions">
          <button type="button" className="ghost" onClick={onClose}>Go back</button>
          <button type="button" ref={confirmRef} className="primary" onClick={() => { review.run(); onClose(); }}>{review.confirm}</button>
        </div>
      </div>
    </div>
  );
}

function Verify({ market, coreAddress, settled }: { market: Market; coreAddress: Address; settled: number }) {
  const client = usePublicClient({ chainId: CHAIN_ID });
  const [result, setResult] = useState<Awaited<ReturnType<typeof verifyNight>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const { startRound, endRound } = roundsOf(market.night);
  const certified = settled >= endRound;
  const check = async () => {
    if (!client) return;
    setLoading(true);
    setError(null);
    try {
      setResult(await verifyNight(client as never, market.night, coreAddress));
    } catch {
      setError("Couldn't read SqueekCore just now. Try again.");
    } finally {
      setLoading(false);
    }
  };
  const winnerNow = result ? (market.isTemplate ? (result.laps > BigInt(market.threshold) ? "YES" : "NO") : RANGES[rangeOf(result.laps)].label) : null;
  const agrees = result && market.status === 2 ? result.laps === BigInt(market.laps) && winnerNow === outcomeLabel(market, market.winner) : null;
  return (
    <section className="verify" aria-label="Check this result">
      <p>Laps = SqueekCore at round {endRound} − SqueekCore at round {startRound - 1}.</p>
      {certified
        ? <button type="button" className="ghost" onClick={check} disabled={loading}>{loading ? "Reading SqueekCore…" : "Read it from the chain now"}</button>
        : <p className="small">This night isn’t fully certified yet. SqueekCore is certified through round {settled}, and the result can be read once it reaches round {endRound}.</p>}
      {error ? <p className="tone-error">{error}</p> : null}
      {result ? (
        <dl className="verify-sums">
          <div><dt>Round {result.endRound}</dt><dd>{result.atEnd.toString()}</dd></div>
          <div><dt>Round {result.startRound - 1}</dt><dd>− {result.before.toString()}</dd></div>
          <div><dt>Laps</dt><dd><b>{result.laps.toString()}</b> (≈{km(result.laps).toFixed(2)} km)</dd></div>
          <div><dt>So</dt><dd><b>{winnerNow}</b></dd></div>
          {agrees !== null ? <div><dt>Result on-chain</dt><dd className={agrees ? "tone-good" : "tone-error"}>{agrees ? "✓ matches" : "✗ doesn't match"}</dd></div> : null}
        </dl>
      ) : null}
      <p className="small">
        Read straight from <a href={`${EXPLORER}/address/${coreAddress}?tab=read_write_proxy`} target="_blank" rel="noopener">SqueekCore</a> through your own connection, not our server. <a href={`${EXPLORER}/address/${MARKETS_ADDRESS}`} target="_blank" rel="noopener">See this contract</a>.
      </p>
    </section>
  );
}

type PanelProps = { market: Market; settled: number; now: number; position?: Position; balance?: bigint; actions: Actions; coreAddress: Address; blocked: boolean; ask: (review: Review) => void };

/** One market: its prices, a bet slip, and whatever can be done with it right now. */
export function MarketPanel({ market, settled, now, position, balance, actions, coreAddress, blocked, ask }: PanelProps) {
  const walletState = useWalletState();
  const canSend = walletState.ready && !blocked && !actions.busy;
  const [picked, setPicked] = useState<number | null>(null);
  const [stakeText, setStakeText] = useState("10");
  const [sponsorText, setSponsorText] = useState("");
  const [touched, setTouched] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const cardRef = useRef<HTMLElement>(null);
  const share = useMemo(() => shareLink(market, typeof window === "undefined" ? "" : `${window.location.origin}${window.location.pathname}`), [market]);
  // A shared link points at this card; markets only appear once the chain has answered, so the browser can't jump to it alone.
  useEffect(() => { if (window.location.hash === `#market-${market.id}`) cardRef.current?.scrollIntoView(); }, [market.id]);
  const s = stage(market.status, market.night, market.pools, settled, now);
  const total = market.pools.reduce((a, b) => a + b, 0n) + market.sponsored;
  const bettable = s === "betting";
  const needsResult = s === "resolvable" && market.status === 1 && fundedOutcomes(market.pools) >= 2 && settled >= roundsOf(market.night).endRound;
  const result = useNightResult(market.night, needsResult);
  const refund = refundReason(market, settled, now, result.data);
  const noPrices = s === "void" || refund !== null;
  const empty = noBetsYet(market.pools);
  // Over-balance stakes still get a figure: this is an estimate, and the slip reports the balance problem itself.
  const quoteStake = checkStake(stakeText).value;
  const quotes = useQuotes(market.id, bettable ? openOutcomes(market.pools) : [], quoteStake, market.pools.join(","));
  const outcomes = market.isTemplate ? [YES, 0] : market.pools.map((_, i) => i);
  const checked = checkStake(stakeText, balance);
  const refundsForNow = fundedOutcomes(market.pools) < 2;
  const estimate = picked !== null && checked.value ? estimatePayout(market.pools, market.sponsored, picked, checked.value) : null;

  const reviewBet = () => {
    setTouched(true);
    if (picked === null || !checked.value) return;
    const stake = checked.value;
    const price = displayPrice(market.pools, picked);
    ask({
      title: "Check your bet",
      rows: [
        ["Market", question(market)],
        ["Your pick", outcomeLabel(market, picked)],
        ["Stake", `${sqk(stake)} SQK`],
        ["Price now", price === null ? "No price yet" : `${price.toFixed(1)}¢`],
        ...(refundsForNow ? [] : [["If it wins", `≈${sqk(estimatePayout(market.pools, market.sponsored, picked, stake))} SQK`] as [string, ReactNode]]),
        ["Betting closes", `${bothTimes(closesAt(market.night))}, in ${countdown(closesAt(market.night) - now)}`],
      ],
      note: `${refundsForNow ? `${firstBetText(market.isTemplate)} ` : ""}${TESTNET_NOTICE} ${PRICE_NOTE} 2% of the pool is burned at settlement. Your wallet will ask for one signature, then one transaction.`,
      confirm: "Place bet",
      run: () => actions.placeBet(market.id, picked, stake),
    });
  };
  const reviewSponsor = () => {
    const amount = checkStake(sponsorText, balance);
    if (!amount.value) { actions.setMessage({ text: amount.error as string, tone: "error" }); return; }
    const value = amount.value;
    ask({
      title: "Add to the prize",
      rows: [["Market", question(market)], ["You add", `${sqk(value)} SQK`], ["You get back", "Nothing, unless the market is called off"]],
      note: `${TESTNET_NOTICE} It goes to the winners. Your wallet will ask for two transactions: approve exactly this amount, then add it.`,
      confirm: "Add to prize",
      run: () => actions.sponsorMarket(market.id, value),
    });
  };
  const reviewSettle = () => ask(refund ? {
    title: "Settle and refund",
    rows: [["Market", question(market)], ["Why", `It will refund: ${refund}`], ["What happens", "Everyone can claim their full stake back, with no fee"]],
    note: "Anyone can do this. It costs a little Sepolia ETH for gas and pays you nothing extra.",
    confirm: "Settle & refund",
    run: () => actions.resolveMarket(market.id, true),
  } : {
    title: "Settle this market",
    rows: [["Market", question(market)], ["Result comes from", "SqueekCore on Ethereum, read by the contract"]],
    note: "Anyone can do this. It costs a little Sepolia ETH for gas and pays you nothing extra.",
    confirm: "Settle",
    run: () => actions.resolveMarket(market.id),
  });
  const reviewClaim = () => ask({
    title: "Claim your SQK",
    rows: [["Market", question(market)], ["You receive", `${sqk(position?.claimable ?? 0n)} SQK`]],
    note: "It costs a little Sepolia ETH for gas.",
    confirm: "Claim",
    run: () => actions.claimMarket(market.id),
  });

  const myStake = (i: number) => position?.stakes[i] ?? 0n;
  const hasStake = market.pools.some((_, i) => myStake(i) > 0n);
  return (
    <article className="market" id={`market-${market.id}`} ref={cardRef} data-template={market.isTemplate}>
      <header className="market-head">
        <div className="market-pills">
          {refund ? <span className="pill refund" data-stage="refund">WILL REFUND · {refund}</span> : <span className="pill" data-stage={s}>{STAGE_TEXT[s]}</span>}
          {!market.isTemplate ? <span className="pill auto">{s === "betting" ? "Tonight’s main market" : "Nightly market"}</span> : null}
        </div>
        <h2>{question(market)}</h2>
        <p className="small">
          {sqk(total)} SQK pool{market.sponsored > 0n ? ` (${sqk(market.sponsored)} sponsored)` : ""}
          {bettable ? ` · closes in ${countdown(closesAt(market.night) - now)} · ${bothTimes(closesAt(market.night))}` : ""}
        </p>
      </header>

      <div className="outcomes" role="group" aria-label="Outcomes">
        {outcomes.map((i) => {
          const price = displayPrice(market.pools, i, noPrices);
          const won = s === "resolved" && market.winner === i;
          const times = multiplier(market.pools, market.sponsored, i);
          const beFirst = bettable && !empty && market.pools[i] === 0n;
          const quoted = quoteStake !== undefined && quotes.data ? quotes.data.byOutcome.get(i) : undefined;
          return (
            <button key={i} type="button" className="outcome" disabled={!bettable} data-picked={picked === i} data-won={won} data-side={market.isTemplate ? (i === YES ? "yes" : "no") : "range"} aria-pressed={picked === i} onClick={() => setPicked(picked === i ? null : i)}>
              <span className="outcome-name">
                <b>{outcomeLabel(market, i)}</b>
                {!market.isTemplate ? <span>{RANGES[i].approx}</span> : <span>{i === YES ? `more than ${market.threshold.toLocaleString("en-US")} laps (≈${km(market.threshold).toFixed(2)} km)` : `${market.threshold.toLocaleString("en-US")} laps or fewer`}</span>}
                {myStake(i) > 0n ? <span className="mine-tag">Your bet: {sqk(myStake(i))} SQK</span> : null}
              </span>
              {empty ? <span className="outcome-none">No bets yet</span> : (
                <>
                  <span className="outcome-price">{price === null ? "—" : `${price.toFixed(price % 1 === 0 ? 0 : 1)}¢`}</span>
                  {beFirst ? <span className="outcome-first">Be first{quoted !== undefined && quotes.data ? ` → ×${quoteMultiple(quoted, quotes.data.amount).toFixed(2)}` : ""}</span> : (
                    <span className="outcome-pay">
                      {won ? <b>Won</b> : bettable && times !== null ? <b>×{times.toFixed(2)}</b> : null}
                      <span>{sqk(market.pools[i])} SQK</span>
                    </span>
                  )}
                </>
              )}
              <span className="outcome-bar" aria-hidden="true"><span style={{ width: `${price ?? 0}%` }} /></span>
            </button>
          );
        })}
      </div>
      {bettable ? <p className="small price-note">{PRICE_NOTE} A price is that outcome’s share of the bets so far.</p> : null}

      {bettable && picked !== null ? (
        <form className="slip" noValidate onSubmit={(event) => { event.preventDefault(); reviewBet(); }}>
          <label htmlFor={`stake-${market.id}`}>Your stake on {outcomeLabel(market, picked)} (SQK)</label>
          <div className="slip-row">
            <input id={`stake-${market.id}`} inputMode="decimal" autoComplete="off" value={stakeText} aria-invalid={touched && Boolean(checked.error)} onChange={(event) => setStakeText(event.target.value)} />
            <button className="primary" disabled={!canSend}>{walletLabel(walletState, "Review bet")}</button>
          </div>
          <div className="quick">
            {["10", "100", "500"].map((q) => <button type="button" key={q} onClick={() => setStakeText(q)}>{q}</button>)}
            {balance !== undefined && balance >= ONE ? <button type="button" onClick={() => setStakeText(formatUnits(balance, 18))}>Max</button> : null}
          </div>
          {stakeText.trim() && checked.error ? <p className="tone-error" role="alert">{checked.error}</p> : null}
          {refundsForNow ? <p className="payout first-bet">{firstBetText(market.isTemplate)}</p> : estimate !== null ? <p className="payout">If it wins, you’d get about <b>{sqk(estimate)} SQK</b> at today’s pools.</p> : null}
          <p className="small testnet-note">{TESTNET_NOTICE}</p>
        </form>
      ) : null}

      {s === "resolved" ? <p className="result"><b className="yes">{outcomeLabel(market, market.winner)} won.</b> He ran {market.laps.toLocaleString("en-US")} laps (≈{km(market.laps).toFixed(2)} km). 2% of the pool was burned.</p> : null}
      {s === "void" && market.status !== 0 ? <p className="result">This market was called off, so every stake is refunded with no fee.</p> : null}
      {s === "void" && market.status === 0 ? <p className="result">Nobody bet on this night.</p> : null}
      {s === "live" ? <p className="result">Betting has closed and this night is under way.</p> : null}
      {s === "waiting" ? <p className="result">The night is over. Waiting for SqueekCore to certify its last rounds.</p> : null}

      {hasStake && (s === "live" || s === "waiting") ? <p className="small">Your stake is locked in until this settles.</p> : null}
      <div className="market-actions">
        {s === "resolvable" && market.status === 1 ? <button className="primary" disabled={!canSend} onClick={reviewSettle}>{refund ? "Settle & refund" : "Settle this market"}</button> : null}
        {position && position.claimable > 0n ? <button className="primary" disabled={!canSend} onClick={reviewClaim}>Claim {sqk(position.claimable)} SQK</button> : null}
      </div>

      {bettable ? (
        <details className="sponsor">
          <summary>Add to the prize</summary>
          <div className="slip-row">
            <input aria-label="SQK to add" inputMode="decimal" placeholder="500" autoComplete="off" value={sponsorText} onChange={(event) => setSponsorText(event.target.value)} />
            <button type="button" className="ghost" disabled={!canSend} onClick={reviewSponsor}>Review</button>
          </div>
        </details>
      ) : null}
      <div className="market-tools">
        <button type="button" className="ghost" aria-expanded={verifying} onClick={() => setVerifying(!verifying)}>Check it yourself</button>
        <a className="ghost" href={share} target="_blank" rel="noopener">Share on X</a>
      </div>
      {verifying ? <Verify market={market} coreAddress={coreAddress} settled={settled} /> : null}
    </article>
  );
}

/** Anyone can add a YES/NO market, but only from this template: a night and a number of laps. */
export function CreateMarket({ now, balance, actions, blocked, ask, covered, onClose }: { now: number; balance?: bigint; actions: Actions; blocked: boolean; ask: (review: Review) => void; covered: boolean; onClose: () => void }) {
  const lapsRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    lapsRef.current?.focus();
    // While the summary is on top, Escape belongs to it.
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape" && !covered) onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [covered, onClose]);
  const walletState = useWalletState();
  const client = usePublicClient({ chainId: CHAIN_ID });
  const firstNight = now ? currentNight(now) : 0;
  const [dateText, setDateText] = useState("");
  const [lapsText, setLapsText] = useState("7000");
  const [side, setSide] = useState<number>(YES);
  const [stakeText, setStakeText] = useState("10");
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const chosen = dateText || (firstNight ? nightToDate(firstNight) : "");
  const laps = checkThreshold(lapsText);
  const stake = checkStake(stakeText, balance, MIN_CREATOR_BET);

  const review = async () => {
    setError(null);
    const night = checkNight(chosen, now);
    if (night.error !== undefined) { setError(night.error); return; }
    if (laps.error !== undefined) { setError(laps.error); return; }
    if (stake.error !== undefined) { setError(stake.error); return; }
    const n = night.value;
    const t = laps.value;
    const amount = stake.value;
    const pick = side;
    setChecking(true);
    try {
      if (client && await templateExists(client as never, n, t)) { setError("That market already exists. Find it in the market list."); return; }
    } catch (e) {
      setError(explainError(e));
      return;
    } finally {
      setChecking(false);
    }
    ask({
      title: "Check your market",
      rows: [
        ["Question", question({ isTemplate: true, night: n, threshold: t })],
        ["Night starts", bothTimes(closesAt(n))],
        ["Night ends", bothTimes(closesAt(n + 1))],
        ["Betting closes", bothTimes(closesAt(n))],
        ["YES wins with", `more than ${t.toLocaleString("en-US")} laps (≈${km(t).toFixed(2)} km)`],
        ["Your first bet", `${sqk(amount)} SQK on ${pick === YES ? "YES" : "NO"}`],
      ],
      note: `${TESTNET_NOTICE} It can't be changed afterwards, and opening a market gives you no special rights. If nobody bets on the other side, you get your stake back. Your wallet will ask for one signature, then one transaction.`,
      confirm: "Open market and bet",
      run: () => { onClose(); actions.createMarket(n, t, pick, amount); },
    });
  };
  return (
    <div className="modal-back" onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="modal create-modal" role="dialog" aria-modal="true" aria-labelledby="create-title">
      <h2 id="create-title">Create a market</h2>
      <p className="small">Ask “will he beat this number?” for any of the next {MAX_NIGHTS_AHEAD} nights. Anyone can, and the same market can’t be opened twice. You place the first bet, at least 10 SQK.</p>
      <form className="create-form" noValidate onSubmit={(event) => { event.preventDefault(); review(); }}>
        <div className="field">
          <label htmlFor="create-night">Night</label>
          <input id="create-night" type="date" value={chosen} min={firstNight ? nightToDate(firstNight) : undefined} max={firstNight ? nightToDate(firstNight + MAX_NIGHTS_AHEAD - 1) : undefined} onChange={(event) => setDateText(event.target.value)} />
          <span className="small">{chosen ? `Starts ${bothTimes(Date.parse(`${chosen}T12:00:00Z`) / 1000)}.` : "Starts at 12:00 UTC on this date."}</span>
        </div>
        <div className="field">
          <span className="field-label">Question</span>
          <p className="fixed-type">Will he run more than X laps? <span className="yes">YES</span> / <span className="no">NO</span></p>
        </div>
        <div className="field">
          <label htmlFor="create-laps">X (laps)</label>
          <input id="create-laps" ref={lapsRef} inputMode="numeric" autoComplete="off" value={lapsText} onChange={(event) => setLapsText(event.target.value)} />
          <span className="small">{laps.value !== undefined ? `≈${km(laps.value).toFixed(2)} km` : laps.error}</span>
        </div>
        <div className="field">
          <span className="field-label">Your first bet</span>
          <div className="side-pick" role="group" aria-label="Your side">
            <button type="button" data-side="yes" aria-pressed={side === YES} onClick={() => setSide(YES)}>YES</button>
            <button type="button" data-side="no" aria-pressed={side === NO} onClick={() => setSide(NO)}>NO</button>
          </div>
        </div>
        <div className="field">
          <label htmlFor="create-stake">Stake (SQK)</label>
          <input id="create-stake" inputMode="decimal" autoComplete="off" value={stakeText} aria-invalid={stakeText.trim() !== "" && Boolean(stake.error)} onChange={(event) => setStakeText(event.target.value)} />
          <span className="small">{stake.error ?? "Minimum 10 SQK."}</span>
        </div>
        {error ? <p className="tone-error create-error" role="alert">{error}</p> : null}
        <div className="modal-actions create-actions">
          <button type="button" className="ghost" onClick={onClose}>Cancel</button>
          <button className="primary" disabled={!walletState.ready || blocked || checking || Boolean(actions.busy)}>{walletLabel(walletState, checking ? "Checking…" : "Review market")}</button>
        </div>
      </form>
    </div>
    </div>
  );
}
