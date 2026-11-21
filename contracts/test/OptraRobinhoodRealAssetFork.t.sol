// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {OptraGuardHook} from "../src/OptraGuardHook.sol";
import {OptraTestnetCreate2Factory} from "../script/OptraTestnetDeployment.s.sol";
import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {IHooks} from "v4-core/interfaces/IHooks.sol";
import {Hooks} from "v4-core/libraries/Hooks.sol";
import {TickMath} from "v4-core/libraries/TickMath.sol";
import {StateLibrary} from "v4-core/libraries/StateLibrary.sol";
import {PoolModifyLiquidityTest} from "v4-core/test/PoolModifyLiquidityTest.sol";
import {PoolSwapTest} from "v4-core/test/PoolSwapTest.sol";
import {Currency} from "v4-core/types/Currency.sol";
import {PoolId} from "v4-core/types/PoolId.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";

interface IUSDG {
    function approve(address spender, uint256 value) external returns (bool);
    function decimals() external view returns (uint8);
    function symbol() external view returns (string memory);
}

/// @notice Fork simulation using Robinhood's live ETH/USDG contracts and v4 PoolManager.
/// @dev Fork-only USDG balances and OPTRA-pool liquidity are state overrides, not real funding or deployment.
contract OptraRobinhoodRealAssetForkTest is Test {
    using StateLibrary for IPoolManager;

    uint256 private constant MAINNET_CHAIN_ID = 4663;
    address private constant POOL_MANAGER = 0x8366a39CC670B4001A1121B8F6A443A643e40951;
    address private constant USDG = 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168;
    bytes32 private constant REFERENCE_ETH_USDG_POOL_ID =
        0xa791e5169faf703c0b63fd9552c33ec1128a773a00f5dc33a640da62a022cd35;
    uint24 private constant POOL_FEE = 3000;
    int24 private constant TICK_SPACING = 60;
    uint64 private constant POLICY_MAX_AGE = 300;
    uint160 private constant HOOK_MASK = (1 << 14) - 1;
    uint160 private constant EXPECTED_HOOK_BITS = (1 << 13) | (1 << 7);
    uint256 private constant ETH_SELL_INPUT = 1e13;
    uint256 private constant USDG_BUY_INPUT = 10e6;

    IPoolManager private manager;
    IUSDG private quote;
    OptraGuardHook private hook;
    PoolKey private key;
    PoolModifyLiquidityTest private liquidityRouter;
    PoolSwapTest private swapRouter;

    receive() external payable {}

    function setUp() public {
        if (!vm.envOr("RUN_OPTRA_ROBINHOOD_REAL_ASSET_FORK", false)) {
            vm.skip(true, "set RUN_OPTRA_ROBINHOOD_REAL_ASSET_FORK=true for real-asset Mainnet fork simulation");
        }
        require(block.chainid == MAINNET_CHAIN_ID, "Robinhood Mainnet chain ID 4663 required");

        manager = IPoolManager(POOL_MANAGER);
        assertGt(address(manager).code.length, 0, "PoolManager code missing");
        quote = IUSDG(USDG);
        assertGt(USDG.code.length, 0, "USDG code missing");
        assertEq(quote.symbol(), "USDG");
        assertEq(quote.decimals(), 6);

        (uint160 referenceSqrtPriceX96, int24 referenceTick,,) =
            manager.getSlot0(PoolId.wrap(REFERENCE_ETH_USDG_POOL_ID));
        assertGt(referenceSqrtPriceX96, 0, "reference ETH/USDG pool is not initialized");
        assertGt(
            manager.getLiquidity(PoolId.wrap(REFERENCE_ETH_USDG_POOL_ID)), 0, "reference pool has no active liquidity"
        );

        vm.deal(address(this), 100 ether);
        deal(USDG, address(this), 1_000_000e6);

        OptraTestnetCreate2Factory factory = new OptraTestnetCreate2Factory();
        bytes memory initCode = abi.encodePacked(
            type(OptraGuardHook).creationCode,
            abi.encode(manager, address(0), USDG, address(this), address(this), address(0xBEEF), POLICY_MAX_AGE)
        );
        address hookAddress = factory.deploy(_findSalt(address(factory), keccak256(initCode)), initCode);
        assertEq(uint160(hookAddress) & HOOK_MASK, EXPECTED_HOOK_BITS);
        hook = OptraGuardHook(hookAddress);

        key = PoolKey(Currency.wrap(address(0)), Currency.wrap(USDG), POOL_FEE, TICK_SPACING, IHooks(hookAddress));
        manager.initialize(key, referenceSqrtPriceX96);
        assertTrue(hook.poolBound());

        liquidityRouter = new PoolModifyLiquidityTest(manager);
        swapRouter = new PoolSwapTest(manager);
        assertTrue(quote.approve(address(liquidityRouter), type(uint256).max));
        assertTrue(quote.approve(address(swapRouter), type(uint256).max));

        int24 compressedTick = referenceTick / TICK_SPACING;
        if (referenceTick < 0 && referenceTick % TICK_SPACING != 0) compressedTick--;
        int24 tickLower = (compressedTick - 2) * TICK_SPACING;
        int24 tickUpper = (compressedTick + 2) * TICK_SPACING;
        liquidityRouter.modifyLiquidity{value: 10 ether}(
            key,
            IPoolManager.ModifyLiquidityParams({
                tickLower: tickLower, tickUpper: tickUpper, liquidityDelta: 1e15, salt: bytes32(0)
            }),
            bytes("fork-only seed from overridden balances")
        );
    }

    function test_realEthUsdgPoolInitializesAndAppliesBuyPauseWhileAllowingEthOut() public {
        PoolSwapTest.TestSettings memory settings =
            PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false});
        IPoolManager.SwapParams memory buyEth = _swapParams(false, -int256(USDG_BUY_INPUT));
        IPoolManager.SwapParams memory sellEth = _swapParams(true, -int256(ETH_SELL_INPUT));

        vm.expectRevert();
        swapRouter.swap(key, buyEth, settings, bytes("missing policy"));
        swapRouter.swap{value: ETH_SELL_INPUT}(key, sellEth, settings, bytes("ETH out remains available"));

        vm.prank(address(0xBEEF));
        hook.publishPolicy(false);
        swapRouter.swap(key, buyEth, settings, bytes("fresh policy permits ETH buy"));

        vm.prank(address(0xBEEF));
        hook.publishPolicy(true);
        vm.expectRevert();
        swapRouter.swap(key, buyEth, settings, bytes("paused policy blocks ETH buy"));
        swapRouter.swap{value: ETH_SELL_INPUT}(key, sellEth, settings, bytes("paused policy still allows ETH out"));
    }

    function _findSalt(address deployer, bytes32 initCodeHash) private pure returns (bytes32 salt) {
        for (uint256 i; i < 1_000_000; i++) {
            salt = bytes32(i);
            address predicted =
                address(uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), deployer, salt, initCodeHash)))));
            if (uint160(predicted) & HOOK_MASK == EXPECTED_HOOK_BITS) return salt;
        }
        revert("CREATE2 permission salt not found");
    }

    function _swapParams(bool zeroForOne, int256 amountSpecified)
        private
        pure
        returns (IPoolManager.SwapParams memory)
    {
        return IPoolManager.SwapParams({
            zeroForOne: zeroForOne,
            amountSpecified: amountSpecified,
            sqrtPriceLimitX96: zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1
        });
    }
}
