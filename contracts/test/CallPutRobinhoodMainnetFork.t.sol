// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";

interface ICallPutRobinhoodPositionManagerView {
    function optionsMarket() external view returns (address);
    function controller() external view returns (address);
    function executionFee() external view returns (uint256);
    function maxTimeDelay() external view returns (uint256);
}

interface ICallPutRobinhoodOptionsMarketView {
    function mainStableAsset() external view returns (address);
    function getUnderlyingAssetByIndex(uint16 index) external view returns (address);
}

interface ICallPutRobinhoodBeaconView {
    function implementation() external view returns (address);
}

interface IERC20MetadataView {
    function symbol() external view returns (string memory);
    function decimals() external view returns (uint8);
}

/// @notice Read-only fork smoke test for CallPut's Robinhood Mainnet deployment.
/// @dev This test never submits an order, creates an account, or changes fork state.
contract CallPutRobinhoodMainnetForkTest is Test {
    uint256 private constant ROBINHOOD_MAINNET_CHAIN_ID = 4663;
    address private constant POSITION_MANAGER = 0x426a6b482893557E58cF38de635fEbB30Fd6a3C3;
    address private constant OPTIONS_MARKET = 0x3271d35afAc70C0D4989F984Abb2d918bf672C7e;
    address private constant CONTROLLER = 0x0D240c1EbEeE7F74B40d6611326f5df98AB00e1B;
    address private constant TRADING_ACCOUNT_BEACON = 0x5685d4DD5114c74C805322d4612CA5D73EAcdc62;
    address private constant USDG = 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168;
    address private constant AAPL = 0x08817cf3D786d36b56bFa1fc5F71273314468fb1;
    address private constant MSFT = 0x3cD315EEf182EF06e0d12f4396AC50035AB4F211;

    function setUp() public {
        if (!vm.envOr("RUN_ROBINHOOD_MAINNET_FORK", false)) {
            vm.skip(true, "set RUN_ROBINHOOD_MAINNET_FORK=true to run the live Mainnet fork check");
        }
        string memory rpcUrl = vm.envExists("ROBINHOOD_MAINNET_RPC_URL")
            ? vm.envString("ROBINHOOD_MAINNET_RPC_URL")
            : "https://rpc.mainnet.chain.robinhood.com";
        vm.createSelectFork(rpcUrl);
    }

    function test_readsLiveCallPutBindingsAndUnderlyingMappings() public view {
        assertEq(block.chainid, ROBINHOOD_MAINNET_CHAIN_ID, "test must run on a Robinhood Mainnet fork");
        assertGt(POSITION_MANAGER.code.length, 0, "PositionManager proxy has no code");
        assertGt(OPTIONS_MARKET.code.length, 0, "OptionsMarket proxy has no code");
        assertGt(CONTROLLER.code.length, 0, "Controller proxy has no code");
        assertGt(TRADING_ACCOUNT_BEACON.code.length, 0, "TradingAccount beacon has no code");

        ICallPutRobinhoodPositionManagerView positionManager = ICallPutRobinhoodPositionManagerView(POSITION_MANAGER);
        assertEq(positionManager.optionsMarket(), OPTIONS_MARKET, "PositionManager OptionsMarket binding changed");
        assertEq(positionManager.controller(), CONTROLLER, "PositionManager Controller binding changed");
        assertGt(positionManager.executionFee(), 0, "execution fee must be nonzero");
        assertGt(positionManager.maxTimeDelay(), 0, "request delay must be nonzero");

        ICallPutRobinhoodOptionsMarketView optionsMarket = ICallPutRobinhoodOptionsMarketView(OPTIONS_MARKET);
        assertEq(optionsMarket.mainStableAsset(), USDG, "main stable asset changed");
        assertEq(optionsMarket.getUnderlyingAssetByIndex(16), AAPL, "AAPL underlying index changed");
        assertEq(optionsMarket.getUnderlyingAssetByIndex(19), MSFT, "MSFT underlying index changed");
        assertEq(IERC20MetadataView(AAPL).symbol(), "AAPL", "index 16 token symbol changed");
        assertEq(IERC20MetadataView(AAPL).decimals(), 18, "AAPL token decimals changed");
        assertEq(IERC20MetadataView(MSFT).symbol(), "MSFT", "index 19 token symbol changed");
        assertEq(IERC20MetadataView(MSFT).decimals(), 18, "MSFT token decimals changed");

        address implementation = ICallPutRobinhoodBeaconView(TRADING_ACCOUNT_BEACON).implementation();
        assertTrue(implementation != address(0), "TradingAccount implementation is unset");
        assertGt(implementation.code.length, 0, "TradingAccount implementation has no code");
    }

    function test_readsOpenAndCloseRequestViewsWithoutWriting() public view {
        assertEq(block.chainid, ROBINHOOD_MAINNET_CHAIN_ID, "test must run on a Robinhood Mainnet fork");

        (bool openOk, bytes memory openRecord) =
            POSITION_MANAGER.staticcall(abi.encodeWithSignature("openPositionRequests(bytes32)", bytes32(0)));
        assertTrue(openOk, "open request view is unavailable");
        assertEq(openRecord.length, 14 * 32, "open request tuple width changed");

        (bool closeOk, bytes memory closeRecord) =
            POSITION_MANAGER.staticcall(abi.encodeWithSignature("closePositionRequests(bytes32)", bytes32(0)));
        assertTrue(closeOk, "close request view is unavailable");
        assertEq(closeRecord.length, 13 * 32, "close request tuple width changed");
    }
}
