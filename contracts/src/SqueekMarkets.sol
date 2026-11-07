// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

interface ISqueekToken {
    function transfer(address to, uint256 value) external returns (bool);
    function transferFrom(address from, address to, uint256 value) external returns (bool);
    function burn(uint256 amount) external;
    function permit(address owner, address spender, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s) external;
}

interface ISqueekCore {
    struct CoreState {
        uint64 settledThroughRound;
        uint64 cumulativeWork;
        uint96 cumulativeBlockUnits;
        uint64 blockHeight;
        uint96 blockProgress;
        uint32 workPerThousandBlocks;
        uint256 authorizationNonce;
        bool paused;
    }
    struct LedgerPosition {
        uint64 cumulativeWork;
        uint96 cumulativeBlockUnits;
        uint32 workPerThousandBlocks;
    }
    struct RoundCheckpoint {
        uint64 roundId;
        uint64 cumulativeWork;
        uint96 cumulativeBlockUnits;
        uint32 workPerThousandBlocks;
        bytes32 dataHash;
    }
    struct RoundPage {
        uint64 certifiedThroughRound;
        LedgerPosition start;
        LedgerPosition end;
        RoundCheckpoint[] rounds;
    }
    struct CoreConfiguration {
        bytes32 streamId;
        uint64 genesisTimestamp;
        uint64 roundDuration;
        uint64 maxWorkPerRound;
        uint16 maxRoundsPerBatch;
        address guardian;
        address reporter;
        uint32 initialWorkPerThousandBlocks;
        uint64 targetBlocksPerActiveRound;
        uint64 difficultySmoothingRounds;
        uint96 blockUnitsPerBlock;
    }

    function state() external view returns (CoreState memory);
    function roundPage(uint64 afterRound, uint64 throughRound, uint256 maxRecords) external view returns (RoundPage memory);
    function configuration() external view returns (CoreConfiguration memory);
}

