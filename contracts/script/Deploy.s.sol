// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {ISqueekCore, ISqueekToken, SqueekMarkets} from "../src/SqueekMarkets.sol";

/// Deploys to Sepolia only. Addresses come from https://docs.squeekchain.com/assets/deployments/sepolia.json
/// The deploying wallet gets no rights over the contract: it has no owner.
contract Deploy is Script {
    ISqueekToken constant SQK = ISqueekToken(0xd78a3956cF63164d1Fa1C622ad3c66623162Fa1e);
    ISqueekCore constant CORE = ISqueekCore(0xFD6C166D4B8E2962E65746a13e5a0797CD4dE0c4);

    function run() external returns (SqueekMarkets markets) {
        require(block.chainid == 11155111, "Sepolia only");
        vm.startBroadcast();
        markets = new SqueekMarkets(SQK, CORE);
        vm.stopBroadcast();
        require(address(markets.token()) == address(SQK), "Wrong token");
        require(address(markets.core()) == address(CORE), "Wrong core");
        console2.log("SqueekMarkets:", address(markets));
    }
}
