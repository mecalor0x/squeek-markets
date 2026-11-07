// Stops a deploy build that still carries anything from the local demo.
//   before: checks the settings the build would use.
//   after:  scans the finished site in out/.
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Anvil's public test accounts funded by the demo.
const TEST_ACCOUNTS = ["0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266", "0x70997970C51812dc3a010C7d01b50e0d17dC79C8"];
const LOCAL_HOST = /(127\.0\.0\.1|localhost|\[::1\]|0\.0\.0\.0)/i;

export function parseEnv(text) {
  const env = {};
  for (const line of text.split("\n")) {
    const match = /^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (match) env[match[1]] = match[2].replace(/^["']|["']$/g, "");
  }
  return env;
}

/** Why these build settings aren't fit to deploy. */
export function settingsProblems(env, demoAddresses = []) {
  const problems = [];
  if (env.NEXT_PUBLIC_CHAIN_CLOCK) problems.push("NEXT_PUBLIC_CHAIN_CLOCK is set, which is the demo's clock");
  if (env.NEXT_PUBLIC_EXPECT_CORE) problems.push("NEXT_PUBLIC_EXPECT_CORE is set, which is the demo's stand-in SqueekCore");
  if (env.NEXT_PUBLIC_RPC_URL && LOCAL_HOST.test(env.NEXT_PUBLIC_RPC_URL)) problems.push("NEXT_PUBLIC_RPC_URL points at this computer");
  const markets = env.NEXT_PUBLIC_MARKETS_ADDRESS?.toLowerCase();
  if (markets && demoAddresses.includes(markets)) problems.push("NEXT_PUBLIC_MARKETS_ADDRESS is a demo contract");
  return problems;
}

/** What in this piece of built site came from the demo. */
export function demoTraces(text, demoAddresses = []) {
  const lower = text.toLowerCase();
  const traces = [];
  if (/(127\.0\.0\.1|localhost):8545/.test(lower)) traces.push("the demo's RPC");
  for (const address of [...TEST_ACCOUNTS.map((a) => a.toLowerCase()), ...demoAddresses]) {
    if (lower.includes(address)) traces.push(address);
  }
  return traces;
}

function knownDemoAddresses(root) {
  const file = new URL("scripts/.demo-addresses", root);
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8").split("\n").map((line) => line.trim().toLowerCase()).filter(Boolean);
}

function textFiles(folder) {
  return readdirSync(folder).flatMap((name) => {
    const path = `${folder}/${name}`;
    if (statSync(path).isDirectory()) return textFiles(path);
    return /\.(html|js|txt|json|css|map)$/.test(name) ? [path] : [];
  });
}

function main(step) {
  const web = new URL("../", import.meta.url);
  const known = knownDemoAddresses(new URL("../", web));
  if (step === "before") {
    // The same order of precedence Next uses: real environment first, then these files.
    const fromFiles = {};
    for (const name of [".env", ".env.production", ".env.local", ".env.production.local"]) {
      const file = new URL(name, web);
      if (existsSync(file)) Object.assign(fromFiles, parseEnv(readFileSync(file, "utf8")));
    }
    const env = { ...fromFiles, ...process.env };
    const problems = settingsProblems(env, known);
    if (problems.length) {
      console.error(`Build stopped, demo settings found:\n- ${problems.join("\n- ")}\nStop the demo, or delete web/.env.local and set the deployed values.`);
      process.exit(1);
    }
    if (!env.NEXT_PUBLIC_MARKETS_ADDRESS) console.warn("Note: NEXT_PUBLIC_MARKETS_ADDRESS isn't set, so this build will say the contract isn't deployed yet.");
    return;
  }
  const out = fileURLToPath(new URL("out", web));
  const found = textFiles(out).flatMap((path) => demoTraces(readFileSync(path, "utf8"), known).map((trace) => `${path.slice(out.length + 1)}: ${trace}`));
  if (found.length) {
    console.error(`Build rejected, the site still has demo values:\n- ${found.join("\n- ")}`);
    process.exit(1);
  }
  console.log("Deploy check passed: no demo values in out/.");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main(process.argv[2]);
