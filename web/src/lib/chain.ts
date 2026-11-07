"use client";
// Reads and writes against the contracts. Everything shown about a market comes straight from the chain.
import { useCallback, useEffect, useState } from "react";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { BaseError, ContractFunctionRevertedError, getAddress, parseAbi, parseSignature, type Address, type Hash, type Hex, type PublicClient } from "viem";
import { useAccount, usePublicClient, useWalletClient } from "wagmi";
import { marketsAbi } from "./abi.generated";
import { DEPLOY_BLOCK, CHAIN_ID, EXPECT_CORE, IS_DEPLOYED, MARKETS_ADDRESS, SQK_ADDRESS, STATUS_API, USE_CHAIN_CLOCK, tokenAbi } from "./config";
import type { ChainLog } from "./activity";
import { ROUNDS_PER_NIGHT, beforeLaunch, currentNight, finishedNights, roundLaps, roundsOf } from "./markets";
import { payExactly, permitTypedData } from "./permit";
import { fetchWheel } from "./wheel";

export type Market = {
  id: bigint; night: number; isTemplate: boolean; outcomeCount: number; status: number; winner: number; threshold: number;
  laps: number; before: number; atEnd: number; pools: bigint[]; sponsored: bigint; payoutPool: bigint;
};
export type Position = { stakes: bigint[]; sponsored: bigint; claimable: bigint };

const coreAbi = parseAbi([
  "function state() view returns ((uint64 settledThroughRound, uint64 cumulativeWork, uint96 cumulativeBlockUnits, uint64 blockHeight, uint96 blockProgress, uint32 workPerThousandBlocks, uint256 authorizationNonce, bool paused))",
  "function roundPage(uint64 afterRound, uint64 throughRound, uint256 maxRecords) view returns ((uint64 certifiedThroughRound, (uint64 cumulativeWork, uint96 cumulativeBlockUnits, uint32 workPerThousandBlocks) start, (uint64 cumulativeWork, uint96 cumulativeBlockUnits, uint32 workPerThousandBlocks) end, (uint64 roundId, uint64 cumulativeWork, uint96 cumulativeBlockUnits, uint32 workPerThousandBlocks, bytes32 dataHash)[] rounds))",
]);
const contract = { address: MARKETS_ADDRESS, abi: marketsAbi } as const;
const MAX_READ = 200;

