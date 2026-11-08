# Squeek Markets

YES/NO pools in $SQK on what Squeektoshi, the hamster behind [Squeekchain](https://squeekchain.com), does on the wheel. Unofficial community project. Sepolia testnet only: testnet SQK has no monetary value.

## Live on Sepolia
- **SqueekMarkets:** [`0xc9dba8348b9400e91faf24a50fb8a725ccbba7eb`](https://eth-sepolia.blockscout.com/address/0xc9dba8348b9400e91faf24a50fb8a725ccbba7eb?tab=contract), source verified on Blockscout and [Sourcify](https://repo.sourcify.dev/11155111/0xc9dba8348b9400e91faf24a50fb8a725ccbba7eb) (exact match), deployed at block 12086553
- **Bound to:** SQK `0xd78a3956cF63164d1Fa1C622ad3c66623162Fa1e` and SqueekCore `0xFD6C166D4B8E2962E65746a13e5a0797CD4dE0c4`

squeekchain-project: 39be84c3-d662-4eef-9544-44af49447781

## How a result is decided
Each night (noon to noon UTC, the wheel device's own day) has one automatic market with five ranges of laps:

| Range | Laps |
|---|---|
| 0 | under 5,000 |
| 1 | 5,000 to 6,499 |
| 2 | 6,500 to 7,499 |
| 3 | 7,500 to 8,499 |
| 4 | 8,500 or more |

Anyone can also add a YES/NO market from one template: "more than X laps on this night?". There's no free text, the same market can't be opened twice, and whoever opens one must place the first bet of at least 10 SQK.

`laps = SqueekCore position at the night's last round - position at the round before it`

Anyone can call `resolve()`. There is no keeper, API or admin in the path, and every result emits the positions it used so it can be checked by hand.

## What you trust
- **Not us.** The contract has no owner, pause, upgrade or fee recipient. Funds leave only through `claim()` or the 2% $SQK burn.
- **Squeekchain's data.** Rounds are signed by its Reporter, and its Core is upgradeable behind a timelock. If a night isn't certified within 7 days of ending, everyone gets their stake back.
- **Unaudited code.** This hasn't had an independent audit, so keep it on testnet.

## Rules
- A night's automatic market id is its UTC date as days since 1 Jan 1970. Nobody has to open it: the first bet does, or anyone can call `openRound()`.
- Stakes are parimutuel. Prices are each outcome's share of the pool, and payouts use the final pools.
- Betting closes at noon UTC, when the night begins. You can bet up to 7 nights ahead, and on more than one range.
- Everyone on the winning outcome shares the pool by stake, after a 2% burn. Sponsored SQK goes to them too.
- If bets cover fewer than two outcomes, nobody picked the winning one, or the night can't be resolved in time, everyone is refunded with no fee.

## Contracts
```sh
cd contracts
forge install --no-git foundry-rs/forge-std
forge test --no-match-contract Fork
forge test --match-contract Fork --fork-url https://ethereum-sepolia-rpc.publicnode.com
```

## Website
```sh
cd web
npm install
npm run dev     # `npm run build` makes the static site in out/
```
It's a static site: every market, price and result is read directly from the chain, and the live wheel from Squeekchain's public API. It runs nothing of its own in between.

## Deploy
Sepolia only. Never use a wallet that holds anything real, and never commit a key.

1. **Burner wallet.** Create a new, empty wallet just for this:
   ```sh
   cast wallet new
   ```
2. **Sepolia ETH.** Send a little to the burner from a faucet, such as [Google Cloud](https://cloud.google.com/application/web3/faucet/ethereum/sepolia) or [Alchemy](https://www.alchemy.com/faucets/ethereum-sepolia).
3. **Import it.** Foundry keeps the key encrypted and asks for your password when it's used:
   ```sh
   cast wallet import burner --interactive
   ```
4. **Deploy.** Stop the demo first. This refuses any network but Sepolia, publishes the source on Blockscout, and checks `token()` and `core()` on-chain:
   ```sh
   forge install --no-git foundry-rs/forge-std --root contracts   # first time only
   scripts/deploy.sh
   ```
   It prints the two values for the next step. Set `DEPLOY_ACCOUNT` if the account isn't called `burner`.
5. **Connect the site.** Put them in `web/.env.local`, then build. The build stops if any demo setting or address is still there:
   ```sh
   cp web/.env.example web/.env.local
   npm --prefix web run build
   ```
6. **Vercel.** Push this folder to a public GitHub repository and import it with **Root Directory** set to `web`. Add `NEXT_PUBLIC_MARKETS_ADDRESS` and `NEXT_PUBLIC_MARKETS_DEPLOY_BLOCK` under Environment Variables, deploy, then add your own domain.

## Local demo
Runs the whole flow with real SQK on a throwaway local copy of Sepolia. Nothing reaches the real network.
```sh
scripts/demo.sh                     # copy of Sepolia, contracts, 5,000 SQK per test account, site on :3000
scripts/demo-finish-night.sh 7800   # in a second terminal: ends the open night with 7,800 laps
```
Stop it with Ctrl-C. That removes its `web/.env.local` and brings back any settings you had there.
