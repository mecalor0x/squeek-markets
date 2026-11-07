import { getAddress, parseAbi, zeroAddress, type Address } from "viem";

// From https://docs.squeekchain.com/assets/deployments/sepolia.json
export const SQK_ADDRESS: Address = "0xd78a3956cF63164d1Fa1C622ad3c66623162Fa1e";
export const CORE_ADDRESS: Address = "0xFD6C166D4B8E2962E65746a13e5a0797CD4dE0c4";
export const GENESIS_SECONDS = 1793735400;
export const ROUND_SECONDS = 600;
export const CHAIN_ID = 11155111;
export const EXPLORER = "https://eth-sepolia.blockscout.com";
export const GET_SQK_URL = "https://sepolia.squeekchain.com";
export const STATUS_API = "https://api.squeekchain.com/v1/status";
export const MM_PER_WORK = 878; // observed on every recorded day so far; display only, never used to settle

const configured = process.env.NEXT_PUBLIC_MARKETS_ADDRESS;
export const MARKETS_ADDRESS: Address = configured ? getAddress(configured) : zeroAddress;
export const IS_DEPLOYED = MARKETS_ADDRESS !== zeroAddress;
export const DEPLOY_BLOCK = BigInt(process.env.NEXT_PUBLIC_MARKETS_DEPLOY_BLOCK ?? "0");
// Only for the local rehearsal: its chain, its stand-in Core, and a clock that can be moved on to finish a night quickly.
export const IS_REHEARSAL = process.env.NEXT_PUBLIC_CHAIN_CLOCK === "1";
export const USE_CHAIN_CLOCK = IS_REHEARSAL;

const custom = process.env.NEXT_PUBLIC_RPC_URL;
// Tried in order: when one fails, the next takes over.
const PUBLIC_RPCS = ["https://ethereum-sepolia-rpc.publicnode.com", "https://0xrpc.io/sep", "https://1rpc.io/sepolia"];
export const RPC_URLS: string[] = IS_REHEARSAL && custom ? [custom] : [...new Set([...(custom ? [custom] : []), ...PUBLIC_RPCS])];
export const EXPECT_CORE: Address = IS_REHEARSAL && process.env.NEXT_PUBLIC_EXPECT_CORE ? getAddress(process.env.NEXT_PUBLIC_EXPECT_CORE) : CORE_ADDRESS;

export const TESTNET_NOTICE = "Testnet only. SQK has no monetary value.";

export const tokenAbi = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address,address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
  "function nonces(address) view returns (uint256)",
  "function name() view returns (string)",
]);
