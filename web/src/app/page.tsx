"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Address } from "viem";
import { useAccount, useConnect, useDisconnect, useSwitchChain } from "wagmi";
import { CHAIN_ID, EXPLORER, GET_SQK_URL, IS_DEPLOYED, TESTNET_NOTICE } from "@/lib/config";
import { useActions, useBalance, useBoard, useClock, useHistory, usePositions, useWalletState, type Market } from "@/lib/chain";
import { sortByPool, stage } from "@/lib/markets";
import { Live } from "@/components/Live";
import { Leaderboard } from "@/components/Leaderboard";
import { CreateMarket, MarketPanel, ReviewDialog, sqk, type Review } from "@/components/Markets";
import { Activity } from "@/components/Activity";
import { Flow } from "@/components/Flow";
import { RecentNights } from "@/components/RecentNights";
import { Stats } from "@/components/Stats";
import { Rules } from "@/components/Rules";

function WalletButton({ balance }: { balance?: bigint }) {
  const { address, isConnected, chainId } = useAccount();
  const { connect, connectors, isPending } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain } = useSwitchChain();
  const [noWallet, setNoWallet] = useState(false);
  if (isConnected && chainId !== CHAIN_ID) return <button className="primary" onClick={() => switchChain({ chainId: CHAIN_ID })}>Switch to Sepolia</button>;
  if (isConnected && address) {
    return (
      <div className="wallet">
        <span>{balance !== undefined ? `${sqk(balance)} SQK` : "…"}</span>
        <button className="ghost" onClick={() => disconnect()} title="Disconnect">{address.slice(0, 6)}…{address.slice(-4)}</button>
      </div>
    );
  }
  return (
    <div className="wallet">
      {noWallet ? <span className="tone-error">Install MetaMask or Rabby first.</span> : null}
      <button className="primary" disabled={isPending} onClick={() => {
        if (!(window as unknown as { ethereum?: unknown }).ethereum) { setNoWallet(true); return; }
        connect({ connector: connectors[0] });
      }}>Connect wallet</button>
    </div>
  );
}

const MAX_PLAYER_MARKETS = 60;