export function useClock() {
  const client = usePublicClient({ chainId: CHAIN_ID });
  // Starts at zero so the prebuilt page and the first browser render match; the real time follows at once.
  const [now, setNow] = useState(0);
  const [skew, setSkew] = useState(0);
  useEffect(() => {
    const tick = () => setNow(Math.floor(Date.now() / 1000) + skew);
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [skew]);
  useEffect(() => {
    if (!USE_CHAIN_CLOCK || !client) return undefined;
    const sync = () => client.getBlock().then((block) => setSkew(Number(block.timestamp) - Math.floor(Date.now() / 1000))).catch(() => {});
    sync();
    const timer = setInterval(sync, 3000);
    return () => clearInterval(timer);
  }, [client]);
  return now;
}

export function useWheel() {
  return useQuery({ queryKey: ["wheel"], refetchInterval: 5000, retry: 1, queryFn: () => fetchWheel(STATUS_API) });
}

/** Whether this wallet can send anything right now. */
export function useWalletState() {
  const { isConnected, chainId } = useAccount();
  const rightNetwork = chainId === CHAIN_ID;
  return { isConnected, rightNetwork, ready: isConnected && rightNetwork, needsSwitch: isConnected && !rightNetwork };
}

const HISTORY_NIGHTS = 21;

function toMarket(id: bigint, night: number, row: unknown): Market {
  const m = row as Record<string, unknown>;
  const pools = [...(m.pools as readonly bigint[])];
  const isTemplate = Boolean(m.isTemplate);
  return {
    id, night: Number(m.status) === 0 ? night : Number(m.night), isTemplate, outcomeCount: Number(m.status) === 0 ? 5 : Number(m.outcomeCount),
    status: Number(m.status), winner: Number(m.winner), threshold: Number(m.threshold), laps: Number(m.laps), before: Number(m.positionBefore), atEnd: Number(m.positionAtEnd),
    pools: pools.slice(0, Number(m.status) === 0 ? 5 : Number(m.outcomeCount)), sponsored: m.sponsored as bigint, payoutPool: m.payoutPool as bigint,
  };
}

export function useBoard(now: number) {
  const client = usePublicClient({ chainId: CHAIN_ID });
  const night = now ? currentNight(now) : 0;
  return useQuery({
    queryKey: ["board", night],
    enabled: Boolean(client) && IS_DEPLOYED && night > 0,
    refetchInterval: 15000,
    queryFn: async () => {
      const c = client as PublicClient;
      const [tokenAddress, coreAddress, count] = await Promise.all([
        c.readContract({ ...contract, functionName: "token" }),
        c.readContract({ ...contract, functionName: "core" }),
        c.readContract({ ...contract, functionName: "templateCount" }),
      ]);
      // Refuses to look trustworthy if the configured contract isn't bound to the real SQK and SqueekCore.
      const rpcChain = await c.getChainId();
      const genuine = rpcChain === CHAIN_ID && getAddress(tokenAddress) === SQK_ADDRESS && getAddress(coreAddress) === EXPECT_CORE;
      const state = await c.readContract({ address: coreAddress, abi: coreAbi, functionName: "state" });

      const total = Number(count);
      const templateIndexes = Array.from({ length: Math.min(total, MAX_READ) }, (_, i) => BigInt(total - 1 - i));
      const templateIds = templateIndexes.length
        ? (await c.multicall({ allowFailure: false, contracts: templateIndexes.map((i) => ({ ...contract, functionName: "templateMarkets" as const, args: [i] })) })) as bigint[]
        : [];
      const nights = Array.from({ length: HISTORY_NIGHTS }, (_, i) => night - i);
      const rows = await c.multicall({ allowFailure: false, contracts: [...nights.map((n) => BigInt(n)), ...templateIds].map((id) => ({ ...contract, functionName: "getMarket" as const, args: [id] })) });
      const automatic = nights.map((n, i) => toMarket(BigInt(n), n, rows[i]));
      const templates = templateIds.map((id, i) => toMarket(id, 0, rows[nights.length + i]));
      return { automatic, templates, tonight: automatic[0], settled: Number(state.settledThroughRound), genuine, coreAddress };
    },
  });
}

/** Read from SqueekCore itself, so it doesn't depend on the market contract being deployed or reachable. */
export function useCoreStatus() {
  const client = usePublicClient({ chainId: CHAIN_ID });
  return useQuery({
    queryKey: ["core-status"],
    enabled: Boolean(client),
    refetchInterval: 30000,
    queryFn: async () => {
      const state = await (client as PublicClient).readContract({ address: EXPECT_CORE, abi: coreAbi, functionName: "state" });
      return { settled: Number(state.settledThroughRound), paused: state.paused };
    },
  });
}

export type NightResult = { night: number; state: "certified" | "pending" | "before"; laps: number };

/** The last finished nights, each read through the contract's readResult. It reverts until a night is fully certified. */
export function useRecentNights(now: number) {
  const client = usePublicClient({ chainId: CHAIN_ID });
  const nights = now ? finishedNights(now) : [];
  return useQuery({
    queryKey: ["recent-nights", nights[0]],
    enabled: Boolean(client) && IS_DEPLOYED && nights.length > 0,
    refetchInterval: 60000,
    queryFn: async (): Promise<NightResult[]> => {
      const onChain = nights.filter((night) => !beforeLaunch(night));
      const rows = onChain.length ? await (client as PublicClient).multicall({ allowFailure: true, contracts: onChain.map((night) => ({ ...contract, functionName: "readResult" as const, args: [BigInt(night)] })) }) : [];
      return nights.map((night) => {
        if (beforeLaunch(night)) return { night, state: "before", laps: 0 };
        const row = rows[onChain.indexOf(night)];
        return row.status === "success" ? { night, state: "certified", laps: Number((row.result as readonly bigint[])[0]) } : { night, state: "pending", laps: 0 };
      });
    },
  });
}

/** What the contract quotes for betting this amount on each outcome, at the pools as they stand. */
export function useQuotes(marketId: bigint, outcomes: number[], amount: bigint | undefined, poolKey: string) {
  const client = usePublicClient({ chainId: CHAIN_ID });
  return useQuery({
    queryKey: ["quotes", marketId.toString(), outcomes.join(","), amount?.toString(), poolKey],
    enabled: Boolean(client) && IS_DEPLOYED && amount !== undefined && outcomes.length > 0,
    // Keeps the last numbers on screen while the next ones load, so typing a stake doesn't make them flicker.
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const quotes = await (client as PublicClient).multicall({ allowFailure: false, contracts: outcomes.map((outcome) => ({ ...contract, functionName: "quote" as const, args: [marketId, outcome, amount as bigint] })) });
      return { amount: amount as bigint, byOutcome: new Map(outcomes.map((outcome, i) => [outcome, quotes[i] as bigint])) };
    },
  });
}

