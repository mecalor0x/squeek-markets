import { describe, expect, it } from "vitest";
import { demoTraces, parseEnv, settingsProblems } from "../scripts/check-deploy.mjs";

const DEMO = "0xe5be4db589ad3169071535ec5ed2ad90a275782c";
const REAL = "0x1111111111111111111111111111111111111111";

describe("deploy check", () => {
  it("reads env files", () => {
    expect(parseEnv("# note\nA_B=1\nexport C=\"two\"\n\nNOT VALID\n")).toEqual({ A_B: "1", C: "two" });
  });
  it("refuses each demo setting", () => {
    expect(settingsProblems({ NEXT_PUBLIC_CHAIN_CLOCK: "1" })).toHaveLength(1);
    expect(settingsProblems({ NEXT_PUBLIC_EXPECT_CORE: REAL })).toHaveLength(1);
    expect(settingsProblems({ NEXT_PUBLIC_RPC_URL: "http://127.0.0.1:8545" })).toHaveLength(1);
    expect(settingsProblems({ NEXT_PUBLIC_MARKETS_ADDRESS: DEMO.toUpperCase().replace("0X", "0x") }, [DEMO])).toHaveLength(1);
  });
  it("accepts real settings", () => {
    expect(settingsProblems({ NEXT_PUBLIC_MARKETS_ADDRESS: REAL, NEXT_PUBLIC_MARKETS_DEPLOY_BLOCK: "12", NEXT_PUBLIC_RPC_URL: "https://rpc.example.com", NEXT_PUBLIC_CHAIN_CLOCK: "" }, [DEMO])).toEqual([]);
    expect(settingsProblems({})).toEqual([]);
  });
  it("finds demo values in built files, whatever the letter case", () => {
    expect(demoTraces('a="http://127.0.0.1:8545"')).toEqual(["the demo's RPC"]);
    expect(demoTraces(`x="${DEMO.toUpperCase().replace("0X", "0x")}"`, [DEMO])).toEqual([DEMO]);
    expect(demoTraces("0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266")).toHaveLength(1);
    expect(demoTraces(`https://x.com ${REAL}`, [DEMO])).toEqual([]);
  });
});
