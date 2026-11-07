#!/bin/zsh
# Rehearsal only: copies the real SqueekCore's history into the stand-in Core, so the site shows true nights and rounds.
set -e
export PATH="$HOME/.foundry/bin:$PATH"
ROOT="${0:A:h:h}"
source "$ROOT/scripts/.demo.env"
RPC=http://127.0.0.1:8545
A0=0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
REAL=0xFD6C166D4B8E2962E65746a13e5a0797CD4dE0c4
PAGE='roundPage(uint64,uint64,uint256)((uint64,(uint64,uint96,uint32),(uint64,uint96,uint32),(uint64,uint64,uint96,uint32,bytes32)[]))'
SETTLED=$(cast call $REAL 'state()((uint64,uint64,uint96,uint64,uint96,uint32,uint256,bool))' --rpc-url $RPC | awk -F'[(, ]+' '{print $2}')
AFTER=0
while (( AFTER < SETTLED )); do
  OUT=$(cast call $REAL $PAGE $AFTER $SETTLED 16 --rpc-url $RPC)
  # Each record reads "(round, work [..], units [..], rate [..], 0xhash)"; numbers may carry a bracketed short form.
  PAIRS=($(print -r -- "$OUT" | sed -E 's/ \[[^]]*\]//g' | grep -oE '\([0-9]+, [0-9]+, [0-9]+, [0-9]+, 0x' | awk -F'[(, ]+' '{print $2":"$3}'))
  IDS=(${PAIRS%%:*}); WORK=(${PAIRS##*:})
  if (( $#IDS )); then cast send $CORE 'setRounds(uint64[],uint64[])' "[${(j:,:)IDS}]" "[${(j:,:)WORK}]" --from $A0 --unlocked --gas-limit 25000000 --rpc-url $RPC >/dev/null; fi
  NEXT=$(print -r -- "$OUT" | awk -F'[(, ]+' '{print $2}')
  (( NEXT > AFTER )) || break
  AFTER=$NEXT
done
LAST=$(cast call $REAL $PAGE $SETTLED $SETTLED 0 --rpc-url $RPC | awk -F'[(, ]+' '{print $3}')
cast send $CORE 'setRound(uint64,uint64,uint96)' $SETTLED $LAST 0 --from $A0 --unlocked --rpc-url $RPC >/dev/null
