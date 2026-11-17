// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {OptraGuardHook} from "../src/OptraGuardHook.sol";
import {OptraTestnetCreate2Factory} from "../script/OptraTestnetDeployment.s.sol";
import {Hooks} from "v4-core/libraries/Hooks.sol";
import {IHooks} from "v4-core/interfaces/IHooks.sol";
import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {TickMath} from "v4-core/libraries/TickMath.sol";
import {PoolManager} from "v4-core/PoolManager.sol";
import {PoolModifyLiquidityTest} from "v4-core/test/PoolModifyLiquidityTest.sol";
import {PoolSwapTest} from "v4-core/test/PoolSwapTest.sol";
import {Currency} from "v4-core/types/Currency.sol";
import {PoolId, PoolIdLibrary} from "v4-core/types/PoolId.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";
import {MockERC20} from "solmate/src/test/utils/mocks/MockERC20.sol";

/// @notice Current-head fork tests for paused deployment and separately activated acceptance.
/// @dev All token, hook, pool, liquidity, policy and swap writes remain transient fork state.
contract OptraTestnetPhasesTest is Test {
    using PoolIdLibrary for PoolKey;

    uint256 private constant TESTNET_CHAIN_ID = 46630;
    uint256 private constant Q96 = 1 << 96;
    uint64 private constant ACCEPTANCE_POLICY_MAX_AGE = 300;
    uint24 private constant POOL_FEE = 3000;
    int24 private constant TICK_SPACING = 60;
    uint160 private constant HOOK_MASK = (1 << 14) - 1;
    uint160 private constant EXPECTED_HOOK_BITS = (1 << 13) | (1 << 7);
    address private constant POOL_MANAGER = 0x8366a39CC670B4001A1121B8F6A443A643e40951;
    bytes32 private constant POOL_MANAGER_RUNTIME_SHA256 =
        0x6eb21c69298b064e37fcf8089a941ae096fe08c0f179b2d399567aef1b10585b;

    IPoolManager private manager;
    MockERC20 private underlying;
    MockERC20 private quote;
    OptraTestnetCreate2Factory private factory;
    OptraGuardHook private hook;
    PoolKey private key;
    PoolModifyLiquidityTest private liquidityRouter;
    PoolSwapTest private swapRouter;

    function setUp() public {
        if (block.chainid != TESTNET_CHAIN_ID) vm.skip(true, "run with the Robinhood Testnet current-head fork");
        manager = IPoolManager(POOL_MANAGER);
        assertEq(sha256(POOL_MANAGER.code), POOL_MANAGER_RUNTIME_SHA256, "PoolManager runtime changed");

        underlying = new MockERC20("OPTRA TEST ASSET", "mOPTRA", 18);
        quote = new MockERC20("OPTRA TEST QUOTE", "mUSDG", 18);
        factory = new OptraTestnetCreate2Factory();
        liquidityRouter = new PoolModifyLiquidityTest(manager);
        swapRouter = new PoolSwapTest(manager);
        hook = _deployHook();
        key = _poolKey(address(underlying), address(quote), IHooks(address(hook)));
        manager.initialize(key, uint160(Q96));
    }

    function test_phaseAInitializesPoolPausedWithBoundRolesAndNoPolicy() public view {
        Hooks.Permissions memory permissions = hook.getHookPermissions();
        assertTrue(permissions.beforeInitialize);
        assertTrue(permissions.beforeSwap);
        assertFalse(permissions.afterSwap);
        assertEq(uint160(address(hook)) & HOOK_MASK, EXPECTED_HOOK_BITS);
        assertTrue(Hooks.isValidHookAddress(IHooks(address(hook)), POOL_FEE));

        assertTrue(hook.poolBound());
        assertEq(hook.configuredPoolId(), PoolId.unwrap(key.toId()));
        assertEq(hook.poolCreator(), address(this));
        assertEq(hook.admin(), address(this));
        assertEq(hook.keeper(), address(this));
        assertEq(hook.maxPolicyAge(), ACCEPTANCE_POLICY_MAX_AGE);
        assertTrue(hook.entryPaused());
        assertFalse(hook.policyPublished());
        assertEq(underlying.totalSupply(), 0);
        assertEq(quote.totalSupply(), 0);
    }

    function test_phaseBAcceptanceAllowsExactInOutThenRejectsBuysAndAllowsUnderlyingOut() public {
        _seedLiquidity();
        PoolSwapTest.TestSettings memory settings =
            PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false});
        bool buyZeroForOne = address(underlying) > address(quote);
        bool sellZeroForOne = !buyZeroForOne;

        hook.publishPolicy(false);
        assertTrue(hook.isPolicyFresh());
        assertFalse(hook.entryPaused());
        swapRouter.swap(key, _params(buyZeroForOne, -int256(1e12)), settings, bytes("phase B exact-in buy"));
        swapRouter.swap(key, _params(buyZeroForOne, int256(1e6)), settings, bytes("phase B exact-out buy"));

        hook.publishPolicy(true);
        assertTrue(hook.entryPaused());
        vm.expectRevert();
        swapRouter.swap(key, _params(buyZeroForOne, -int256(1e12)), settings, bytes("denied exact-in buy"));
        vm.expectRevert();
        swapRouter.swap(key, _params(buyZeroForOne, int256(1e6)), settings, bytes("denied exact-out buy"));
        swapRouter.swap(key, _params(sellZeroForOne, -int256(1e12)), settings, bytes("allowed underlying-out exact-in"));
        swapRouter.swap(key, _params(sellZeroForOne, int256(1e6)), settings, bytes("allowed underlying-out exact-out"));

        assertTrue(hook.entryPaused());
        assertTrue(hook.policyPublished());
        assertTrue(hook.isPolicyFresh());
        assertEq(hook.configuredPoolId(), PoolId.unwrap(key.toId()));
    }

    function test_interruptedAcceptanceExpiresAndEmergencyPauseIsImmediate() public {
        _seedLiquidity();
        bool buyZeroForOne = address(underlying) > address(quote);
        bool sellZeroForOne = !buyZeroForOne;
        PoolSwapTest.TestSettings memory settings =
            PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false});

        hook.publishPolicy(false);
        swapRouter.swap(key, _params(buyZeroForOne, -int256(1e12)), settings, bytes("acceptance before interruption"));

        vm.warp(block.timestamp + ACCEPTANCE_POLICY_MAX_AGE + 1);
        assertFalse(hook.isPolicyFresh());
        vm.expectRevert();
        swapRouter.swap(key, _params(buyZeroForOne, -int256(1e12)), settings, bytes("expired acceptance denied"));
        swapRouter.swap(key, _params(sellZeroForOne, -int256(1e12)), settings, bytes("stale policy exit allowed"));

        hook.publishPolicy(true);
        assertTrue(hook.entryPaused());
        assertTrue(hook.isPolicyFresh());
        vm.expectRevert();
        swapRouter.swap(key, _params(buyZeroForOne, -int256(1e12)), settings, bytes("emergency pause denied"));
    }

    function _seedLiquidity() private {
        underlying.mint(address(this), 1e24);
        quote.mint(address(this), 1e24);
        underlying.approve(address(liquidityRouter), type(uint256).max);
        quote.approve(address(liquidityRouter), type(uint256).max);
        underlying.approve(address(swapRouter), type(uint256).max);
        quote.approve(address(swapRouter), type(uint256).max);
        liquidityRouter.modifyLiquidity(
            key,
            IPoolManager.ModifyLiquidityParams({
                tickLower: -120, tickUpper: 120, liquidityDelta: 1e18, salt: bytes32(0)
            }),
            bytes("")
        );
    }

    function _deployHook() private returns (OptraGuardHook deployedHook) {
        bytes memory initCode = abi.encodePacked(
            type(OptraGuardHook).creationCode,
            abi.encode(
                manager,
                address(underlying),
                address(quote),
                address(this),
                address(this),
                address(this),
                ACCEPTANCE_POLICY_MAX_AGE
            )
        );
        bytes32 initCodeHash = keccak256(initCode);
        bytes32 salt;
        address predicted;
        bool found;
        for (uint256 i; i < 1_000_000; i++) {
            salt = bytes32(i);
            predicted = address(
                uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), address(factory), salt, initCodeHash))))
            );
            if (uint160(predicted) & HOOK_MASK == EXPECTED_HOOK_BITS) {
                found = true;
                break;
            }
        }
        require(found, "CREATE2 permission salt not found");
        address deployed = factory.deploy(salt, initCode);
        assertEq(deployed, predicted);
        deployedHook = OptraGuardHook(deployed);
    }

    function _poolKey(address tokenA, address tokenB, IHooks hooks) private pure returns (PoolKey memory poolKey) {
        if (tokenA < tokenB) {
            poolKey = PoolKey(Currency.wrap(tokenA), Currency.wrap(tokenB), POOL_FEE, TICK_SPACING, hooks);
        } else {
            poolKey = PoolKey(Currency.wrap(tokenB), Currency.wrap(tokenA), POOL_FEE, TICK_SPACING, hooks);
        }
    }

    function _params(bool zeroForOne, int256 amountSpecified) private pure returns (IPoolManager.SwapParams memory) {
        return IPoolManager.SwapParams({
            zeroForOne: zeroForOne,
            amountSpecified: amountSpecified,
            sqrtPriceLimitX96: zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1
        });
    }
}
