// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ISqueekCore} from "../../src/SqueekMarkets.sol";

/// @dev Test stand-ins. The fork test checks the same behaviour against the real Sepolia contracts.
contract MockToken {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    uint256 public totalBurned;

    function mint(address to, uint256 value) external { balanceOf[to] += value; }
    function approve(address spender, uint256 value) external returns (bool) { allowance[msg.sender][spender] = value; return true; }

    function transfer(address to, uint256 value) external returns (bool) {
        balanceOf[msg.sender] -= value;
        balanceOf[to] += value;
        return true;
    }

    function transferFrom(address from, address to, uint256 value) external returns (bool) {
        allowance[from][msg.sender] -= value;
        balanceOf[from] -= value;
        balanceOf[to] += value;
        return true;
    }

    function burn(uint256 amount) external {
        balanceOf[msg.sender] -= amount;
        totalBurned += amount;
    }

    function permit(address owner, address spender, uint256 value, uint256, uint8, bytes32, bytes32) external {
        if (owner == address(0xdead)) revert("bad permit");
        allowance[owner][spender] = value;
    }
}

contract MockCore {
    uint64 public genesis;
    uint64 public settled;
    bool public broken;
    mapping(uint64 => uint64) public work;
    mapping(uint64 => uint96) public units;

    constructor(uint64 genesis_) { genesis = genesis_; }

    /// Certifies through `round`, carrying totals forward over rounds with no work.
    function settle(uint64 round, uint64 addWork, uint96 addBlocks) external {
        uint64 lastWork = work[settled];
        uint96 lastUnits = units[settled];
        for (uint64 r = settled + 1; r < round; r += 1) { work[r] = lastWork; units[r] = lastUnits; }
        work[round] = lastWork + addWork;
        units[round] = lastUnits + addBlocks * 1e9;
        settled = round;
    }

    function setBroken(bool value) external { broken = value; }
    function setWork(uint64 round, uint64 value) external { work[round] = value; }

    function state() external view returns (ISqueekCore.CoreState memory result) {
        require(!broken, "broken");
        result.settledThroughRound = settled;
    }

    function roundPage(uint64, uint64 throughRound, uint256) external view returns (ISqueekCore.RoundPage memory page) {
        require(!broken, "broken");
        require(throughRound <= settled, "InvalidRoundPageBounds");
        page.certifiedThroughRound = throughRound;
        page.end.cumulativeWork = work[throughRound];
        page.end.cumulativeBlockUnits = units[throughRound];
    }

    function configuration() external view returns (ISqueekCore.CoreConfiguration memory result) {
        result.genesisTimestamp = genesis;
        result.roundDuration = 600;
        result.blockUnitsPerBlock = 1e9;
    }
}
