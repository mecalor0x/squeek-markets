"use client";
import { CORE_ADDRESS, EXPLORER, MARKETS_ADDRESS, MM_PER_WORK } from "@/lib/config";
import { closesAt, currentNight, localClock } from "@/lib/markets";

/** Everything the rules say, in one closed section. Each fact appears once. */
export function Rules({ now }: { now: number }) {
  const local = now ? localClock(closesAt(currentNight(now))) : null;
  return (
    <details className="panel rules">
      <summary>Rules &amp; verification</summary>
      <h3>How it’s measured</h3>
      <ul className="how">
        <li><b>A lap is one wheel-magnet passage.</b> A sensor on Squeektoshi’s WHEELY9000 counts each accepted pass as one unit of work.</li>
        <li><b>Laps are settled in 10-minute rounds.</b> The device’s records are signed and written to SqueekCore on Ethereum. Rounds with no running are recorded as zero.</li>
        <li><b>A night runs from 12:00 to 12:00 UTC{local ? ` (${local} to ${local} your time)` : ""},</b> the same 24 hours the wheel’s device counts, which is 144 rounds.</li>
        <li><b>A night’s result is one subtraction:</b> SqueekCore’s lap total at the night’s last round, minus its total at the round before the night began.</li>
        <li><b>Kilometres are only a guide.</b> We show about {MM_PER_WORK} mm per lap, from the device’s reports so far. Markets settle on laps.</li>
      </ul>
      <h3>Bets and payouts</h3>
      <ul className="how">
        <li><b>This is a parimutuel pool, not an order book.</b> Winnings come from other players’ bets. Nothing is created.</li>
        <li><b>Everyone on the winning outcome shares the pool by stake,</b> after 2% is burned.</li>
        <li><b>Betting closes when the night begins,</b> so nobody can bet on what they’ve already seen.</li>
        <li><b>Refunds:</b> if bets cover fewer than two outcomes or nobody picked the winner, everyone gets their full stake back.</li>
        <li>If SqueekCore stops settling or returns inconsistent data, every market refunds in full 7 days after the night ends.</li>
      </ul>
      <h3>Verification and trust</h3>
      <ul className="how">
        <li><b>Anyone can settle a market,</b> and anyone can check the result with “Check it yourself” on its card. No server or admin decides it.</li>
        <li><b>We hold no keys to it.</b> The contract has no owner, no pause, no upgrades and no fee for us.</li>
        <li><b>You still trust Squeekchain’s data.</b> Its signer reports the rounds, and its Core contract can be upgraded through a public timelock.</li>
        <li><b>People near the hamster could affect him.</b> He’s a real animal, so treat this as a game.</li>
      </ul>
      <p className="small">
        Contracts: <a href={`${EXPLORER}/address/${MARKETS_ADDRESS}`} target="_blank" rel="noopener">Squeek Markets</a> · <a href={`${EXPLORER}/address/${CORE_ADDRESS}`} target="_blank" rel="noopener">SqueekCore</a>. You need Sepolia SQK and a little Sepolia ETH to play.
      </p>
    </details>
  );
}
