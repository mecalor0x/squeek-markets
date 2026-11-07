// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {ISqueekCore, ISqueekToken, SqueekMarkets} from "../src/SqueekMarkets.sol";
import {MockCore, MockToken} from "./mocks/Mocks.sol";

/// Random players do random things across many nights while the invariants below must keep holding.
contract Handler is Test {
    SqueekMarkets public markets;
    MockToken public token;
    MockCore public core;
    address[] public players;
    uint256 public deposited;
    uint256 public withdrawn;
    uint256 public firstNight;
    uint256[] public templates;
    uint256 constant SQK = 1e18;

    constructor(SqueekMarkets markets_, MockToken token_, MockCore core_) {
        markets = markets_;
        token = token_;
        core = core_;
        firstNight = markets.currentNight();
        for (uint160 i = 1; i <= 4; i += 1) {
            address player = address(i * 0x1000);
            players.push(player);
            token.mint(player, type(uint128).max);
            vm.prank(player);
            token.approve(address(markets), type(uint256).max);
        }
    }

    function _night(uint256 seed) internal view returns (uint256) {
        return bound(seed, firstNight, markets.currentNight() + 6);
    }

    function nightsSeen() external view returns (uint256 first, uint256 last) {
        return (firstNight, markets.currentNight() + 7);
    }

    function open(uint256 seed) external {
        try markets.openRound(_night(seed)) {} catch {}
    }

    function createTemplate(uint256 who, uint256 seed, uint64 threshold, uint8 side, uint256 amount) external {
        uint256 stake = bound(amount, 10 * SQK, 10_000 * SQK);
        vm.prank(players[bound(who, 0, 3)]);
        try markets.createMarketWithBet(_night(seed), uint64(bound(threshold, 1, 9000)), uint8(bound(side, 0, 1)), stake) returns (uint256 id) {
            templates.push(id);
            deposited += stake;
        } catch {}
    }

    function templatesLength() external view returns (uint256) {
        return templates.length;
    }

    /// Any market at all: a night's automatic one, or a template one when the seed picks it.
    function _market(uint256 seed) internal view returns (uint256) {
        if (templates.length > 0 && seed % 3 == 0) return templates[seed % templates.length];
        return _night(seed);
    }

    function bet(uint256 who, uint256 seed, uint8 range, uint256 amount) external {
        address player = players[bound(who, 0, 3)];
        uint256 stake = bound(amount, SQK, 10_000 * SQK);
        vm.prank(player);
        try markets.bet(_market(seed), uint8(bound(range, 0, 4)), stake) { deposited += stake; } catch {}
    }

    function sponsor(uint256 who, uint256 seed, uint256 amount) external {
        address player = players[bound(who, 0, 3)];
        uint256 stake = bound(amount, SQK, 1_000 * SQK);
        vm.prank(player);
        try markets.sponsor(_market(seed), stake) { deposited += stake; } catch {}
    }

    function advance(uint256 seconds_) external {
        vm.warp(block.timestamp + bound(seconds_, 1, 18 hours));
    }

    function settle(uint64 laps) external {
        uint64 target = markets.currentRound() - 1;
        if (target <= core.settled()) return;
        core.settle(target, uint64(bound(laps, 0, 9000)), 0);
    }

    function resolve(uint256 seed) external {
        try markets.resolve(_market(seed)) {} catch {}
    }

    function claim(uint256 who, uint256 seed) external {
        address player = players[bound(who, 0, 3)];
        vm.prank(player);
        try markets.claim(_market(seed)) returns (uint256 amount) { withdrawn += amount; } catch {}
    }
}

contract SqueekMarketsInvariantTest is Test {
    MockToken token;
    MockCore core;
    SqueekMarkets markets;
    Handler handler;

    function setUp() public {
        vm.warp(1793735400 + 30 days);
        token = new MockToken();
        core = new MockCore(1793735400);
        markets = new SqueekMarkets(ISqueekToken(address(token)), ISqueekCore(address(core)));
        core.settle(markets.currentRound() - 1, 0, 0);
        handler = new Handler(markets, token, core);
        targetContract(address(handler));
    }

    /// Every SQK that came in is still held, was paid out, or was burned. Nothing appears or leaks.
    function invariant_booksAlwaysBalance() public view {
        assertEq(token.balanceOf(address(markets)) + handler.withdrawn() + token.totalBurned(), handler.deposited());
    }

    function _sum(SqueekMarkets.Market memory m) internal pure returns (uint256 total) {
        total = m.sponsored;
        for (uint256 i = 0; i < 5; i += 1) total += m.pools[i];
    }

    function _ids() internal view returns (uint256[] memory ids) {
        (uint256 first, uint256 last) = handler.nightsSeen();
        uint256 nights = last - first + 1;
        ids = new uint256[](nights + handler.templatesLength());
        for (uint256 i = 0; i < nights; i += 1) ids[i] = first + i;
        for (uint256 i = 0; i < handler.templatesLength(); i += 1) ids[nights + i] = handler.templates(i);
    }

    /// The contract always holds exactly what it still owes across every market.
    function invariant_alwaysSolvent() public view {
        uint256[] memory ids = _ids();
        uint256 owed;
        for (uint256 i = 0; i < ids.length; i += 1) {
            SqueekMarkets.Market memory m = markets.getMarket(ids[i]);
            if (m.status == SqueekMarkets.Status.Open || m.status == SqueekMarkets.Status.Void) owed += _sum(m) - m.paidOut;
            else if (m.status == SqueekMarkets.Status.Resolved) owed += m.payoutPool - m.paidOut;
        }
        assertEq(token.balanceOf(address(markets)), owed);
    }

    function invariant_noMarketPaysMoreThanItsPool() public view {
        uint256[] memory ids = _ids();
        for (uint256 i = 0; i < ids.length; i += 1) {
            SqueekMarkets.Market memory m = markets.getMarket(ids[i]);
            if (m.status == SqueekMarkets.Status.Resolved) assertLe(m.paidOut, m.payoutPool);
            if (m.status == SqueekMarkets.Status.Void) assertLe(m.paidOut, _sum(m));
        }
    }
}
