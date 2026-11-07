#!/bin/zsh
# Rehearsal only: records this many laps for the night currently taking bets, then moves the local clock past its end.
set -e
export PATH="$HOME/.foundry/bin:$PATH"
ROOT="${0:A:h:h}"
source "$ROOT/scripts/.demo.env"
RPC=http://127.0.0.1:8545
A0=0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
LAPS=${1:?Usage: demo-finish-night.sh <laps>}
NOW=$(cast block latest -f timestamp --rpc-url $RPC)
NIGHT=$(cast call $MARKETS 'currentNight()(uint256)' --rpc-url $RPC | awk '{print $1}')
ROUNDS=($(cast call $MARKETS 'roundsOf(uint256)(uint64,uint64)' $NIGHT --rpc-url $RPC | awk '{print $1}'))
START=$ROUNDS[1]; END=$ROUNDS[2]
BASE=$(cast call $CORE 'work(uint64)(uint64)' $(cast call $CORE 'settled()(uint64)' --rpc-url $RPC | awk '{print $1}') --rpc-url $RPC | awk '{print $1}')
cast send $CORE 'setRound(uint64,uint64,uint96)' $((START-1)) $BASE 0 --from $A0 --unlocked --rpc-url $RPC >/dev/null
cast send $CORE 'setRound(uint64,uint64,uint96)' $END $((BASE+LAPS)) 0 --from $A0 --unlocked --rpc-url $RPC >/dev/null
TARGET=$(( $(cast call $MARKETS 'roundStart(uint64)(uint256)' $((END+1)) --rpc-url $RPC | awk '{print $1}') + 60 ))
cast rpc evm_increaseTime $((TARGET-NOW)) --rpc-url $RPC >/dev/null
cast rpc evm_mine --rpc-url $RPC >/dev/null
echo "Night $NIGHT finished with $LAPS laps. Refresh the site and settle it."
