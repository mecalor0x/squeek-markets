#!/bin/zsh
# Local rehearsal with real SQK on a throwaway copy of Sepolia. SqueekCore is replaced by a stand-in so a night can be finished by hand.
# Sends nothing to the real network. Stopping it removes its settings from web/.env.local.
set -e
export PATH="$HOME/.foundry/bin:$PATH"
ROOT="${0:A:h:h}"
RPC=http://127.0.0.1:8545
SQK=0xd78a3956cF63164d1Fa1C622ad3c66623162Fa1e
HOLDER=0xD5DAb9F1D15E9D45548078726C54732a5B59EB78
A0=0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
A1=0x70997970C51812dc3a010C7d01b50e0d17dC79C8
ENV_FILE="$ROOT/web/.env.local"
ENV_KEPT="$ROOT/web/.env.local.before-demo"
DEMO_MARK="# Written by scripts/demo.sh"

# A second demo would overwrite the running one's settings, so it stops here instead.
for PORT in 3000 8545; do
  if lsof -nP -iTCP:$PORT -sTCP:LISTEN >/dev/null 2>&1; then echo "Stopped: port $PORT is already in use. Is another demo running?"; exit 1; fi
done

ANVIL=""; DEV=""; WROTE_ENV=""; STOPPED=""
stop_demo() {
  # Runs once: a signal also triggers the exit trap, and a second run would delete the restored settings.
  [[ -z "$STOPPED" ]] || return 0
  STOPPED=1
  if [[ -n "$DEV" ]]; then pkill -P "$DEV" 2>/dev/null || true; kill "$DEV" 2>/dev/null || true; fi
  [[ -n "$ANVIL" ]] && kill "$ANVIL" 2>/dev/null || true
  rm -f "$ROOT/scripts/.demo.env"
  if [[ -n "$WROTE_ENV" ]]; then
    rm -f "$ENV_FILE"
    if [[ -f "$ENV_KEPT" ]]; then mv "$ENV_KEPT" "$ENV_FILE"; fi
  fi
}
trap stop_demo EXIT
trap 'stop_demo; exit 130' INT
trap 'stop_demo; exit 143' TERM HUP

# The public RPC sometimes answers from a node that hasn't seen the newest block yet, so a failed start gets another try.
for TRY in 1 2 3 4 5; do
  anvil --fork-url https://ethereum-sepolia-rpc.publicnode.com --port 8545 --silent &
  ANVIL=$!
  until cast block-number --rpc-url $RPC >/dev/null 2>&1 || ! kill -0 $ANVIL 2>/dev/null; do sleep 1; done
  kill -0 $ANVIL 2>/dev/null && break
  ANVIL=""
  sleep 3
done
[[ -n "$ANVIL" ]] || { echo "Stopped: couldn't start the local copy of Sepolia."; exit 1; }

cd "$ROOT/contracts"
forge build >/dev/null 2>&1
CORE=$(forge create test/mocks/DevCore.sol:DevCore --rpc-url $RPC --from $A0 --unlocked --broadcast 2>/dev/null | awk '/Deployed to/{print $3}')
MARKETS=$(forge create src/SqueekMarkets.sol:SqueekMarkets --rpc-url $RPC --from $A0 --unlocked --broadcast --constructor-args $SQK $CORE 2>/dev/null | awk '/Deployed to/{print $3}')
cast rpc anvil_setBalance $HOLDER 0xde0b6b3a7640000 --rpc-url $RPC >/dev/null
cast rpc anvil_impersonateAccount $HOLDER --rpc-url $RPC >/dev/null
for A in $A0 $A1; do cast send $SQK 'transfer(address,uint256)' $A 5000000000000000000000 --from $HOLDER --unlocked --rpc-url $RPC >/dev/null; done
echo "CORE=$CORE\nMARKETS=$MARKETS" > "$ROOT/scripts/.demo.env"
# Remembered after the demo ends, so a deploy build can recognise these addresses.
print -l $CORE $MARKETS >> "$ROOT/scripts/.demo-addresses"
"$ROOT/scripts/demo-seed.sh"

# Real settings are set aside and come back afterwards. Leftovers from a demo that was killed are simply replaced.
if [[ -f "$ENV_FILE" ]] && ! grep -qF "$DEMO_MARK" "$ENV_FILE"; then mv "$ENV_FILE" "$ENV_KEPT"; fi
WROTE_ENV=1
cat > "$ENV_FILE" <<ENV
$DEMO_MARK
NEXT_PUBLIC_MARKETS_ADDRESS=$MARKETS
NEXT_PUBLIC_MARKETS_DEPLOY_BLOCK=$(cast block-number --rpc-url $RPC)
NEXT_PUBLIC_RPC_URL=$RPC
NEXT_PUBLIC_EXPECT_CORE=$CORE
NEXT_PUBLIC_CHAIN_CLOCK=1
ENV

cat <<INFO

Demo ready: http://localhost:3000
In your wallet: add network RPC $RPC, chain id 11155111.
Import this public anvil test key into a fresh wallet profile (5,000 SQK; never use it anywhere real):
$(cast wallet private-key "test test test test test test test test test test test junk")
Finish a night: scripts/demo-finish-night.sh 7800
Stop with Ctrl-C.

INFO
cd "$ROOT/web"
npm run abi >/dev/null
# In the background so Ctrl-C reaches the clean-up above straight away.
./node_modules/.bin/next dev -p 3000 &
DEV=$!
wait $DEV
