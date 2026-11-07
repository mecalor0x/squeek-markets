// How the site pays for a bet. A signature or approval never allows more than this one bet's amount.
import { getAddress, type Address, type Hash, type Hex } from "viem";
import { CHAIN_ID, SQK_ADDRESS } from "./config";

/** A signed permit stops working after this long. */
export const PERMIT_SECONDS = 600;
const PERMIT_VERSION = "1";

export function permitTypedData(input: { tokenName: string; owner: Address; spender: Address; amount: bigint; nonce: bigint; nowSeconds: number }) {
  return {
    domain: { name: input.tokenName, version: PERMIT_VERSION, chainId: CHAIN_ID, verifyingContract: getAddress(SQK_ADDRESS) },
    types: { Permit: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }, { name: "value", type: "uint256" }, { name: "nonce", type: "uint256" }, { name: "deadline", type: "uint256" }] },
    primaryType: "Permit" as const,
    message: { owner: input.owner, spender: input.spender, value: input.amount, nonce: input.nonce, deadline: BigInt(input.nowSeconds + PERMIT_SECONDS) },
  };
}

export const isWalletRejection = (error: unknown) => (error as { code?: number })?.code === 4001 || /rejected|denied/i.test(String((error as Error)?.message));

type PaySteps = {
  amount: bigint;
  readAllowance: () => Promise<bigint>;
  /** Asks the wallet for a permit signature. */
  sign: () => Promise<{ deadline: bigint; signature: Hex }>;
  /** Sets the allowance to exactly this value. */
  approve: (value: bigint) => Promise<unknown>;
  direct: () => Promise<Hash>;
  permitted: (deadline: bigint, signature: Hex) => Promise<Hash>;
};

/**
 * Uses a permit when the wallet can sign one, otherwise an approval of exactly the amount.
 * Falls back only when signing fails. Once a signed transaction has been tried, a failure is reported
 * instead of retried, because a slow confirmation must never turn into a second bet.
 */
export async function payExactly({ amount, readAllowance, sign, approve, direct, permitted }: PaySteps) {
  if ((await readAllowance()) >= amount) return direct();
  let signed: { deadline: bigint; signature: Hex };
  try {
    signed = await sign();
  } catch (error) {
    if (isWalletRejection(error)) throw error;
    await approve(amount);
    return direct();
  }
  return permitted(signed.deadline, signed.signature);
}
