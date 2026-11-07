#!/bin/zsh
# Deploys SqueekMarkets to Sepolia from your own keystore wallet, publishes its source, and checks the result on-chain.
# It never reads a private key: Foundry asks for your keystore password.
set -e
export PATH="$HOME/.foundry/bin:$PATH"
ROOT="${0:A:h:h}"
RPC="${SEPOLIA_RPC_URL:-https://ethereum-sepolia-rpc.publicnode.com}"
SQK=0xd78a3956cF63164d1Fa1C622ad3c66623162Fa1e
CORE=0xFD6C166D4B8E2962E65746a13e5a0797CD4dE0c4
EXPLORER=https://eth-sepolia.blockscout.com
# Local rehearsal only: REHEARSAL_SENDER uses an unlocked account and skips publishing the source.
if [[ -n "$REHEARSAL_SENDER" ]]; then
  WALLET=(--unlocked --sender "$REHEARSAL_SENDER"); VERIFY=()
else
  WALLET=(--account "${DEPLOY_ACCOUNT:-burner}"); VERIFY=(--verify --verifier blockscout --verifier-url "$EXPLORER/api/" --retries 10 --delay 15)
fi

[[ "$(cast chain-id --rpc-url "$RPC")" == "11155111" ]] || { echo "Stopped: that RPC is not Sepolia."; exit 1; }

cd "$ROOT/contracts"
# A failed source upload doesn't undo the deploy, so the checks below still run and the result is reported.
forge script script/Deploy.s.sol --rpc-url "$RPC" "${WALLET[@]}" --broadcast "${VERIFY[@]}" || true

RECORD=broadcast/Deploy.s.sol/11155111/run-latest.json
[[ -f "$RECORD" ]] || { echo "Stopped: no deployment was recorded."; exit 1; }
read MARKETS BLOCK < <(node -e '
  const r = JSON.parse(require("fs").readFileSync(process.argv[1]));
  const t = r.receipts.find((x) => x.contractAddress && x.status === "0x1");
  if (!t) process.exit(1);
  console.log(t.contractAddress, Number(t.blockNumber));
' "$RECORD")

same() { [[ "${1:l}" == "${2:l}" ]]; }
TOKEN=$(cast call "$MARKETS" 'token()(address)' --rpc-url "$RPC")
BOUND_CORE=$(cast call "$MARKETS" 'core()(address)' --rpc-url "$RPC")
same "$TOKEN" "$SQK" || { echo "FAILED: token() is $TOKEN, not SQK. Don't use this contract."; exit 1; }
same "$BOUND_CORE" "$CORE" || { echo "FAILED: core() is $BOUND_CORE, not SqueekCore. Don't use this contract."; exit 1; }

echo
echo "Deployed: $MARKETS (block $BLOCK)"
echo "token() = SQK: ok"
echo "core()  = SqueekCore: ok"
if [[ -z "$REHEARSAL_SENDER" ]]; then
  # forge can print "verified" even when Blockscout later rejects the source, so ask Blockscout itself.
  sleep 20
  if curl -s "$EXPLORER/api/v2/addresses/$MARKETS" | grep -q '"is_verified":true'; then
    echo "Source: $EXPLORER/address/$MARKETS?tab=contract"
  else
    echo "Blockscout hasn't verified the source. Publish it through Sourcify, which Blockscout accepts:"
    echo "  cd contracts && forge verify-contract $MARKETS src/SqueekMarkets.sol:SqueekMarkets --chain 11155111 --verifier sourcify"
    echo "  then on Blockscout: Verify & publish → Sourcify, with out/SqueekMarkets.sol/SqueekMarkets.json's rawMetadata saved as metadata.json and src/SqueekMarkets.sol"
  fi
fi
echo
echo "Put these in web/.env.local, then build the site:"
echo "NEXT_PUBLIC_MARKETS_ADDRESS=$MARKETS"
echo "NEXT_PUBLIC_MARKETS_DEPLOY_BLOCK=$BLOCK"