export default function Home() {
  const now = useClock();
  const { isConnected, needsSwitch } = useWalletState();
  const board = useBoard(now);
  const balance = useBalance();
  const actions = useActions();
  const history = useHistory();
  const [view, setView] = useState<"markets" | "mine" | "finished">("markets");
  const [review, setReview] = useState<Review | null>(null);
  const [creating, setCreating] = useState(false);
  const [focusId, setFocusId] = useState<bigint | null>(null);
  const createButton = useRef<HTMLButtonElement>(null);
  const closeCreate = useCallback(() => { setCreating(false); createButton.current?.focus(); }, []);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const automatic = useMemo(() => board.data?.automatic ?? [], [board.data]);
  const templates = useMemo(() => sortByPool(board.data?.templates ?? []), [board.data]);
  const settled = board.data?.settled ?? 0;
  const all = useMemo(() => [...automatic.filter((m) => m.status !== 0), ...templates], [automatic, templates]);
  const ids = useMemo(() => all.map((m) => m.id), [all]);
  const positions = usePositions(ids);
  const position = (m: Market) => positions.data?.get(m.id.toString());
  const stageOf = (m: Market) => stage(m.status, m.night, m.pools, settled, now);
  const isDone = (m: Market) => { const s = stageOf(m); return s === "resolved" || s === "void"; };

  const hasBet = (m: Market) => {
    const p = position(m);
    return Boolean(p && (p.stakes.some((x) => x > 0n) || p.sponsored > 0n || p.claimable > 0n));
  };
  const tonight = board.data?.tonight ?? null;
  const running = automatic.filter((m) => m.id !== tonight?.id && m.status !== 0 && !isDone(m));
  const playerOpen = templates.filter((m) => !isDone(m)).slice(0, MAX_PLAYER_MARKETS);
  const finished = all.filter(isDone);
  const mine = all.filter(hasBet);
  const claimableTotal = [...(positions.data?.values() ?? [])].reduce((sum, p) => sum + p.claimable, 0n);
  const openableNights = useMemo(() => new Set(automatic.filter((m) => m.status !== 0).map((m) => m.night)), [automatic]);
  const openNight = (night: number) => {
    const m = automatic.find((x) => x.night === night);
    if (!m) return;
    setView(isDone(m) ? "finished" : "markets");
    setFocusId(m.id);
  };
  // Runs after the right tab has rendered, so the card exists to scroll to.
  useEffect(() => {
    if (focusId === null) return;
    setFocusId(null);
    const card = document.getElementById(`market-${focusId}`);
    if (!card) return;
    card.scrollIntoView({ block: "start" });
    card.dataset.flash = "true";
    setTimeout(() => { delete card.dataset.flash; }, 1800);
  }, [focusId, view]);
  const closeReview = useCallback(() => setReview(null), []);
  const { message } = actions;
  const panelProps = { settled, now, balance: balance.data, actions, coreAddress: board.data?.coreAddress as Address, blocked: !board.data?.genuine, ask: setReview };
  const panel = (m: Market) => <MarketPanel key={m.id.toString()} market={m} position={position(m)} {...panelProps} />;

  return (
    <div className="page">
      <header className="top">
        <div className="brand"><span className="logo" aria-hidden="true">🐹</span><div><div className="brand-line"><h1>Squeek Markets</h1><span className="pill auto">Unofficial</span></div><p>Call how far a real hamster runs tonight.</p></div></div>
        {mounted ? <WalletButton balance={balance.data} /> : null}
      </header>
      <div className="intro">
        <ol className="steps"><li>Pick a range</li><li>Bet SQK</li><li>Claim if he hits it</li></ol>
        <a className="get-sqk" href={GET_SQK_URL} target="_blank" rel="noopener">Get SQK ↗</a>
      </div>
      <p className="banner">Sepolia testnet only. Testnet SQK has no monetary value. Unofficial community project. Contract not independently audited.</p>

      <Stats now={now} tonight={board.data?.tonight ?? null} logs={history.data} />
      <Live now={now} />

      {mounted && needsSwitch ? <p className="notice tone-error" role="alert">Your wallet is on the wrong network. This site only works on Sepolia, so switch to Sepolia to play.</p> : null}

      {message ? (
        <p className="message" data-tone={message.tone} role="status">
          {message.text}{message.tx ? <> <a href={`${EXPLORER}/tx/${message.tx}`} target="_blank" rel="noopener">See it ↗</a></> : null}
        </p>
      ) : null}

      {!IS_DEPLOYED ? (
        <p className="notice">The market contract isn’t deployed yet. The wheel above is live; markets appear here once it is.</p>
      ) : board.isError ? (
        <p className="notice tone-error">Couldn’t read the market contract. Check your connection and try again.</p>
      ) : board.data && !board.data.genuine ? (
        <p className="notice tone-error">Warning: this contract isn’t bound to the real SQK and SqueekCore. Don’t bet here.</p>
      ) : null}

      <main className="col-main">
        {claimableTotal > 0n ? <button className="claim-banner" onClick={() => setView("mine")}>You have {sqk(claimableTotal)} SQK to claim →</button> : null}
        <div className="tabs" role="tablist">
          {(["markets", "mine", "finished"] as const).map((key) => (
            <button key={key} role="tab" aria-selected={view === key} onClick={() => setView(key)}>{key === "markets" ? "Markets" : key === "mine" ? "My bets" : "Finished"}</button>
          ))}
        </div>

        {view === "markets" ? (
          <>
            {IS_DEPLOYED ? <RecentNights now={now} openable={openableNights} onOpen={openNight} /> : null}
            {tonight && board.data ? panel(tonight) : <p className="empty">{IS_DEPLOYED ? "Reading the chain…" : "Tonight’s market will appear here."}</p>}
            {running.length ? (
              <section aria-labelledby="running-title">
                <h2 className="section-title" id="running-title">Earlier nights still running</h2>
                <div className="market-grid">{running.map(panel)}</div>
              </section>
            ) : null}
            <section aria-labelledby="player-title">
              <div className="section-head">
                <h2 className="section-title" id="player-title">Player markets</h2>
                {IS_DEPLOYED && now ? <button type="button" ref={createButton} className="primary" onClick={() => setCreating(true)}>+ Create market</button> : null}
              </div>
              {playerOpen.length ? <div className="market-grid">{playerOpen.map(panel)}</div> : <p className="empty">No player markets yet. Create the first one.</p>}
            </section>
          </>
        ) : null}
        {view === "mine" ? (mine.length ? <div className="market-grid">{mine.map(panel)}</div> : <p className="empty">{isConnected ? "No bets yet." : "Connect a wallet to see your bets."}</p>) : null}
        {view === "finished" ? (finished.length ? <div className="market-grid">{finished.map(panel)}</div> : <p className="empty">Nothing has finished yet.</p>) : null}

        <Flow now={now} genuine={board.data?.genuine} claimable={claimableTotal} logs={history.data} />
        <Activity logs={history.data} isLoading={history.isLoading} isError={history.isError} />
        <Leaderboard />
        <Rules now={now} />
      </main>
      <footer className="site-footer"><p>{TESTNET_NOTICE}</p></footer>
      {creating ? <CreateMarket now={now} balance={balance.data} actions={actions} blocked={!board.data?.genuine} ask={setReview} covered={review !== null} onClose={closeCreate} /> : null}
      {review ? <ReviewDialog review={review} onClose={closeReview} /> : null}
    </div>
  );
}