/** One night's result through the contract, for a market that can be settled. */
export function useNightResult(night: number, enabled: boolean) {
  const client = usePublicClient({ chainId: CHAIN_ID });
  return useQuery({
    queryKey: ["night-result", night],
    enabled: enabled && Boolean(client) && IS_DEPLOYED,
    queryFn: async () => Number((await (client as PublicClient).readContract({ ...contract, functionName: "readResult", args: [BigInt(night)] }))[0]),
  });
}

export function useBalance() {
  const { address } = useAccount();
  const client = usePublicClient({ chainId: CHAIN_ID });
  return useQuery({
    queryKey: ["balance", address],
    enabled: Boolean(client && address),
    refetchInterval: 15000,
    queryFn: () => (client as PublicClient).readContract({ address: SQK_ADDRESS, abi: tokenAbi, functionName: "balanceOf", args: [address as Address] }),
  });
}

export function usePositions(ids: bigint[]) {
  const { address } = useAccount();
  const client = usePublicClient({ chainId: CHAIN_ID });
  return useQuery({
    queryKey: ["positions", address, ids.join(",")],
    enabled: Boolean(client && address) && ids.length > 0,
    refetchInterval: 15000,
    queryFn: async () => {
      const player = address as Address;
      const calls = ids.flatMap((id) => (["stakesOf", "sponsorStake", "claimable"] as const).map((functionName) => ({ ...contract, functionName, args: [id, player] })));
      const results = (await (client as PublicClient).multicall({ allowFailure: false, contracts: calls as never })) as unknown[];
      const map = new Map<string, Position>();
      ids.forEach((id, i) => map.set(id.toString(), { stakes: [...(results[i * 3] as readonly bigint[])], sponsored: results[i * 3 + 1] as bigint, claimable: results[i * 3 + 2] as bigint }));
      return map;
    },
  });
}

/** Reads a night's laps two ways so a player can see they agree: straight from SqueekCore, and through this contract. */
export async function verifyNight(client: PublicClient, night: number, coreAddress: Address) {
  const { startRound, endRound } = roundsOf(night);
  const point = async (round: number) => (await client.readContract({ address: coreAddress, abi: coreAbi, functionName: "roundPage", args: [BigInt(round), BigInt(round), 0n] })).end.cumulativeWork;
  const before = await point(startRound - 1);
  const atEnd = await point(endRound);
  const [contractLaps] = await client.readContract({ ...contract, functionName: "readResult", args: [BigInt(night)] });
  return { before, atEnd, laps: atEnd - before, contractLaps, startRound, endRound };
}

