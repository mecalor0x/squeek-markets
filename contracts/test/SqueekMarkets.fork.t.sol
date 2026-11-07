// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {ISqueekCore, ISqueekToken, SqueekMarkets} from "../src/SqueekMarkets.sol";
import {Deploy} from "../script/Deploy.s.sol";

interface IErc20Reads {
    function balanceOf(address) external view returns (uint256);
    function allowance(address, address) external view returns (uint256);
    function totalBurned() external view returns (uint256);
    function decimals() external view returns (uint8);
    function name() external view returns (string memory);
    function approve(address, uint256) external returns (bool);
    function nonces(address) external view returns (uint256);
    function DOMAIN_SEPARATOR() external view returns (bytes32);
}

/// Runs against the real Sepolia contracts. Time is wound back to before a night the hamster really ran,
/// so markets are opened, bet on and resolved from SqueekCore's actual records of that night.
/// Run with: forge test --match-contract Fork --fork-url $SEPOLIA_RPC_URL
contract SqueekMarketsForkTest is Test {
    ISqueekToken constant SQK = ISqueekToken(0xd78a3956cF63164d1Fa1C622ad3c66623162Fa1e);
    ISqueekCore constant CORE = ISqueekCore(0xFD6C166D4B8E2962E65746a13e5a0797CD4dE0c4);
    address constant SQK_HOLDER = 0xD5DAb9F1D15E9D45548078726C54732a5B59EB78;

    // Published figures for three real nights, noon to noon UTC.
    uint256 constant NOV_4_NOON = 1793793600;
    uint256 constant NOV_5_NOON = NOV_4_NOON + 1 days;
    uint256 constant NOV_6_NOON = NOV_5_NOON + 1 days;

    SqueekMarkets markets;
    uint256 playerKey = 0xA11CE;
    address player;
    address rival = address(0xB0B);
    address other = address(0xCA201);
    uint256 burnedAtStart;

    function setUp() public {
        if (block.chainid != 11155111) vm.skip(true);
        markets = new SqueekMarkets(SQK, CORE);
        player = vm.addr(playerKey);
        vm.startPrank(SQK_HOLDER);
        SQK.transfer(player, 10_000e18);
        SQK.transfer(rival, 10_000e18);
        SQK.transfer(other, 10_000e18);
        vm.stopPrank();
        burnedAtStart = IErc20Reads(address(SQK)).totalBurned();
    }

    /// The contract's stake limits and the site's amounts all assume this.
    function test_sqkHasEighteenDecimals() public view {
        assertEq(IErc20Reads(address(SQK)).decimals(), 18);
    }

    /// These are the exact fields the site signs its permits with, in web/src/lib/permit.ts.
    function test_sitePermitDomainMatchesRealSqk() public view {
        bytes32 expected = keccak256(abi.encode(
            keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
            keccak256("Squeek"),
            keccak256("1"),
            uint256(11155111),
            address(SQK)
        ));
        assertEq(IErc20Reads(address(SQK)).DOMAIN_SEPARATOR(), expected);
        assertEq(IErc20Reads(address(SQK)).name(), "Squeek");
    }

    /// The site's fallback when a wallet can't sign: approve exactly the bet, and nothing stays approved.
    function test_exactApproveFallbackLeavesNothingApproved() public {
        uint256 id = markets.nightOf(NOV_6_NOON);
        vm.warp(NOV_6_NOON - 1 hours);
        vm.startPrank(rival);
        IErc20Reads(address(SQK)).approve(address(markets), 40e18);
        vm.expectRevert();
        markets.bet(id, 1, 40e18 + 1); // can't take a wei more than was approved
        markets.bet(id, 1, 40e18);
        assertEq(IErc20Reads(address(SQK)).allowance(rival, address(markets)), 0);
        vm.expectRevert();
        markets.bet(id, 1, 1e18); // and a later bet needs a new approval
        vm.stopPrank();
    }

    function test_permitPastItsDeadlineCantBeUsed() public {
        uint256 id = markets.nightOf(NOV_6_NOON);
        uint256 opening = NOV_6_NOON - 1 hours;
        vm.warp(opening);
        (uint8 v, bytes32 r, bytes32 s) = _signPermit(50e18, opening + 600);
        vm.warp(opening + 601);
        vm.prank(player);
        vm.expectRevert();
        markets.betWithPermit(id, 1, 50e18, opening + 600, v, r, s);
        assertEq(IErc20Reads(address(SQK)).allowance(player, address(markets)), 0);
    }

    function test_deployScriptBindsTheRealContracts() public {
        SqueekMarkets deployed = new Deploy().run();
        assertEq(address(deployed.token()), address(SQK));
        assertEq(address(deployed.core()), address(CORE));
    }

    function test_constructorReadsTheRealCoreSettings() public view {
        assertEq(markets.genesisTimestamp(), 1793735400);
        assertEq(markets.roundDuration(), 600);
        assertEq(markets.roundsPerNight(), 144);
    }

    function test_realNightsLandInTheRightRanges() public view {
        (uint64 start, uint64 end) = markets.roundsOf(markets.nightOf(NOV_6_NOON));
        assertEq(start, 386);
        assertEq(end, 529);

        (uint64 laps, uint64 before, uint64 atEnd) = markets.readResult(markets.nightOf(NOV_6_NOON));
        assertEq(laps, 7505);
        assertEq(before, 11048);
        assertEq(atEnd, 18553);
        assertEq(markets.rangeOf(laps), 3);

        (laps,,) = markets.readResult(markets.nightOf(NOV_5_NOON));
        assertEq(laps, 7231);
        assertEq(markets.rangeOf(laps), 2);

        (laps,,) = markets.readResult(markets.nightOf(NOV_4_NOON));
        assertEq(laps, 3817);
        assertEq(markets.rangeOf(laps), 0);
    }

    function _signPermit(uint256 amount, uint256 deadline) internal view returns (uint8 v, bytes32 r, bytes32 s) {
        bytes32 structHash = keccak256(abi.encode(
            keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)"),
            player, address(markets), amount, IErc20Reads(address(SQK)).nonces(player), deadline
        ));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", IErc20Reads(address(SQK)).DOMAIN_SEPARATOR(), structHash));
        return vm.sign(playerKey, digest);
    }

    /// The whole product: a real night, real SQK, a real permit, and no one opening the market by hand.
    function test_fullRangeMarketOnARealNightWithRealSqk() public {
        uint256 id = markets.nightOf(NOV_6_NOON);
        uint256 opening = NOV_6_NOON - 1 hours;
        vm.warp(opening);
        assertEq(markets.currentNight(), id);
        assertEq(uint8(markets.getMarket(id).status), uint8(SqueekMarkets.Status.None));

        uint256 amount = 500e18;
        (uint8 v, bytes32 r, bytes32 s) = _signPermit(amount, opening + 600);
        uint256 playerStart = IErc20Reads(address(SQK)).balanceOf(player);
        vm.prank(player);
        markets.betWithPermit(id, 3, amount, opening + 600, v, r, s); // the first bet opens it
        assertEq(uint8(markets.getMarket(id).status), uint8(SqueekMarkets.Status.Open));
        assertEq(IErc20Reads(address(SQK)).allowance(player, address(markets)), 0); // nothing left approved

        vm.startPrank(rival);
        IErc20Reads(address(SQK)).approve(address(markets), 1000e18);
        markets.bet(id, 1, 1000e18);
        vm.stopPrank();
        vm.startPrank(other);
        IErc20Reads(address(SQK)).approve(address(markets), 500e18);
        markets.bet(id, 4, 500e18);
        vm.stopPrank();

        vm.warp(NOV_6_NOON);
        vm.prank(rival);
        vm.expectRevert(SqueekMarkets.BettingClosed.selector);
        markets.bet(id, 1, 1e18);

        vm.warp(NOV_6_NOON + 1 days + 1);
        markets.resolve(id); // called by nobody in particular

        SqueekMarkets.Market memory m = markets.getMarket(id);
        assertEq(uint8(m.status), uint8(SqueekMarkets.Status.Resolved));
        assertEq(m.winner, 3); // 7505 laps is in 7500 to 8499
        assertEq(m.laps, 7505);
        assertEq(m.positionBefore, 11048);
        assertEq(m.positionAtEnd, 18553);
        assertEq(IErc20Reads(address(SQK)).totalBurned() - burnedAtStart, 40e18); // 2% of 2000

        vm.prank(player);
        assertEq(markets.claim(id), 1960e18);
        assertEq(IErc20Reads(address(SQK)).balanceOf(player), playerStart - amount + 1960e18);
        assertEq(IErc20Reads(address(SQK)).balanceOf(address(markets)), 0);
        vm.prank(rival);
        vm.expectRevert(SqueekMarkets.NothingToClaim.selector);
        markets.claim(id);
    }

    function test_aRealNightNobodyCalledRefundsEveryone() public {
        uint256 id = markets.nightOf(NOV_4_NOON); // 3817 laps, range 0
        vm.warp(NOV_4_NOON - 1 hours);
        vm.startPrank(rival);
        IErc20Reads(address(SQK)).approve(address(markets), 10e18);
        markets.bet(id, 3, 10e18);
        vm.stopPrank();
        vm.startPrank(other);
        IErc20Reads(address(SQK)).approve(address(markets), 20e18);
        markets.bet(id, 4, 20e18);
        vm.stopPrank();
        vm.warp(NOV_4_NOON + 1 days + 1);
        markets.resolve(id);
        assertEq(uint8(markets.getMarket(id).status), uint8(SqueekMarkets.Status.Void));
        assertEq(markets.getMarket(id).laps, 3817);
        vm.prank(other);
        assertEq(markets.claim(id), 20e18);
        assertEq(IErc20Reads(address(SQK)).totalBurned(), burnedAtStart);
    }

    /// The user-made template on a real night: more than 7,300 laps on 6 Nov (7,505), YES wins.
    function test_templateMarketOnARealNightWithRealSqk() public {
        uint256 night = markets.nightOf(NOV_6_NOON);
        vm.warp(NOV_6_NOON - 1 hours);
        uint8 yes = markets.YES();
        vm.startPrank(rival);
        IErc20Reads(address(SQK)).approve(address(markets), 100e18);
        uint256 id = markets.createMarketWithBet(night, 7300, yes, 100e18);
        vm.expectRevert(SqueekMarkets.DuplicateMarket.selector);
        markets.createMarketWithBet(night, 7300, yes, 100e18);
        vm.stopPrank();
        vm.startPrank(other);
        IErc20Reads(address(SQK)).approve(address(markets), 300e18);
        markets.bet(id, markets.NO(), 300e18);
        vm.stopPrank();
        vm.warp(NOV_6_NOON + 1 days + 1);
        markets.resolve(id);
        assertEq(markets.getMarket(id).winner, markets.YES());
        assertEq(markets.getMarket(id).laps, 7505);
        assertEq(IErc20Reads(address(SQK)).totalBurned() - burnedAtStart, 8e18);
        vm.prank(rival);
        assertEq(markets.claim(id), 392e18);
        assertEq(IErc20Reads(address(SQK)).balanceOf(address(markets)), 0);
    }

    /// Opening a market with a real permit, on real SQK: one transaction, nothing left approved.
    function test_openMarketWithPermitOnRealSqk() public {
        uint256 night = markets.nightOf(NOV_6_NOON);
        uint256 opening = NOV_6_NOON - 1 hours;
        vm.warp(opening);
        uint256 start = IErc20Reads(address(SQK)).balanceOf(player);
        (uint8 v, bytes32 r, bytes32 s) = _signPermit(10e18, opening + 600);
        vm.prank(player);
        uint256 id = markets.createMarketWithBetPermit(night, 7300, 0, 10e18, opening + 600, v, r, s);
        assertEq(markets.stakesOf(id, player)[0], 10e18);
        assertEq(IErc20Reads(address(SQK)).balanceOf(player), start - 10e18);
        assertEq(IErc20Reads(address(SQK)).allowance(player, address(markets)), 0);
    }

    function test_roundsNotYetCertifiedCantResolve() public {
        uint256 tonight = markets.currentNight();
        vm.expectRevert(SqueekMarkets.NotSettled.selector);
        markets.readResult(tonight);
    }

    function test_resolveGasStaysLow() public {
        uint256 id = markets.nightOf(NOV_6_NOON);
        vm.warp(NOV_6_NOON - 1 hours);
        vm.startPrank(rival);
        IErc20Reads(address(SQK)).approve(address(markets), 10e18);
        markets.bet(id, 3, 10e18);
        vm.stopPrank();
        vm.startPrank(other);
        IErc20Reads(address(SQK)).approve(address(markets), 10e18);
        markets.bet(id, 2, 10e18);
        vm.stopPrank();
        vm.warp(NOV_6_NOON + 1 days + 1);
        uint256 gasBefore = gasleft();
        markets.resolve(id);
        uint256 used = gasBefore - gasleft();
        emit log_named_uint("resolve gas", used);
        assertLt(used, 400_000);
    }
}
