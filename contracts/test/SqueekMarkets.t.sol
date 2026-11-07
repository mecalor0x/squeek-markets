// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {ISqueekCore, ISqueekToken, SqueekMarkets} from "../src/SqueekMarkets.sol";
import {MockCore, MockToken} from "./mocks/Mocks.sol";

contract SqueekMarketsTest is Test {
    // 2026-11-03 19:50 UTC, like the real chain. Round 1 starts here.
    uint64 constant GENESIS = 1793735400;
    uint256 constant SQK = 1e18;

    MockToken token;
    MockCore core;
    SqueekMarkets markets;
    address alice = address(0xA11CE);
    address bob = address(0xB0B);
    address carol = address(0xCA201);
    uint256 id;
    uint64 startRound;
    uint64 endRound;

    function setUp() public {
        vm.warp(GENESIS + 6000);
        token = new MockToken();
        core = new MockCore(GENESIS);
        markets = new SqueekMarkets(ISqueekToken(address(token)), ISqueekCore(address(core)));
        for (uint256 i = 0; i < 3; i += 1) {
            address player = [alice, bob, carol][i];
            token.mint(player, 1_000_000 * SQK);
            vm.prank(player);
            token.approve(address(markets), type(uint256).max);
        }
        id = markets.currentNight();
        (startRound, endRound) = markets.roundsOf(id);
    }

    function _bet(address who, uint8 range, uint256 amount) internal {
        vm.prank(who);
        markets.bet(id, range, amount);
    }

    /// Certifies the night with this many laps and moves past its end.
    function _finishNight(uint64 laps) internal {
        core.settle(startRound - 1, 1000, 0);
        core.settle(endRound, laps, 0);
        vm.warp(markets.roundStart(endRound + 1));
    }

    function test_idsAreDatesAndNightsRunNoonToNoon() public {
        // 2026-11-06 12:00 UTC is the real night covering rounds 386 to 529.
        uint256 noon = 1793793600 + 86400 * 2 - 0;
        assertEq(noon % 86400, 43200);
        uint256 realNight = markets.nightOf(noon);
        (uint64 start, uint64 end) = markets.roundsOf(realNight);
        assertEq(markets.closesAt(realNight), noon);
        assertEq(markets.roundStart(start), noon);
        assertEq(end - start + 1, 144);
        assertEq(start, 386);
        assertEq(end, 529);
        // The same date always gives the same id, whatever time of day it's asked.
        assertEq(markets.nightOf(noon - 40000), markets.nightOf(noon + 40000));
    }

    function test_currentMarketFlipsAtNoon() public {
        uint256 today = block.timestamp / 1 days;
        vm.warp(today * 1 days + 12 hours - 1);
        assertEq(markets.currentNight(), today);
        vm.warp(today * 1 days + 12 hours);
        assertEq(markets.currentNight(), today + 1);
    }

    function test_rangeBoundariesBelongToTheHigherRange() public view {
        assertEq(markets.rangeOf(0), 0);
        assertEq(markets.rangeOf(4999), 0);
        assertEq(markets.rangeOf(5000), 1);
        assertEq(markets.rangeOf(6499), 1);
        assertEq(markets.rangeOf(6500), 2);
        assertEq(markets.rangeOf(7499), 2);
        assertEq(markets.rangeOf(7500), 3);
        assertEq(markets.rangeOf(8499), 3);
        assertEq(markets.rangeOf(8500), 4);
        assertEq(markets.rangeOf(type(uint64).max), 4);
    }

    function test_firstBetOpensTheMarketWithNobodyOpeningItByHand() public {
        assertEq(uint8(markets.getMarket(id).status), uint8(SqueekMarkets.Status.None));
        vm.expectEmit(true, false, false, true);
        emit SqueekMarkets.RoundOpened(id, startRound, endRound, markets.closesAt(id));
        _bet(alice, 2, 10 * SQK);
        assertEq(uint8(markets.getMarket(id).status), uint8(SqueekMarkets.Status.Open));
    }

    function test_openRoundIsPublicAndHarmlessToRepeat() public {
        vm.prank(address(0x1234));
        markets.openRound(id);
        assertEq(uint8(markets.getMarket(id).status), uint8(SqueekMarkets.Status.Open));
        markets.openRound(id);
        _bet(alice, 2, 10 * SQK);
        markets.openRound(id);
        assertEq(markets.getMarket(id).pools[2], 10 * SQK);
    }

    function test_nightsOutsideTheWindowCantBeOpened() public {
        uint256 past = markets.nightOf(block.timestamp) - 1;
        vm.expectRevert(SqueekMarkets.BettingClosed.selector);
        markets.openRound(past);
        vm.expectRevert(SqueekMarkets.NightUnavailable.selector);
        markets.openRound(id + 8);
        markets.openRound(id + 6);
    }

    function test_nightsBeforeGenesisDontExist() public {
        uint256 genesisDay = markets.nightOf(GENESIS); // noon that day was before round 1
        vm.expectRevert(SqueekMarkets.NightUnavailable.selector);
        markets.roundsOf(genesisDay);
    }

    function test_winningRangeSharesEverythingMinusTwoPercentBurned() public {
        _bet(alice, 3, 100 * SQK);
        _bet(carol, 3, 300 * SQK);
        _bet(bob, 2, 400 * SQK);
        _bet(bob, 4, 200 * SQK);
        _finishNight(7505);
        markets.resolve(id);

        SqueekMarkets.Market memory m = markets.getMarket(id);
        assertEq(uint8(m.status), uint8(SqueekMarkets.Status.Resolved));
        assertEq(m.winner, 3);
        assertEq(m.laps, 7505);
        assertEq(m.positionBefore, 1000);
        assertEq(m.positionAtEnd, 8505);
        assertEq(token.totalBurned(), 20 * SQK);
        assertEq(m.payoutPool, 980 * SQK);

        vm.prank(alice);
        assertEq(markets.claim(id), 245 * SQK);
        vm.prank(carol);
        assertEq(markets.claim(id), 735 * SQK);
        assertEq(token.balanceOf(address(markets)), 0);
        vm.prank(bob);
        vm.expectRevert(SqueekMarkets.NothingToClaim.selector);
        markets.claim(id);
    }

    function test_aPlayerCanBackSeveralRangesAndOnlyTheWinningStakePays() public {
        _bet(alice, 1, 100 * SQK);
        _bet(alice, 3, 100 * SQK);
        _bet(bob, 0, 200 * SQK);
        _finishNight(5500);
        markets.resolve(id);
        assertEq(markets.stakesOf(id, alice)[1], 100 * SQK);
        vm.prank(alice);
        assertEq(markets.claim(id), 392 * SQK);
    }

    function test_aNightHeSleptThroughIsTheFirstRange() public {
        _bet(alice, 0, 10 * SQK);
        _bet(bob, 3, 10 * SQK);
        _finishNight(0);
        markets.resolve(id);
        assertEq(markets.getMarket(id).winner, 0);
        assertEq(markets.getMarket(id).laps, 0);
    }

    function test_betsOnOnlyOneRangeRefundEveryoneWithNoFee() public {
        _bet(alice, 3, 10 * SQK);
        _bet(bob, 3, 20 * SQK);
        vm.prank(carol);
        markets.sponsor(id, 5 * SQK);
        vm.warp(markets.closesAt(id));
        markets.resolve(id); // doesn't need to wait for any data
        assertEq(uint8(markets.getMarket(id).status), uint8(SqueekMarkets.Status.Void));
        vm.prank(alice);
        assertEq(markets.claim(id), 10 * SQK);
        vm.prank(bob);
        assertEq(markets.claim(id), 20 * SQK);
        vm.prank(carol);
        assertEq(markets.claim(id), 5 * SQK);
        assertEq(token.totalBurned(), 0);
        assertEq(token.balanceOf(address(markets)), 0);
    }

    function test_nobodyOnTheWinningRangeRefundsEveryoneWithNoFee() public {
        _bet(alice, 0, 10 * SQK);
        _bet(alice, 2, 7 * SQK);
        _bet(bob, 4, 20 * SQK);
        _finishNight(6000);
        markets.resolve(id);
        SqueekMarkets.Market memory m = markets.getMarket(id);
        assertEq(uint8(m.status), uint8(SqueekMarkets.Status.Void));
        assertEq(m.laps, 6000); // the real result stays on record
        vm.prank(alice);
        assertEq(markets.claim(id), 17 * SQK);
        vm.prank(bob);
        assertEq(markets.claim(id), 20 * SQK);
        assertEq(token.totalBurned(), 0);
    }

    function test_sponsorMoneyGoesToWinners() public {
        _bet(alice, 3, 100 * SQK);
        _bet(bob, 1, 100 * SQK);
        vm.prank(carol);
        markets.sponsor(id, 800 * SQK);
        _finishNight(8000);
        markets.resolve(id);
        vm.prank(alice);
        assertEq(markets.claim(id), 980 * SQK);
        vm.prank(carol);
        vm.expectRevert(SqueekMarkets.NothingToClaim.selector);
        markets.claim(id);
    }

    function test_waitsForSettlementThenRefundsAfterTheTimeout() public {
        _bet(alice, 1, 10 * SQK);
        _bet(bob, 2, 10 * SQK);
        uint256 nightEnd = markets.roundStart(endRound + 1);
        vm.warp(nightEnd);
        vm.expectRevert(SqueekMarkets.NotSettled.selector);
        markets.resolve(id);
        vm.warp(nightEnd + 7 days);
        vm.expectRevert(SqueekMarkets.NotSettled.selector);
        markets.resolve(id);
        vm.warp(nightEnd + 7 days + 1);
        markets.resolve(id);
        assertEq(uint8(markets.getMarket(id).status), uint8(SqueekMarkets.Status.Void));
        vm.prank(alice);
        assertEq(markets.claim(id), 10 * SQK);
    }

    function test_aBrokenCoreCantTrapStakes() public {
        _bet(alice, 1, 10 * SQK);
        _bet(bob, 2, 10 * SQK);
        core.settle(endRound, 5, 0);
        core.setBroken(true);
        vm.warp(markets.roundStart(endRound + 1) + 7 days + 1);
        markets.resolve(id);
        vm.prank(bob);
        assertEq(markets.claim(id), 10 * SQK);
    }

    function test_lowGasCantForceAVoid() public {
        _bet(alice, 1, 10 * SQK);
        _bet(bob, 0, 10 * SQK);
        core.settle(endRound, 5, 0);
        vm.warp(markets.roundStart(endRound + 1) + 7 days + 1);
        (bool ok,) = address(markets).call{gas: 60_000}(abi.encodeCall(markets.resolve, (id)));
        assertFalse(ok);
        assertEq(uint8(markets.getMarket(id).status), uint8(SqueekMarkets.Status.Open));
        markets.resolve(id);
        assertEq(uint8(markets.getMarket(id).status), uint8(SqueekMarkets.Status.Resolved));
    }

    function test_noBetsOnceTheNightBegins() public {
        _bet(alice, 1, 1 * SQK);
        vm.warp(markets.closesAt(id) - 1);
        _bet(alice, 1, 1 * SQK);
        vm.warp(markets.closesAt(id));
        vm.prank(bob);
        vm.expectRevert(SqueekMarkets.BettingClosed.selector);
        markets.bet(id, 2, 1 * SQK);
        vm.prank(bob);
        vm.expectRevert(SqueekMarkets.BettingClosed.selector);
        markets.sponsor(id, 1 * SQK);
    }

    function test_aNightNobodyBetOnCantBeOpenedAfterItStarts() public {
        vm.warp(markets.closesAt(id));
        vm.prank(bob);
        vm.expectRevert(SqueekMarkets.BettingClosed.selector);
        markets.bet(id, 2, 1 * SQK);
        vm.expectRevert(SqueekMarkets.UnknownMarket.selector);
        markets.resolve(id);
    }

    function test_resolveNeedsBettingClosed() public {
        _bet(alice, 1, 1 * SQK);
        vm.expectRevert(SqueekMarkets.BettingOpen.selector);
        markets.resolve(id);
    }

    function test_stakeRules() public {
        vm.prank(alice);
        vm.expectRevert(SqueekMarkets.StakeTooSmall.selector);
        markets.bet(id, 1, SQK - 1);
        vm.prank(alice);
        vm.expectRevert(SqueekMarkets.InvalidOutcome.selector);
        markets.bet(id, 5, SQK);
        vm.expectRevert(SqueekMarkets.NotFinal.selector);
        markets.claim(id);
    }

    function test_cantClaimTwiceOrResolveTwice() public {
        _bet(alice, 3, 10 * SQK);
        _bet(bob, 2, 10 * SQK);
        _finishNight(7600);
        markets.resolve(id);
        vm.expectRevert(SqueekMarkets.AlreadyFinal.selector);
        markets.resolve(id);
        vm.prank(alice);
        markets.claim(id);
        vm.prank(alice);
        vm.expectRevert(SqueekMarkets.NothingToClaim.selector);
        markets.claim(id);
    }

    function test_permitBetsWithoutAnApproveAndABadPermitStillNeedsAllowance() public {
        address dave = address(0xDA7E);
        token.mint(dave, 100 * SQK);
        vm.prank(dave);
        markets.betWithPermit(id, 3, 40 * SQK, block.timestamp + 60, 27, bytes32(0), bytes32(0));
        assertEq(markets.stakesOf(id, dave)[3], 40 * SQK);
        assertEq(token.allowance(dave, address(markets)), 0);

        address victim = address(0xdead); // this mock's permit always fails for this address
        token.mint(victim, 100 * SQK);
        vm.prank(victim);
        vm.expectRevert();
        markets.betWithPermit(id, 3, 40 * SQK, block.timestamp + 60, 27, bytes32(0), bytes32(0));
    }

    function test_quoteMatchesTheRealPayout() public {
        _bet(bob, 1, 300 * SQK);
        _bet(carol, 3, 100 * SQK);
        uint256 quoted = markets.quote(id, 3, 100 * SQK);
        _bet(alice, 3, 100 * SQK);
        _finishNight(8000);
        markets.resolve(id);
        assertEq(markets.claimable(id, alice), quoted);
        vm.prank(alice);
        assertEq(markets.claim(id), quoted);
    }

    /// Any mix of stakes pays out in full: nothing is lost, nothing is created, and the contract ends empty.
    function testFuzz_everyoneClaimsAndTheBooksBalance(uint96[5] memory rawStakes, uint96 s, uint64 rawLaps) public {
        address[3] memory players = [alice, bob, carol];
        uint256 total;
        uint256 supply;
        for (uint256 i = 0; i < 3; i += 1) supply += token.balanceOf(players[i]);
        for (uint8 range = 0; range < 5; range += 1) {
            uint256 stake = bound(rawStakes[range], SQK, 100_000 * SQK);
            _bet(players[range % 3], range, stake);
            total += stake;
        }
        uint256 sponsored = bound(s, SQK, 100_000 * SQK);
        vm.prank(alice);
        markets.sponsor(id, sponsored);
        total += sponsored;

        uint64 laps = uint64(bound(rawLaps, 0, 12_000));
        _finishNight(laps);
        markets.resolve(id);
        SqueekMarkets.Market memory m = markets.getMarket(id);
        assertEq(m.winner, markets.rangeOf(laps));
        assertEq(m.payoutPool + token.totalBurned(), total);

        vm.prank(players[m.winner % 3]);
        markets.claim(id);
        assertEq(token.balanceOf(address(markets)), 0);
        uint256 left;
        for (uint256 i = 0; i < 3; i += 1) left += token.balanceOf(players[i]);
        assertEq(left + token.totalBurned(), supply);
        assertLe(token.totalBurned(), (total * 200) / 10_000 + 1);
    }

    function _template(uint64 threshold) internal returns (uint256) {
        return _create(id, threshold);
    }

    /// Alice opens it with the minimum bet on YES.
    function _create(uint256 night, uint64 threshold) internal returns (uint256 t) {
        vm.prank(alice);
        t = markets.createMarketWithBet(night, threshold, 1, 10 * SQK);
    }

    function test_templateMarketYesNeedsStrictlyMoreLaps() public {
        uint256 t = _template(7000);
        assertEq(t, markets.templateId(id, 7000));
        assertEq(markets.templateCount(), 1);
        assertEq(markets.templateMarkets(0), t);
        vm.prank(alice);
        markets.bet(t, 1, 90 * SQK);
        vm.prank(bob);
        markets.bet(t, 0, 300 * SQK);
        _finishNight(7000); // exactly the threshold
        markets.resolve(t);
        SqueekMarkets.Market memory m = markets.getMarket(t);
        assertEq(m.winner, markets.NO());
        assertEq(m.threshold, 7000);
        assertTrue(m.isTemplate);
        vm.prank(bob);
        assertEq(markets.claim(t), 392 * SQK);
        assertEq(token.balanceOf(address(markets)), 0);
    }

    function test_templateMarketYesWinsAboveTheThreshold() public {
        uint256 t = _template(7000);
        vm.prank(alice);
        markets.bet(t, 1, 90 * SQK);
        vm.prank(bob);
        markets.bet(t, 0, 100 * SQK);
        _finishNight(7001);
        markets.resolve(t);
        assertEq(markets.getMarket(t).winner, 1);
        vm.prank(alice);
        assertEq(markets.claim(t), 196 * SQK);
    }

    function test_templateMarketsCantRepeatOrHaveBadInputs() public {
        _template(7000);
        vm.prank(bob);
        vm.expectRevert(SqueekMarkets.DuplicateMarket.selector);
        markets.createMarketWithBet(id, 7000, 0, 10 * SQK);
        _create(id, 7001); // a different question is fine
        _create(id + 1, 7000); // and so is another night
        uint64 tooHigh = markets.MAX_THRESHOLD() + 1;
        uint256 past = markets.nightOf(block.timestamp) - 1;
        vm.startPrank(alice);
        vm.expectRevert(SqueekMarkets.InvalidThreshold.selector);
        markets.createMarketWithBet(id, 0, 1, 10 * SQK);
        vm.expectRevert(SqueekMarkets.InvalidThreshold.selector);
        markets.createMarketWithBet(id, tooHigh, 1, 10 * SQK);
        vm.expectRevert(SqueekMarkets.NightUnavailable.selector);
        markets.createMarketWithBet(id + 8, 7000, 1, 10 * SQK);
        vm.expectRevert(SqueekMarkets.BettingClosed.selector);
        markets.createMarketWithBet(past, 7000, 1, 10 * SQK);
        vm.stopPrank();
    }

    function test_openingAMarketNeedsARealFirstBet() public {
        uint256 before = token.balanceOf(alice);
        vm.startPrank(alice);
        vm.expectRevert(SqueekMarkets.CreatorBetTooSmall.selector);
        markets.createMarketWithBet(id, 7000, 1, 10 * SQK - 1);
        vm.expectRevert(SqueekMarkets.CreatorBetTooSmall.selector);
        markets.createMarketWithBet(id, 7000, 1, 0);
        vm.expectRevert(SqueekMarkets.InvalidOutcome.selector);
        markets.createMarketWithBet(id, 7000, 2, 10 * SQK);
        vm.stopPrank();
        assertEq(markets.templateCount(), 0);
        assertEq(uint8(markets.getMarket(markets.templateId(id, 7000)).status), uint8(SqueekMarkets.Status.None));
        assertEq(token.balanceOf(alice), before);

        vm.prank(alice);
        uint256 t = markets.createMarketWithBet(id, 7000, 0, 25 * SQK);
        assertEq(markets.templateCount(), 1);
        assertEq(markets.getMarket(t).pools[0], 25 * SQK);
        assertEq(markets.stakesOf(t, alice)[0], 25 * SQK);
        assertEq(token.balanceOf(alice), before - 25 * SQK);
        assertEq(token.balanceOf(address(markets)), 25 * SQK);
    }

    function test_openingAMarketFailsWithoutTheFunds() public {
        address poor = address(0xB00);
        token.mint(poor, 9 * SQK);
        vm.startPrank(poor);
        token.approve(address(markets), type(uint256).max);
        vm.expectRevert();
        markets.createMarketWithBet(id, 7000, 1, 10 * SQK);
        vm.stopPrank();
        assertEq(markets.templateCount(), 0);
    }

    function test_openingAMarketWithAPermitLeavesNothingApproved() public {
        address dave = address(0xDA7E);
        token.mint(dave, 100 * SQK);
        vm.prank(dave);
        uint256 t = markets.createMarketWithBetPermit(id, 7000, 1, 40 * SQK, block.timestamp + 60, 27, bytes32(0), bytes32(0));
        assertEq(markets.stakesOf(t, dave)[1], 40 * SQK);
        assertEq(token.allowance(dave, address(markets)), 0);

        address victim = address(0xdead); // this mock's permit always fails for this address
        token.mint(victim, 100 * SQK);
        vm.prank(victim);
        vm.expectRevert();
        markets.createMarketWithBetPermit(id, 7001, 1, 40 * SQK, block.timestamp + 60, 27, bytes32(0), bytes32(0));
        assertEq(markets.templateCount(), 1);
    }

    /// The promise on the site: inconsistent data refunds in full 7 days after the night ends, and not before.
    function test_inconsistentCoreDataRefundsEveryMarketAfterSevenDays() public {
        uint256 t = _template(7000);
        vm.prank(bob);
        markets.bet(t, 0, 30 * SQK);
        _bet(alice, 1, 10 * SQK);
        _bet(bob, 2, 20 * SQK);
        uint256 aliceBefore = token.balanceOf(alice);
        uint256 bobBefore = token.balanceOf(bob);
        core.settle(startRound - 1, 500, 0);
        core.settle(endRound, 100, 0);
        core.setWork(endRound, 1); // the total went backwards
        uint256 refundFrom = markets.roundStart(endRound + 1) + 7 days;
        vm.warp(refundFrom);
        vm.expectRevert(SqueekMarkets.NotSettled.selector);
        markets.resolve(t);
        vm.expectRevert(SqueekMarkets.NotSettled.selector);
        markets.resolve(id);
        vm.warp(refundFrom + 1);
        markets.resolve(t);
        markets.resolve(id);
        assertEq(uint8(markets.getMarket(t).status), uint8(SqueekMarkets.Status.Void));
        assertEq(uint8(markets.getMarket(id).status), uint8(SqueekMarkets.Status.Void));
        vm.startPrank(alice);
        markets.claim(t);
        markets.claim(id);
        vm.stopPrank();
        vm.startPrank(bob);
        markets.claim(t);
        markets.claim(id);
        vm.stopPrank();
        assertEq(token.balanceOf(alice), aliceBefore + 20 * SQK);
        assertEq(token.balanceOf(bob), bobBefore + 50 * SQK);
        assertEq(token.balanceOf(address(markets)), 0);
        assertEq(token.totalBurned(), 0);
    }

    function test_templateMarketsOnlyTakeYesOrNoAndMustExist() public {
        uint256 t = _template(7000);
        vm.prank(alice);
        vm.expectRevert(SqueekMarkets.InvalidOutcome.selector);
        markets.bet(t, 2, SQK);
        uint256 made = markets.templateId(id, 8000);
        vm.prank(alice);
        vm.expectRevert(SqueekMarkets.UnknownMarket.selector);
        markets.bet(made, 1, SQK);
        vm.expectRevert(SqueekMarkets.UnknownMarket.selector);
        markets.resolve(made);
        vm.expectRevert(SqueekMarkets.UnknownMarket.selector);
        markets.openRound(made);
    }

    function test_templateAndAutomaticMarketsDontTouchEachOther() public {
        uint256 t = _template(7000);
        _bet(alice, 3, 100 * SQK);
        _bet(bob, 1, 100 * SQK);
        vm.prank(alice);
        markets.bet(t, 1, 40 * SQK);
        vm.prank(bob);
        markets.bet(t, 0, 50 * SQK);
        assertEq(markets.getMarket(id).pools[1], 100 * SQK);
        assertEq(markets.getMarket(t).pools[1], 50 * SQK);
        _finishNight(7600); // range 3, and more than 7000
        markets.resolve(id);
        markets.resolve(t);
        vm.startPrank(alice);
        assertEq(markets.claim(id), 196 * SQK);
        assertEq(markets.claim(t), 98 * SQK);
        vm.stopPrank();
        assertEq(token.balanceOf(address(markets)), 0);
    }

    function test_oneSidedTemplateMarketRefunds() public {
        uint256 t = _template(7000); // only the opener's own bet
        vm.warp(markets.closesAt(id));
        markets.resolve(t);
        assertEq(uint8(markets.getMarket(t).status), uint8(SqueekMarkets.Status.Void));
        vm.prank(alice);
        assertEq(markets.claim(t), 10 * SQK);
    }

    function testFuzz_everyLapCountLandsInExactlyTheRightRange(uint64 laps) public view {
        uint8 range = markets.rangeOf(laps);
        uint64[6] memory edges = [0, 5000, 6500, 7500, 8500, type(uint64).max];
        assertGe(laps, edges[range]);
        if (range < 4) assertLt(laps, edges[range + 1]);
    }
}