export async function templateExists(client: PublicClient, night: number, threshold: number) {
  const id = await client.readContract({ ...contract, functionName: "templateId", args: [BigInt(night), BigInt(threshold)] });
  const market = await client.readContract({ ...contract, functionName: "getMarket", args: [id] });
  return Number((market as { status: number }).status) !== 0;
}

const LOG_CHUNK = 5000n;
// Recent blocks can still be replaced, so they're read again each time.
const REORG_SAFETY = 64n;
// History only grows: remembering it means each refresh reads just the new blocks, which keeps public RPCs happy.
const history: { logs: ChainLog[]; next: bigint } = { logs: [], next: DEPLOY_BLOCK };

/** Every event the contract has ever emitted, oldest first. */
export function useHistory() {
  const client = usePublicClient({ chainId: CHAIN_ID });
  return useQuery({
    queryKey: ["history"],
    enabled: Boolean(client) && IS_DEPLOYED,
    refetchInterval: 30000,
    queryFn: async (): Promise<ChainLog[]> => {
      const c = client as PublicClient;
      const latest = await c.getBlockNumber();
      const fresh: ChainLog[] = [];
      for (let from = history.next; from <= latest; from += LOG_CHUNK) {
        const to = from + LOG_CHUNK - 1n < latest ? from + LOG_CHUNK - 1n : latest;
        const logs = await c.getContractEvents({ ...contract, fromBlock: from, toBlock: to });
        fresh.push(...(logs as unknown as ChainLog[]));
      }
      const start = history.next;
      const all = [...history.logs.filter((log) => log.blockNumber < start), ...fresh];
      const safe = latest > REORG_SAFETY ? latest - REORG_SAFETY : 0n;
      if (safe > history.next) { history.next = safe; history.logs = all.filter((log) => log.blockNumber < safe); }
      return all;
    },
  });
}

/** When each block happened. Only asked for the rows on screen. */
export function useBlockTimes(blocks: bigint[]) {
  const client = usePublicClient({ chainId: CHAIN_ID });
  const unique = [...new Set(blocks)];
  return useQuery({
    queryKey: ["block-times", unique.join(",")],
    enabled: Boolean(client) && unique.length > 0,
    staleTime: Infinity,
    queryFn: async () => {
      const found = await Promise.all(unique.map((blockNumber) => (client as PublicClient).getBlock({ blockNumber })));
      return new Map(found.map((block) => [block.number, Number(block.timestamp)]));
    },
  });
}

/** How far the running night has got: certified by SqueekCore so far, and where it started. */
export function useNightProgress(night: number, settled: number | undefined) {
  const client = usePublicClient({ chainId: CHAIN_ID });
  const before = night ? roundsOf(night).startRound - 1 : 0;
  return useQuery({
    queryKey: ["night-progress", night, settled],
    enabled: Boolean(client) && settled !== undefined && night > 0 && before >= 0 && (settled as number) >= before,
    queryFn: async () => {
      const point = async (round: number) => Number((await (client as PublicClient).readContract({ address: EXPECT_CORE, abi: coreAbi, functionName: "roundPage", args: [BigInt(round), BigInt(round), 0n] })).end.cumulativeWork);
      const [start, certified] = await Promise.all([point(before), point(settled as number)]);
      return { start, certified };
    },
  });
}

// SqueekCore refuses larger pages.
const ROUND_PAGE = 16n;

/** The rounds of the last seven nights' span. SqueekCore only lists rounds with running, so the rest are zero. */
export function useRecentRounds(settled: number | undefined, enabled: boolean) {
  const client = usePublicClient({ chainId: CHAIN_ID });
  return useQuery({
    queryKey: ["recent-rounds", settled],
    enabled: enabled && Boolean(client) && Boolean(settled),
    queryFn: async () => {
      const through = settled as number;
      const after = Math.max(0, through - ROUNDS_PER_NIGHT * 7);
      const records: { round: number; cumulative: number }[] = [];
      let first: number | null = null;
      let cursor = BigInt(after);
      while (cursor < BigInt(through)) {
        const page = await (client as PublicClient).readContract({ address: EXPECT_CORE, abi: coreAbi, functionName: "roundPage", args: [cursor, BigInt(through), ROUND_PAGE] });
        first ??= Number(page.start.cumulativeWork);
        records.push(...page.rounds.map((r) => ({ round: Number(r.roundId), cumulative: Number(r.cumulativeWork) })));
        if (page.certifiedThroughRound <= cursor) break;
        cursor = page.certifiedThroughRound;
      }
      return { after, through, laps: roundLaps(first ?? 0, records) };
    },
  });
}

