import { describe, expect, it, vi } from "vitest";
import { hashDomain, recoverTypedDataAddress, type Hash, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { CHAIN_ID, CORE_ADDRESS, MARKETS_ADDRESS, RPC_URLS, SQK_ADDRESS } from "../src/lib/config";
import { PERMIT_SECONDS, payExactly, permitTypedData } from "../src/lib/permit";

const SPENDER = "0x00000000000000000000000000000000000000AA" as const;
const owner = privateKeyToAccount(generatePrivateKey());
const data = (amount = 25n, nowSeconds = 1000) => permitTypedData({ tokenName: "Squeek", owner: owner.address, spender: SPENDER, amount, nonce: 7n, nowSeconds });

describe("addresses", () => {
  it("are the published Sepolia ones", () => {
    expect(CHAIN_ID).toBe(11155111);
    expect(SQK_ADDRESS).toBe("0xd78a3956cF63164d1Fa1C622ad3c66623162Fa1e");
    expect(CORE_ADDRESS).toBe("0xFD6C166D4B8E2962E65746a13e5a0797CD4dE0c4");
    expect(MARKETS_ADDRESS).toMatch(/^0x[0-9a-fA-F]{40}$/);
  });
  it("has more than one RPC", () => {
    expect(new Set(RPC_URLS).size).toBeGreaterThanOrEqual(3);
  });
});

describe("permit", () => {
  it("has the same domain as the real SQK contract", () => {
    const { domain, types } = data();
    expect(domain.chainId).toBe(11155111);
    expect(domain.verifyingContract).toBe(SQK_ADDRESS);
    // DOMAIN_SEPARATOR() read from SQK on Sepolia. The fork test proves the same fields on-chain.
    expect(hashDomain({ domain: { ...domain, chainId: BigInt(domain.chainId) }, types: { ...types, EIP712Domain: [{ name: "name", type: "string" }, { name: "version", type: "string" }, { name: "chainId", type: "uint256" }, { name: "verifyingContract", type: "address" }] } })).toBe("0x2cc99df9c423e838a7b45ff60b5ee38ad122ea209dca8da37a8d2f3befdf0017");
  });
  it("allows exactly the amount, for 10 minutes", () => {
    const { message } = data(25n, 1000);
    expect(PERMIT_SECONDS).toBe(600);
    expect(message.value).toBe(25n);
    expect(message.deadline).toBe(1600n);
    expect(message.spender).toBe(SPENDER);
  });
  it("produces a signature that recovers to the signer", async () => {
    const typed = data();
    const signature = await owner.signTypedData(typed);
    expect(await recoverTypedDataAddress({ ...typed, signature })).toBe(owner.address);
  });
});

describe("paying for a bet", () => {
  const steps = (over = {}) => ({
    amount: 25n,
    readAllowance: vi.fn(async () => 0n),
    sign: vi.fn(async () => ({ deadline: 1n, signature: "0xaa" as Hex })),
    approve: vi.fn(async () => "0xapprove"),
    direct: vi.fn(async () => "0xdirect" as Hash),
    permitted: vi.fn(async () => "0xpermit" as Hash),
    ...over,
  });
  it("prefers a permit and approves nothing", async () => {
    const s = steps();
    await expect(payExactly(s)).resolves.toBe("0xpermit");
    expect(s.approve).not.toHaveBeenCalled();
    expect(s.direct).not.toHaveBeenCalled();
  });
  it("falls back to approving exactly the bet amount when the wallet can't sign", async () => {
    const order: string[] = [];
    const s = steps({
      sign: vi.fn(async () => { throw new Error("eth_signTypedData_v4 is not supported"); }),
      approve: vi.fn(async () => { order.push("approve"); }),
      direct: vi.fn(async () => { order.push("bet"); return "0xdirect" as Hash; }),
    });
    await expect(payExactly(s)).resolves.toBe("0xdirect");
    expect(s.approve).toHaveBeenCalledTimes(1);
    expect(s.approve).toHaveBeenCalledWith(25n);
    expect(order).toEqual(["approve", "bet"]);
    expect(s.permitted).not.toHaveBeenCalled();
  });
  it("doesn't approve when the player cancels the signature", async () => {
    const s = steps({ sign: vi.fn(async () => { throw Object.assign(new Error("User rejected the request."), { code: 4001 }); }) });
    await expect(payExactly(s)).rejects.toThrow(/rejected/);
    expect(s.approve).not.toHaveBeenCalled();
    expect(s.direct).not.toHaveBeenCalled();
  });
  it("never bets twice when a signed transaction fails or is slow to confirm", async () => {
    const s = steps({ permitted: vi.fn(async () => { throw new Error("Timed out while waiting for transaction"); }) });
    await expect(payExactly(s)).rejects.toThrow(/Timed out/);
    expect(s.approve).not.toHaveBeenCalled();
    expect(s.direct).not.toHaveBeenCalled();
  });
  it("uses an existing allowance without asking for more", async () => {
    const s = steps({ readAllowance: vi.fn(async () => 25n) });
    await expect(payExactly(s)).resolves.toBe("0xdirect");
    expect(s.sign).not.toHaveBeenCalled();
    expect(s.approve).not.toHaveBeenCalled();
  });
});
