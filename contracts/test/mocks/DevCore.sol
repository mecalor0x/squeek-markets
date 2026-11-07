// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ISqueekCore} from "../../src/SqueekMarkets.sol";

/// @dev For rehearsing the website on a local fork only: real genesis, with settled rounds set by hand.
contract DevCore {
    ISqueekCore constant REAL = ISqueekCore(0xFD6C166D4B8E2962E65746a13e5a0797CD4dE0c4);
    uint64 public settled;
    uint64[] private _ids;
    mapping(uint64 => uint64) public work;
    mapping(uint64 => uint96) public units;

    /// Rounds must be set in ascending order, like real settlement. Rounds between them count as having no running.
    function setRound(uint64 round, uint64 cumulativeWork, uint96 blocks) public {
        if (_ids.length == 0 || _ids[_ids.length - 1] < round) _ids.push(round);
        work[round] = cumulativeWork;
        units[round] = blocks * 1e9;
        if (round > settled) settled = round;
    }

    function setRounds(uint64[] calldata rounds, uint64[] calldata cumulativeWork) external {
        for (uint256 i = 0; i < rounds.length; i += 1) setRound(rounds[i], cumulativeWork[i], 0);
    }

    function state() external view returns (ISqueekCore.CoreState memory result) {
        result.settledThroughRound = settled;
        result.cumulativeWork = _workAt(settled);
    }

    function _workAt(uint64 round) private view returns (uint64) {
        for (uint256 i = _ids.length; i > 0; i -= 1) {
            if (_ids[i - 1] <= round) return work[_ids[i - 1]];
        }
        return 0;
    }

    function roundPage(uint64 afterRound, uint64 throughRound, uint256 maxRecords) external view returns (ISqueekCore.RoundPage memory page) {
        require(throughRound <= settled && afterRound <= throughRound && maxRecords <= 16, "InvalidRoundPageBounds");
        uint64 previous = _workAt(afterRound);
        page.start.cumulativeWork = previous;
        ISqueekCore.RoundCheckpoint[] memory found = new ISqueekCore.RoundCheckpoint[](maxRecords);
        uint256 count = 0;
        uint64 reached = throughRound;
        for (uint256 i = 0; i < _ids.length; i += 1) {
            uint64 id = _ids[i];
            if (id <= afterRound || id > throughRound || work[id] == previous) continue;
            if (count == maxRecords) break;
            found[count] = ISqueekCore.RoundCheckpoint({roundId: id, cumulativeWork: work[id], cumulativeBlockUnits: units[id], workPerThousandBlocks: 0, dataHash: bytes32(0)});
            previous = work[id];
            count += 1;
            if (count == maxRecords) reached = id;
        }
        ISqueekCore.RoundCheckpoint[] memory rounds = new ISqueekCore.RoundCheckpoint[](count);
        for (uint256 i = 0; i < count; i += 1) rounds[i] = found[i];
        page.rounds = rounds;
        page.certifiedThroughRound = reached;
        page.end.cumulativeWork = _workAt(reached);
        page.end.cumulativeBlockUnits = units[reached];
    }

    function configuration() external view returns (ISqueekCore.CoreConfiguration memory) {
        return REAL.configuration();
    }
}