const ERROR_TEXT: Record<string, string> = {
  BettingClosed: "Betting on this night has closed.",
  BettingOpen: "This night hasn't started yet, so it can't be settled.",
  StakeTooSmall: "The minimum is 1 SQK.",
  CreatorBetTooSmall: "To open a market, your first bet must be at least 10 SQK.",
  NotSettled: "SqueekCore hasn't certified this whole night yet. Try again soon.",
  NothingToClaim: "There's nothing for you to claim here.",
  NotFinal: "This market hasn't finished yet.",
  AlreadyFinal: "This market is already settled.",
  DuplicateMarket: "That market already exists. Find it in the market list.",
  NightUnavailable: `You can only use the next 7 nights.`,
  InvalidThreshold: "Laps must be between 1 and 100,000.",
  InvalidOutcome: "Pick one of the options shown.",
  UnknownMarket: "That market doesn't exist.",
  NotEnoughGas: "The transaction needs more gas. Try again from your wallet.",
  ERC20InsufficientBalance: "You don't have enough SQK.",
  ERC20InsufficientAllowance: "The SQK approval didn't go through. Try again.",
};

export function explainError(error: unknown) {
  if (error instanceof BaseError) {
    const revert = error.walk((e) => e instanceof ContractFunctionRevertedError);
    if (revert instanceof ContractFunctionRevertedError && revert.data?.errorName) return ERROR_TEXT[revert.data.errorName] ?? "The contract refused that. Refresh and try again.";
    if (error.walk((e) => (e as { code?: number }).code === 4001) || /rejected|denied/i.test(error.message)) return "You cancelled it in your wallet. Nothing was sent.";
    if (/insufficient funds/i.test(error.message)) return "You need a little Sepolia ETH to pay for gas.";
    if (/fetch|network|timeout|http request/i.test(error.message)) return "Couldn't reach Sepolia. Check your connection and try again.";
    return "That didn't go through. Nothing was changed. Try again.";
  }
  const text = error instanceof Error ? error.message : "";
  if (/rejected|denied/i.test(text)) return "You cancelled it in your wallet. Nothing was sent.";
  return text.length > 0 && text.length < 120 ? text : "Something went wrong. Please try again.";
}