/// @title Squeek Markets
/// @notice How far will Squeektoshi run tonight? Every Squeek night has one automatic market with five ranges of
///         wheel laps, and anyone can add a YES/NO market from a fixed template: "more than X laps?".
///         Stakes are parimutuel in $SQK. Results come only from SqueekCore:
///         `laps = position at the night's last round - position at the round before it`.
/// @dev There is no owner, no pause, no upgrade and no fee recipient. Funds leave this contract only through
///      claim() to the player who put them in or won them, or through the $SQK burn of the fee.
///      A night is its UTC date as days since 1 Jan 1970, running noon to noon UTC like the wheel's device.
///      A night's automatic market id is that number, and the first bet opens it. Template market ids are hashes.
contract SqueekMarkets {
    enum Status { None, Open, Resolved, Void }

    struct Market {
        Status status;
        bool isTemplate;
        uint8 outcomeCount;
        uint8 winner;
        uint32 night;
        uint64 threshold;
        uint64 laps;
        uint64 positionBefore;
        uint64 positionAtEnd;
        uint256[5] pools;
        uint256 sponsored;
        uint256 payoutPool;
        uint256 claimedStake;
        uint256 paidOut;
    }

    uint8 public constant RANGE_COUNT = 5;
    /// Ranges are under 5000, 5000-6499, 6500-7499, 7500-8499, and 8500 or more. A value on a boundary is in the higher range.
    uint64 public constant BOUNDARY_1 = 5000;
    uint64 public constant BOUNDARY_2 = 6500;
    uint64 public constant BOUNDARY_3 = 7500;
    uint64 public constant BOUNDARY_4 = 8500;
    /// Template outcomes. YES needs strictly more laps than the threshold.
    uint8 public constant NO = 0;
    uint8 public constant YES = 1;
    uint64 public constant MAX_THRESHOLD = 100_000;
    uint256 public constant FEE_BPS = 200;
    uint256 public constant BPS = 10_000;
    uint256 public constant MIN_STAKE = 1e18;
    /// Whoever opens a template market must put this much on it, so markets can't be spammed for free.
    uint256 public constant MIN_CREATOR_BET = 10e18;
    uint256 public constant MAX_NIGHTS_AHEAD = 7;
    uint256 public constant RESOLVE_TIMEOUT = 7 days;
    uint256 private constant DAY = 1 days;
    uint256 private constant NOON = 12 hours;
    uint256 private constant MIN_VOID_GAS = 400_000;

    ISqueekToken public immutable token;
    ISqueekCore public immutable core;
    uint64 public immutable genesisTimestamp;
    uint64 public immutable roundDuration;
    uint64 public immutable roundsPerNight;

    mapping(uint256 marketId => Market) private _markets;
    mapping(uint256 marketId => mapping(address player => uint256[5])) private _stakes;
    mapping(uint256 marketId => mapping(address sponsor => uint256)) public sponsorStake;
    uint256[] public templateMarkets;

    event RoundOpened(uint256 indexed marketId, uint64 startRound, uint64 endRound, uint256 closesAt);
    event MarketCreated(uint256 indexed marketId, address indexed creator, uint32 night, uint64 threshold);
    event BetPlaced(uint256 indexed marketId, address indexed player, uint8 indexed outcome, uint256 amount);
    event Sponsored(uint256 indexed marketId, address indexed sponsor, uint256 amount);
    /// @notice Everything needed to check a result by hand: the positions read from SqueekCore and the sums.
    event MarketResolved(uint256 indexed marketId, uint8 winner, uint64 laps, uint64 positionBefore, uint64 positionAtEnd, uint256 burned, uint256 payoutPool);
    event MarketVoided(uint256 indexed marketId, string reason);
    event Claimed(uint256 indexed marketId, address indexed player, uint256 amount);
    event DustBurned(uint256 indexed marketId, uint256 amount);

    error ZeroAddress();
    error UnsupportedRoundLayout();
    error NightUnavailable();
    error InvalidOutcome();
    error InvalidThreshold();
    error DuplicateMarket();
    error BettingClosed();
    error BettingOpen();
    error StakeTooSmall();
    error CreatorBetTooSmall();
    error UnknownMarket();
    error AlreadyFinal();
    error NotFinal();
    error NotSettled();
    error NothingToClaim();
    error NotEnoughGas();
    error TransferFailed();

    constructor(ISqueekToken token_, ISqueekCore core_) {
        if (address(token_) == address(0) || address(core_) == address(0)) revert ZeroAddress();
        token = token_;
        core = core_;
        ISqueekCore.CoreConfiguration memory configuration = core_.configuration();
        genesisTimestamp = configuration.genesisTimestamp;
        roundDuration = configuration.roundDuration;
        // Nights only line up with rounds if rounds fit the day exactly and start on a round-length boundary.
        if (configuration.roundDuration == 0 || DAY % configuration.roundDuration != 0 || configuration.genesisTimestamp % configuration.roundDuration != 0) revert UnsupportedRoundLayout();
        roundsPerNight = uint64(DAY / configuration.roundDuration);
    }

    /// @notice The night starting at noon UTC on this timestamp's date, which is also its automatic market's id.
    function nightOf(uint256 timestamp) public pure returns (uint256) {
        return timestamp / DAY;
    }

    /// @notice The night still taking bets right now: today's until noon UTC, then tomorrow's.
    function currentNight() public view returns (uint256) {
        uint256 today = nightOf(block.timestamp);
        return block.timestamp < today * DAY + NOON ? today : today + 1;
    }

    /// @notice When betting on a night closes, which is the moment the night begins.
    function closesAt(uint256 night) public pure returns (uint256) {
        return night * DAY + NOON;
    }

    /// @notice The rounds a night counts.
    function roundsOf(uint256 night) public view returns (uint64 startRound, uint64 endRound) {
        uint256 start = closesAt(night);
        if (start < genesisTimestamp) revert NightUnavailable();
        startRound = uint64((start - genesisTimestamp) / roundDuration) + 1;
        endRound = startRound + roundsPerNight - 1;
    }

    /// @notice Which of the automatic market's ranges a lap count falls in.
    function rangeOf(uint64 laps) public pure returns (uint8) {
        if (laps < BOUNDARY_1) return 0;
        if (laps < BOUNDARY_2) return 1;
        if (laps < BOUNDARY_3) return 2;
        if (laps < BOUNDARY_4) return 3;
        return 4;
    }

    /// @notice The id a YES/NO template market has, whether or not it exists yet.
    function templateId(uint256 night, uint64 threshold) public pure returns (uint256) {
        return uint256(keccak256(abi.encode(night, threshold)));
    }

    function templateCount() external view returns (uint256) {
        return templateMarkets.length;
    }

    /// @notice Opens a night's automatic market so it shows before the first bet. Optional: bet() does this too.
    function openRound(uint256 night) public {
        if (night > type(uint32).max) revert UnknownMarket();
        Market storage market = _markets[night];
        if (market.status != Status.None) return;
        _requireBookable(night);
        (uint64 startRound, uint64 endRound) = roundsOf(night);
        market.status = Status.Open;
        market.outcomeCount = RANGE_COUNT;
        market.night = uint32(night);
        emit RoundOpened(night, startRound, endRound, closesAt(night));
    }

    /// @notice Opens "will this night have more than `threshold` laps?" with the opener's first bet on it.
    ///         Anyone can; it gives no special rights, and the bet is an ordinary one.
    /// @param outcome NO (0) or YES (1).
    function createMarketWithBet(uint256 night, uint64 threshold, uint8 outcome, uint256 amount) public returns (uint256 marketId) {
        if (amount < MIN_CREATOR_BET) revert CreatorBetTooSmall();
        marketId = _createTemplate(night, threshold);
        bet(marketId, outcome, amount);
    }

    /// @notice Same, with no separate approval: the signature allows exactly this bet's amount.
    /// @dev If someone front-runs the permit it has still taken effect, so this continues either way.
    function createMarketWithBetPermit(uint256 night, uint64 threshold, uint8 outcome, uint256 amount, uint256 deadline, uint8 v, bytes32 r, bytes32 s) external returns (uint256 marketId) {
        try token.permit(msg.sender, address(this), amount, deadline, v, r, s) {} catch {}
        return createMarketWithBet(night, threshold, outcome, amount);
    }

    function _createTemplate(uint256 night, uint64 threshold) private returns (uint256 marketId) {
        if (night > type(uint32).max) revert NightUnavailable();
        if (threshold == 0 || threshold > MAX_THRESHOLD) revert InvalidThreshold();
        _requireBookable(night);
        roundsOf(night);
        marketId = templateId(night, threshold);
        Market storage market = _markets[marketId];
        if (market.status != Status.None) revert DuplicateMarket();
        market.status = Status.Open;
        market.isTemplate = true;
        market.outcomeCount = 2;
        market.night = uint32(night);
        market.threshold = threshold;
        templateMarkets.push(marketId);
        emit MarketCreated(marketId, msg.sender, uint32(night), threshold);
    }

    /// @param outcome A range index on an automatic market; NO (0) or YES (1) on a template market.
    function bet(uint256 marketId, uint8 outcome, uint256 amount) public {
        if (amount < MIN_STAKE) revert StakeTooSmall();
        Market storage market = _accepting(marketId);
        if (outcome >= market.outcomeCount) revert InvalidOutcome();
        market.pools[outcome] += amount;
        _stakes[marketId][msg.sender][outcome] += amount;
        emit BetPlaced(marketId, msg.sender, outcome, amount);
        _pull(msg.sender, amount);
    }

    /// @notice One transaction, no separate approval: the signature allows exactly this bet's amount.
    /// @dev If someone front-runs the permit it has still taken effect, so the bet continues either way.
    function betWithPermit(uint256 marketId, uint8 outcome, uint256 amount, uint256 deadline, uint8 v, bytes32 r, bytes32 s) external {
        try token.permit(msg.sender, address(this), amount, deadline, v, r, s) {} catch {}
        bet(marketId, outcome, amount);
    }

    /// @notice Adds to the prize without picking an outcome. It goes to the winners, or back to the sponsor if the market is void.
    function sponsor(uint256 marketId, uint256 amount) external {
        if (amount < MIN_STAKE) revert StakeTooSmall();
        Market storage market = _accepting(marketId);
        market.sponsored += amount;
        sponsorStake[marketId][msg.sender] += amount;
        emit Sponsored(marketId, msg.sender, amount);
        _pull(msg.sender, amount);
    }

    /// @notice Anyone can settle a market. It needs no keeper, API or admin, only SqueekCore's certified rounds.
    function resolve(uint256 marketId) external {
        Market storage market = _markets[marketId];
        if (market.status == Status.None) revert UnknownMarket();
        if (market.status != Status.Open) revert AlreadyFinal();
        if (block.timestamp < closesAt(market.night)) revert BettingOpen();

        // With bets on only one outcome there's nobody to win from, so everyone simply gets their stake back.
        if (_fundedOutcomes(market) < 2) {
            _void(marketId, market, "bets on fewer than two outcomes");
            return;
        }

        try this.readResult(market.night) returns (uint64 laps, uint64 before, uint64 atEnd) {
            _settle(marketId, market, laps, before, atEnd);
        } catch {
            // Settlement may have stopped or SqueekCore may have changed; stakes must never be stuck behind it.
            (, uint64 endRound) = roundsOf(market.night);
            if (block.timestamp <= roundStart(endRound + 1) + RESOLVE_TIMEOUT) revert NotSettled();
            if (gasleft() < MIN_VOID_GAS) revert NotEnoughGas();
            _void(marketId, market, "not settled in time");
        }
    }

    /// @notice Pays out a finished market: winnings if resolved, every stake back if void.
    function claim(uint256 marketId) external returns (uint256 amount) {
        Market storage market = _markets[marketId];
        if (market.status != Status.Resolved && market.status != Status.Void) revert NotFinal();

        uint256[5] storage stakes = _stakes[marketId][msg.sender];
        if (market.status == Status.Void) {
            for (uint8 i = 0; i < market.outcomeCount; i += 1) {
                amount += stakes[i];
                stakes[i] = 0;
            }
            amount += sponsorStake[marketId][msg.sender];
            sponsorStake[marketId][msg.sender] = 0;
            if (amount == 0) revert NothingToClaim();
            market.paidOut += amount;
            emit Claimed(marketId, msg.sender, amount);
            _send(msg.sender, amount);
            return amount;
        }

        uint8 winner = market.winner;
        uint256 stake = stakes[winner];
        if (stake == 0) revert NothingToClaim();
        stakes[winner] = 0;
        uint256 winningPool = market.pools[winner];
        amount = (stake * market.payoutPool) / winningPool;
        market.claimedStake += stake;
        market.paidOut += amount;
        emit Claimed(marketId, msg.sender, amount);

        // The last winner out burns the rounding dust, so the contract never keeps anything.
        uint256 dust = market.claimedStake == winningPool ? market.payoutPool - market.paidOut : 0;
        _send(msg.sender, amount);
        if (dust > 0) {
            market.paidOut += dust;
            emit DustBurned(marketId, dust);
            token.burn(dust);
        }
    }

    /// @notice A night's laps as SqueekCore shows them right now. Reverts until every round is certified.
    function readResult(uint256 night) external view returns (uint64 laps, uint64 before, uint64 atEnd) {
        (uint64 startRound, uint64 endRound) = roundsOf(night);
        if (core.state().settledThroughRound < endRound) revert NotSettled();
        before = core.roundPage(startRound - 1, startRound - 1, 0).end.cumulativeWork;
        atEnd = core.roundPage(endRound, endRound, 0).end.cumulativeWork;
        laps = atEnd - before;
    }

    function getMarket(uint256 marketId) external view returns (Market memory) {
        return _markets[marketId];
    }

    function stakesOf(uint256 marketId, address player) external view returns (uint256[5] memory) {
        return _stakes[marketId][player];
    }

    /// @notice What a player could collect now: winnings or refund. Zero until the market is final.
    function claimable(uint256 marketId, address player) external view returns (uint256 amount) {
        Market storage market = _markets[marketId];
        uint256[5] storage stakes = _stakes[marketId][player];
        if (market.status == Status.Void) {
            for (uint8 i = 0; i < RANGE_COUNT; i += 1) amount += stakes[i];
            return amount + sponsorStake[marketId][player];
        }
        if (market.status != Status.Resolved) return 0;
        return (stakes[market.winner] * market.payoutPool) / market.pools[market.winner];
    }

    /// @notice What a further bet would pay if its outcome wins, at the pools as they stand now.
    /// @dev Works before a night's market exists too. Final payouts use the final pools.
    function quote(uint256 marketId, uint8 outcome, uint256 amount) external view returns (uint256) {
        Market storage market = _markets[marketId];
        uint8 outcomes = market.status == Status.None ? RANGE_COUNT : market.outcomeCount;
        if (outcome >= outcomes) revert InvalidOutcome();
        uint256 total = market.sponsored + amount;
        for (uint8 i = 0; i < outcomes; i += 1) total += market.pools[i];
        return (amount * (total - (total * FEE_BPS) / BPS)) / (market.pools[outcome] + amount);
    }

    function currentRound() public view returns (uint64) {
        if (block.timestamp < genesisTimestamp) return 0;
        return uint64((block.timestamp - genesisTimestamp) / roundDuration) + 1;
    }

    function roundStart(uint64 round) public view returns (uint256) {
        return genesisTimestamp + uint256(round - 1) * roundDuration;
    }

    function _requireBookable(uint256 night) private view {
        uint256 closing = closesAt(night);
        if (block.timestamp >= closing) revert BettingClosed();
        if (closing > block.timestamp + MAX_NIGHTS_AHEAD * DAY) revert NightUnavailable();
    }

    function _accepting(uint256 marketId) private returns (Market storage market) {
        market = _markets[marketId];
        // Only a night's own number opens by itself. Template markets must be created first.
        if (market.status == Status.None) openRound(marketId);
        if (market.status != Status.Open || block.timestamp >= closesAt(market.night)) revert BettingClosed();
    }

    function _fundedOutcomes(Market storage market) private view returns (uint8 funded) {
        for (uint8 i = 0; i < market.outcomeCount; i += 1) if (market.pools[i] > 0) funded += 1;
    }

    function _settle(uint256 marketId, Market storage market, uint64 laps, uint64 before, uint64 atEnd) private {
        uint8 winner = market.isTemplate ? (laps > market.threshold ? YES : NO) : rangeOf(laps);
        market.laps = laps;
        market.positionBefore = before;
        market.positionAtEnd = atEnd;
        market.winner = winner;
        // Nobody called the winning outcome, so nobody can be paid: everyone gets their stake back.
        if (market.pools[winner] == 0) {
            _void(marketId, market, "nobody picked the winning outcome");
            return;
        }
        uint256 total = market.sponsored;
        for (uint8 i = 0; i < market.outcomeCount; i += 1) total += market.pools[i];
        uint256 fee = (total * FEE_BPS) / BPS;
        market.status = Status.Resolved;
        market.payoutPool = total - fee;
        emit MarketResolved(marketId, winner, laps, before, atEnd, fee, market.payoutPool);
        if (fee > 0) token.burn(fee);
    }

    function _void(uint256 marketId, Market storage market, string memory reason) private {
        market.status = Status.Void;
        emit MarketVoided(marketId, reason);
    }

    function _pull(address from, uint256 amount) private {
        if (!token.transferFrom(from, address(this), amount)) revert TransferFailed();
    }

    function _send(address to, uint256 amount) private {
        if (!token.transfer(to, amount)) revert TransferFailed();
    }
}