/** Every write simulates first, so a transaction that would revert never reaches the wallet. */
export function useActions() {
  const { address, chainId: walletChain } = useAccount();
  const client = usePublicClient({ chainId: CHAIN_ID }) as PublicClient;
  const { data: wallet, refetch: refetchWallet } = useWalletClient({ chainId: CHAIN_ID });
  // Asking for this client on the wrong network fails, and that failure would stay cached after switching to Sepolia.
  useEffect(() => { if (address) refetchWallet(); }, [address, walletChain, refetchWallet]);
  const queries = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ text: string; tone: "good" | "error" | "info"; tx?: Hex } | null>(null);

  const send = useCallback(async (request: Record<string, unknown>) => {
    if (!wallet || !address) throw new Error("Connect your wallet on Sepolia first.");
    if ((await wallet.getChainId()) !== CHAIN_ID) throw new Error("Switch your wallet to Sepolia first.");
    const { request: prepared } = await client.simulateContract({ ...request, account: address } as never);
    const hash = await wallet.writeContract(prepared as never);
    setMessage({ text: "Waiting for Sepolia to confirm…", tone: "info", tx: hash });
    const receipt = await client.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error("The transaction reverted.");
    return hash;
  }, [address, client, wallet]);

  const run = useCallback(async (label: string, done: string, action: () => Promise<Hex>) => {
    setBusy(label);
    setMessage({ text: label, tone: "info" });
    try {
      const tx = await action();
      setMessage({ text: done, tone: "good", tx });
      await queries.invalidateQueries();
    } catch (error) {
      setMessage({ text: explainError(error), tone: "error" });
    } finally {
      setBusy(null);
    }
  }, [queries]);

  const pay = useCallback((amount: bigint, direct: () => Promise<Hash>, permitted: (deadline: bigint, v: number, r: Hex, s: Hex) => Promise<Hash>) => {
    if (!wallet || !address) throw new Error("Connect your wallet on Sepolia first.");
    return payExactly({
      amount,
      direct,
      readAllowance: () => client.readContract({ address: SQK_ADDRESS, abi: tokenAbi, functionName: "allowance", args: [address, MARKETS_ADDRESS] }),
      sign: async () => {
        if ((await wallet.getChainId()) !== CHAIN_ID) throw Object.assign(new Error("Rejected: switch your wallet to Sepolia first."), { code: 4001 });
        const [tokenName, nonce] = await Promise.all([
          client.readContract({ address: SQK_ADDRESS, abi: tokenAbi, functionName: "name" }),
          client.readContract({ address: SQK_ADDRESS, abi: tokenAbi, functionName: "nonces", args: [address] }),
        ]);
        const typed = permitTypedData({ tokenName, owner: address, spender: MARKETS_ADDRESS, amount, nonce, nowSeconds: Math.floor(Date.now() / 1000) });
        return { deadline: typed.message.deadline, signature: await wallet.signTypedData({ account: address, ...typed }) };
      },
      approve: (value) => send({ address: SQK_ADDRESS, abi: tokenAbi, functionName: "approve", args: [MARKETS_ADDRESS, value] }),
      permitted: (deadline, signature) => {
        const { r, s, v, yParity } = parseSignature(signature);
        return permitted(deadline, Number(v ?? BigInt(yParity + 27)), r, s);
      },
    });
  }, [address, client, send, wallet]);

  const placeBet = useCallback((id: bigint, outcome: number, amount: bigint) => run("Check your wallet…", "Your bet is in.", () => pay(
    amount,
    () => send({ ...contract, functionName: "bet", args: [id, outcome, amount] }),
    (deadline, v, r, s) => send({ ...contract, functionName: "betWithPermit", args: [id, outcome, amount, deadline, v, r, s] }),
  )), [pay, run, send]);

  const sponsorMarket = useCallback((id: bigint, amount: bigint) => run("Check your wallet…", "Prize added. Thank you!", async () => {
    await send({ address: SQK_ADDRESS, abi: tokenAbi, functionName: "approve", args: [MARKETS_ADDRESS, amount] });
    return send({ ...contract, functionName: "sponsor", args: [id, amount] });
  }), [run, send]);

  const createMarket = useCallback((night: number, threshold: number, outcome: number, amount: bigint) => run("Check your wallet…", "Your market is open and your bet is in.", () => pay(
    amount,
    () => send({ ...contract, functionName: "createMarketWithBet", args: [BigInt(night), BigInt(threshold), outcome, amount] }),
    (deadline, v, r, s) => send({ ...contract, functionName: "createMarketWithBetPermit", args: [BigInt(night), BigInt(threshold), outcome, amount, deadline, v, r, s] }),
  )), [pay, run, send]);

  const resolveMarket = useCallback((id: bigint, refund = false) => run("Check your wallet…", refund ? "Done. Everyone can now claim their full stake back." : "Settled. The result is now on-chain.", () =>
    send({ ...contract, functionName: "resolve", args: [id] })), [run, send]);

  const claimMarket = useCallback((id: bigint) => run("Check your wallet…", "Claimed. The SQK is in your wallet.", () =>
    send({ ...contract, functionName: "claim", args: [id] })), [run, send]);

  return { busy, message, setMessage, placeBet, sponsorMarket, createMarket, resolveMarket, claimMarket };
}
