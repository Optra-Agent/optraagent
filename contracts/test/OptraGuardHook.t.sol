// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {OptraGuardHook} from "../src/OptraGuardHook.sol";
import {Hooks} from "v4-core/libraries/Hooks.sol";
import {TickMath} from "v4-core/libraries/TickMath.sol";
import {IHooks} from "v4-core/interfaces/IHooks.sol";
import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {BalanceDelta} from "v4-core/types/BalanceDelta.sol";
import {PoolManager} from "v4-core/PoolManager.sol";
import {PoolModifyLiquidityTest} from "v4-core/test/PoolModifyLiquidityTest.sol";
import {PoolSwapTest} from "v4-core/test/PoolSwapTest.sol";
import {Currency} from "v4-core/types/Currency.sol";
import {PoolId, PoolIdLibrary} from "v4-core/types/PoolId.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";
import {MockERC20} from "solmate/src/test/utils/mocks/MockERC20.sol";

abstract contract OptraGuardHookFixture is Test {
    using PoolIdLibrary for PoolKey;
    using Hooks for IHooks;

    uint256 internal constant Q96 = 1 << 96;
    uint64 internal constant POLICY_AGE = 300;
    uint24 internal constant POOL_FEE = 3000;
    int24 internal constant TICK_SPACING = 60;
    address internal constant KEEPER = address(0xBEEF);
    uint160 internal constant HOOK_MASK = (1 << 14) - 1;
    uint160 internal constant EXPECTED_HOOK_BITS = (1 << 13) | (1 << 7);
    address internal constant ROBINHOOD_MAINNET_POOL_MANAGER = 0x8366a39CC670B4001A1121B8F6A443A643e40951;

    PoolManager internal manager;
    MockERC20 internal underlying;
    MockERC20 internal quote;
    OptraGuardHook internal hook;
    PoolKey internal key;
    PoolModifyLiquidityTest internal liquidityRouter;
    PoolSwapTest internal swapRouter;

    function setUp() public virtual {
        manager = new PoolManager(address(this));
        underlying = new MockERC20("OPTRA Test Asset", "OTA", 18);
        quote = new MockERC20("OPTRA Test Quote", "OTQ", 18);
        underlying.mint(address(this), 1e24);
        quote.mint(address(this), 1e24);

        hook = _deployHook(address(underlying), address(quote), address(this), KEEPER);
        key = _poolKey(address(underlying), address(quote), IHooks(address(hook)), POOL_FEE, TICK_SPACING);

        liquidityRouter = new PoolModifyLiquidityTest(manager);
        swapRouter = new PoolSwapTest(manager);
        underlying.approve(address(liquidityRouter), type(uint256).max);
        quote.approve(address(liquidityRouter), type(uint256).max);
        underlying.approve(address(swapRouter), type(uint256).max);
        quote.approve(address(swapRouter), type(uint256).max);
    }

    function _deployHook(address underlying_, address quote_, address creator, address keeper_)
        internal
        returns (OptraGuardHook deployedHook)
    {
        return _deployHookWithPolicyAge(underlying_, quote_, creator, keeper_, POLICY_AGE);
    }

    function _deployHookWithPolicyAge(
        address underlying_,
        address quote_,
        address creator,
        address keeper_,
        uint64 policyAge
    ) internal returns (OptraGuardHook deployedHook) {
        (bytes memory initCode, bytes32 salt, address expected) =
            _hookInitCodeAndSalt(underlying_, quote_, creator, keeper_, policyAge);
        address deployed = this.deployInitCode(initCode, salt);
        require(deployed == expected, "CREATE2 deployment returned unexpected address");
        deployedHook = OptraGuardHook(deployed);
    }

    function _hookInitCodeAndSalt(
        address underlying_,
        address quote_,
        address creator,
        address keeper_,
        uint64 policyAge
    ) internal view returns (bytes memory initCode, bytes32 salt, address expected) {
        bytes memory creationCode = vm.getCode("src/OptraGuardHook.sol:OptraGuardHook");
        initCode = abi.encodePacked(
            creationCode, abi.encode(address(manager), underlying_, quote_, creator, address(this), keeper_, policyAge)
        );

        for (uint256 i; i < 200_000; i++) {
            salt = bytes32(i);
            expected = address(
                uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), address(this), salt, keccak256(initCode)))))
            );
            if (uint160(expected) & HOOK_MASK == EXPECTED_HOOK_BITS) break;
        }
        require(uint160(expected) & HOOK_MASK == EXPECTED_HOOK_BITS, "CREATE2 salt not found");
    }

    function deployInitCode(bytes memory initCode, bytes32 salt) public returns (address deployed) {
        require(msg.sender == address(this), "self-call only");
        assembly ("memory-safe") {
            deployed := create2(0, add(initCode, 0x20), mload(initCode), salt)
        }
        if (deployed == address(0)) {
            assembly ("memory-safe") {
                let revertData := mload(0x40)
                let revertSize := returndatasize()
                returndatacopy(revertData, 0, revertSize)
                revert(revertData, revertSize)
            }
        }
    }

    function _poolKey(address tokenA, address tokenB, IHooks hooks, uint24 fee, int24 tickSpacing)
        internal
        pure
        returns (PoolKey memory poolKey)
    {
        if (tokenA < tokenB) {
            poolKey = PoolKey(Currency.wrap(tokenA), Currency.wrap(tokenB), fee, tickSpacing, hooks);
        } else {
            poolKey = PoolKey(Currency.wrap(tokenB), Currency.wrap(tokenA), fee, tickSpacing, hooks);
        }
    }

    function _initializeAndSeedLiquidity() internal {
        manager.initialize(key, uint160(Q96));
        liquidityRouter.modifyLiquidity(
            key,
            IPoolManager.ModifyLiquidityParams({
                tickLower: -120, tickUpper: 120, liquidityDelta: 1e18, salt: bytes32(0)
            }),
            bytes("")
        );
    }

    function _buyUnderlyingParams() internal view returns (IPoolManager.SwapParams memory params) {
        bool zeroForOne = address(underlying) > address(quote);
        params = IPoolManager.SwapParams({
            zeroForOne: zeroForOne,
            amountSpecified: -int256(1e12),
            sqrtPriceLimitX96: zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1
        });
    }

    function _sellUnderlyingParams() internal view returns (IPoolManager.SwapParams memory params) {
        bool zeroForOne = address(underlying) < address(quote);
        params = IPoolManager.SwapParams({
            zeroForOne: zeroForOne,
            amountSpecified: -int256(1e12),
            sqrtPriceLimitX96: zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1
        });
    }

    function _exactOutputParams(bool zeroForOne) internal pure returns (IPoolManager.SwapParams memory params) {
        params = IPoolManager.SwapParams({
            zeroForOne: zeroForOne,
            amountSpecified: int256(1e6),
            sqrtPriceLimitX96: zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1
        });
    }

    function _swap(IPoolManager.SwapParams memory params, bytes memory hookData) internal {
        swapRouter.swap(key, params, PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false}), hookData);
    }
}

contract OptraGuardHookPermissionTest is OptraGuardHookFixture {
    function test_invalidConstructorInputsAreRejected() public {
        vm.expectRevert(OptraGuardHook.InvalidConfiguration.selector);
        new OptraGuardHook(
            IPoolManager(address(0)),
            address(underlying),
            address(quote),
            address(this),
            address(this),
            KEEPER,
            POLICY_AGE
        );
    }

    function test_hookPermissionFlagsAndValidAddress() public view {
        Hooks.Permissions memory permissions = hook.getHookPermissions();

        assertTrue(permissions.beforeInitialize);
        assertTrue(permissions.beforeSwap);
        assertFalse(permissions.afterInitialize);
        assertFalse(permissions.beforeAddLiquidity);
        assertFalse(permissions.afterAddLiquidity);
        assertFalse(permissions.beforeRemoveLiquidity);
        assertFalse(permissions.afterRemoveLiquidity);
        assertFalse(permissions.afterSwap);
        assertFalse(permissions.beforeDonate);
        assertFalse(permissions.afterDonate);
        assertFalse(permissions.beforeSwapReturnDelta);
        assertFalse(permissions.afterSwapReturnDelta);
        assertFalse(permissions.afterAddLiquidityReturnDelta);
        assertFalse(permissions.afterRemoveLiquidityReturnDelta);
        assertEq(uint160(address(hook)) & HOOK_MASK, EXPECTED_HOOK_BITS);
        assertTrue(Hooks.isValidHookAddress(IHooks(address(hook)), POOL_FEE));
    }

    function test_actualPoolManagerInitializationBindsTheConfiguredPool() public {
        manager.initialize(key, uint160(Q96));

        assertTrue(hook.poolBound());
        assertEq(hook.configuredPoolId(), PoolId.unwrap(key.toId()));
    }

    function test_unpermittedCallbacksRevertWhenCalledByPoolManager() public {
        IPoolManager.ModifyLiquidityParams memory liquidityParams = IPoolManager.ModifyLiquidityParams({
            tickLower: -120, tickUpper: 120, liquidityDelta: 1e18, salt: bytes32(0)
        });
        IPoolManager.SwapParams memory swapParams = _buyUnderlyingParams();

        vm.expectRevert(OptraGuardHook.UnsupportedCallback.selector);
        vm.prank(address(manager));
        hook.afterInitialize(address(this), key, uint160(Q96), 0);

        vm.expectRevert(OptraGuardHook.UnsupportedCallback.selector);
        vm.prank(address(manager));
        hook.beforeAddLiquidity(address(this), key, liquidityParams, bytes(""));

        vm.expectRevert(OptraGuardHook.UnsupportedCallback.selector);
        vm.prank(address(manager));
        hook.afterAddLiquidity(
            address(this), key, liquidityParams, BalanceDelta.wrap(0), BalanceDelta.wrap(0), bytes("")
        );

        vm.expectRevert(OptraGuardHook.UnsupportedCallback.selector);
        vm.prank(address(manager));
        hook.beforeRemoveLiquidity(address(this), key, liquidityParams, bytes(""));

        vm.expectRevert(OptraGuardHook.UnsupportedCallback.selector);
        vm.prank(address(manager));
        hook.afterRemoveLiquidity(
            address(this), key, liquidityParams, BalanceDelta.wrap(0), BalanceDelta.wrap(0), bytes("")
        );

        vm.expectRevert(OptraGuardHook.UnsupportedCallback.selector);
        vm.prank(address(manager));
        hook.afterSwap(address(this), key, swapParams, BalanceDelta.wrap(0), bytes(""));

        vm.expectRevert(OptraGuardHook.UnsupportedCallback.selector);
        vm.prank(address(manager));
        hook.beforeDonate(address(this), key, 0, 0, bytes(""));

        vm.expectRevert(OptraGuardHook.UnsupportedCallback.selector);
        vm.prank(address(manager));
        hook.afterDonate(address(this), key, 0, 0, bytes(""));
    }

    function test_unauthorizedPoolCreatorCannotInitialize() public {
        OptraGuardHook restrictedHook = _deployHook(address(underlying), address(quote), address(0xCAFE), KEEPER);
        PoolKey memory restrictedKey =
            _poolKey(address(underlying), address(quote), IHooks(address(restrictedHook)), POOL_FEE, TICK_SPACING);

        vm.expectRevert();
        manager.initialize(restrictedKey, uint160(Q96));
        assertFalse(restrictedHook.poolBound());
    }

    function test_hookRejectsAnUnexpectedPairDuringPoolInitialization() public {
        MockERC20 otherToken = new MockERC20("Other", "OTHER", 18);
        OptraGuardHook pairHook = _deployHook(address(underlying), address(quote), address(this), address(0xBEEF2));
        PoolKey memory wrongPair =
            _poolKey(address(otherToken), address(quote), IHooks(address(pairHook)), POOL_FEE, TICK_SPACING);

        vm.expectRevert();
        manager.initialize(wrongPair, uint160(Q96));
        assertFalse(pairHook.poolBound());
    }

    function test_constructorRejectsZeroPolicyAgeAndInvalidAssetPair() public {
        vm.expectRevert(OptraGuardHook.InvalidConfiguration.selector);
        new OptraGuardHook(manager, address(underlying), address(quote), address(this), address(this), KEEPER, 0);

        vm.expectRevert(OptraGuardHook.InvalidConfiguration.selector);
        new OptraGuardHook(
            manager, address(underlying), address(underlying), address(this), address(this), KEEPER, POLICY_AGE
        );
    }

    function test_nativeUnderlyingCurrencyCanBindToUsdQuotePool() public {
        OptraGuardHook nativeHook = _deployHook(address(0), address(quote), address(this), KEEPER);
        PoolKey memory nativeKey =
            _poolKey(address(0), address(quote), IHooks(address(nativeHook)), POOL_FEE, TICK_SPACING);

        manager.initialize(nativeKey, uint160(Q96));

        assertTrue(nativeHook.poolBound());
        assertEq(nativeHook.configuredPoolId(), PoolId.unwrap(nativeKey.toId()));
    }

    function test_constructorRejectsPolicyAgeAboveProductionMaximum() public {
        vm.expectRevert(OptraGuardHook.InvalidConfiguration.selector);
        new OptraGuardHook(
            manager, address(underlying), address(quote), address(this), address(this), KEEPER, uint64(901)
        );
    }

    function test_constructorRejectsAddressesWithoutContractCode() public {
        vm.expectRevert(OptraGuardHook.InvalidConfiguration.selector);
        new OptraGuardHook(
            IPoolManager(address(0xCAFE)),
            address(underlying),
            address(quote),
            address(this),
            address(this),
            KEEPER,
            POLICY_AGE
        );

        vm.expectRevert(OptraGuardHook.InvalidConfiguration.selector);
        new OptraGuardHook(manager, address(0xCAFE), address(quote), address(this), address(this), KEEPER, POLICY_AGE);

        vm.expectRevert(OptraGuardHook.InvalidConfiguration.selector);
        new OptraGuardHook(
            manager, address(underlying), address(0xCAFE), address(this), address(this), KEEPER, POLICY_AGE
        );
    }

    function test_constructorAcceptsProductionMaximumPolicyAge() public {
        OptraGuardHook maximumAgeHook =
            _deployHookWithPolicyAge(address(underlying), address(quote), address(this), KEEPER, uint64(900));

        assertEq(maximumAgeHook.maxPolicyAge(), uint64(900));
    }

    function test_mainnetRequiresContractAdminAndPoolCreatorAndDistinctKeeper() public {
        vm.chainId(4663);
        vm.etch(ROBINHOOD_MAINNET_POOL_MANAGER, address(manager).code);
        manager = PoolManager(ROBINHOOD_MAINNET_POOL_MANAGER);

        vm.expectRevert(OptraGuardHook.InvalidConfiguration.selector);
        new OptraGuardHook(
            manager, address(underlying), address(quote), address(0xCAFE), address(this), KEEPER, uint64(300)
        );

        vm.expectRevert(OptraGuardHook.InvalidConfiguration.selector);
        new OptraGuardHook(
            manager, address(underlying), address(quote), address(this), address(0xCAFE), KEEPER, uint64(300)
        );

        vm.expectRevert(OptraGuardHook.InvalidConfiguration.selector);
        new OptraGuardHook(
            manager, address(underlying), address(quote), address(this), address(this), address(this), uint64(300)
        );

        OptraGuardHook productionRoleHook =
            _deployHookWithPolicyAge(address(underlying), address(quote), address(this), KEEPER, uint64(300));
        assertEq(productionRoleHook.admin(), address(this));
        assertEq(productionRoleHook.keeper(), KEEPER);
    }

    function test_mainnetRejectsUnapprovedPoolManagerWithCode() public {
        vm.chainId(4663);

        (bytes memory initCode, bytes32 salt,) =
            _hookInitCodeAndSalt(address(underlying), address(quote), address(this), KEEPER, uint64(301));
        vm.expectRevert(OptraGuardHook.InvalidConfiguration.selector);
        this.deployInitCode(initCode, salt);
    }

    function test_mainnetAdminCannotBecomeKeeperAfterDeployment() public {
        vm.chainId(4663);

        vm.expectRevert(OptraGuardHook.InvalidConfiguration.selector);
        hook.setKeeper(address(this));
    }

    function test_oneHookInstanceCannotBindASecondPool() public {
        manager.initialize(key, uint160(Q96));
        PoolKey memory secondKey = _poolKey(address(underlying), address(quote), IHooks(address(hook)), 10_000, 200);

        vm.expectRevert();
        manager.initialize(secondKey, uint160(Q96));
        assertEq(hook.configuredPoolId(), PoolId.unwrap(key.toId()));
    }
}

contract OptraGuardHookPolicyTest is OptraGuardHookFixture {
    function test_initialPolicyStateIsPausedAndMissing() public view {
        assertFalse(hook.policyPublished());
        assertTrue(hook.entryPaused());
        assertEq(hook.policyUpdatedAt(), 0);
        assertFalse(hook.isPolicyFresh());
    }

    function test_onlyPoolManagerMayInvokeCallbacks() public {
        IPoolManager.SwapParams memory buy = _buyUnderlyingParams();
        vm.expectRevert(OptraGuardHook.UnauthorizedCallback.selector);
        hook.beforeSwap(address(this), key, buy, bytes("untrusted"));
    }

    function test_unauthorizedPolicyAndKeeperChangesRevert() public {
        vm.expectRevert(OptraGuardHook.UnauthorizedKeeper.selector);
        hook.publishPolicy(false);

        vm.prank(address(0xBAD));
        vm.expectRevert(OptraGuardHook.UnauthorizedAdmin.selector);
        hook.setKeeper(address(0xF00D));

        vm.prank(address(0xBAD));
        vm.expectRevert(OptraGuardHook.UnauthorizedAdmin.selector);
        hook.revokeKeeper();
    }

    function test_adminCannotSetKeeperToZero() public {
        vm.expectRevert(OptraGuardHook.InvalidConfiguration.selector);
        hook.setKeeper(address(0));
        assertEq(hook.keeper(), KEEPER);
    }

    function test_keeperRotationInvalidatesOldPolicyUntilNewKeeperPublishes() public {
        vm.prank(KEEPER);
        hook.publishPolicy(false);
        assertTrue(hook.policyPublished());

        address newKeeper = address(0xF00D);
        hook.setKeeper(newKeeper);
        assertEq(hook.keeper(), newKeeper);
        assertFalse(hook.policyPublished());
        assertTrue(hook.entryPaused());
        assertEq(hook.policyUpdatedAt(), 0);

        vm.prank(KEEPER);
        vm.expectRevert(OptraGuardHook.UnauthorizedKeeper.selector);
        hook.publishPolicy(false);

        vm.prank(newKeeper);
        hook.publishPolicy(false);
        assertTrue(hook.policyPublished());
        assertFalse(hook.entryPaused());
    }

    function test_unboundAndMissingPolicyFailClosedForRiskIncreasingDirection() public {
        IPoolManager.SwapParams memory buy = _buyUnderlyingParams();
        vm.expectRevert(OptraGuardHook.PoolNotBound.selector);
        vm.prank(address(manager));
        hook.beforeSwap(address(this), key, buy, hex"c0ffee");

        manager.initialize(key, uint160(Q96));
        vm.expectRevert(OptraGuardHook.MissingPolicy.selector);
        vm.prank(address(manager));
        hook.beforeSwap(address(this), key, buy, hex"c0ffee");
    }

    function test_callbackRejectsOtherPoolWithSameAssets() public {
        manager.initialize(key, uint160(Q96));
        PoolKey memory otherPool = _poolKey(address(underlying), address(quote), IHooks(address(hook)), 10_000, 200);

        vm.expectRevert(OptraGuardHook.WrongPoolPair.selector);
        vm.prank(address(manager));
        hook.beforeSwap(address(this), otherPool, _buyUnderlyingParams(), bytes("same assets, different pool"));
    }

    function test_untrustedHookDataCannotCreateOrOverridePolicy() public {
        _initializeAndSeedLiquidity();

        vm.expectRevert();
        _swap(_buyUnderlyingParams(), abi.encode(false, uint256(0)));

        vm.prank(KEEPER);
        hook.publishPolicy(true);
        vm.expectRevert();
        _swap(_buyUnderlyingParams(), abi.encode(false, uint256(type(uint256).max)));
    }

    function test_policyPauseAndUnpauseAffectSubsequentRealSwaps() public {
        _initializeAndSeedLiquidity();

        vm.prank(KEEPER);
        hook.publishPolicy(false);
        _swap(_buyUnderlyingParams(), hex"deadbeef");

        vm.prank(KEEPER);
        hook.publishPolicy(true);
        vm.expectRevert();
        _swap(_buyUnderlyingParams(), hex"01");

        vm.prank(KEEPER);
        hook.publishPolicy(false);
        _swap(_buyUnderlyingParams(), bytes("not-abi-data"));
    }

    function test_missingPausedAndStalePolicyStillAllowUnderlyingOutSwap() public {
        _initializeAndSeedLiquidity();

        _swap(_sellUnderlyingParams(), bytes("malformed"));
        vm.prank(KEEPER);
        hook.publishPolicy(true);
        _swap(_sellUnderlyingParams(), abi.encode("arbitrary caller bytes"));

        vm.warp(uint256(hook.policyUpdatedAt()) + POLICY_AGE + 1);
        _swap(_sellUnderlyingParams(), bytes("stale state does not block token direction out"));
    }

    function test_freshnessBoundaryIsInclusiveAndThenFailsClosed() public {
        _initializeAndSeedLiquidity();
        vm.prank(KEEPER);
        hook.publishPolicy(false);

        vm.warp(uint256(hook.policyUpdatedAt()) + POLICY_AGE);
        assertTrue(hook.isPolicyFresh());
        _swap(_buyUnderlyingParams(), bytes("fresh at configured boundary"));

        vm.warp(block.timestamp + 1);
        assertFalse(hook.isPolicyFresh());
        vm.expectRevert();
        _swap(_buyUnderlyingParams(), bytes("stale by one second"));
    }

    function test_futureDatedPolicyFailsClosedIfChainTimeMovesBackward() public {
        _initializeAndSeedLiquidity();
        vm.warp(100);
        vm.prank(KEEPER);
        hook.publishPolicy(false);
        vm.warp(99);

        assertFalse(hook.isPolicyFresh());
        vm.expectRevert(
            abi.encodeWithSelector(OptraGuardHook.StalePolicy.selector, uint64(100), uint256(99), POLICY_AGE)
        );
        vm.prank(address(manager));
        hook.beforeSwap(address(this), key, _buyUnderlyingParams(), bytes("policy timestamp is ahead"));
    }

    function test_policyPublicationFailsWhenChainTimestampCannotFitStorage() public {
        vm.warp(uint256(type(uint64).max) + 1);
        vm.prank(KEEPER);
        vm.expectRevert(OptraGuardHook.TimestampOutOfRange.selector);
        hook.publishPolicy(false);

        assertFalse(hook.policyPublished());
        assertTrue(hook.entryPaused());
        assertEq(hook.policyUpdatedAt(), 0);
    }

    function test_adminRevocationOfKeeperLeavesBuyPolicyMissing() public {
        vm.prank(KEEPER);
        hook.publishPolicy(false);

        hook.revokeKeeper();
        assertFalse(hook.policyPublished());
        assertTrue(hook.entryPaused());

        vm.prank(KEEPER);
        vm.expectRevert(OptraGuardHook.UnauthorizedKeeper.selector);
        hook.publishPolicy(false);
    }

    function test_liquidityProviderCanRemovePositionWhileEntryPaused() public {
        _initializeAndSeedLiquidity();
        vm.prank(KEEPER);
        hook.publishPolicy(true);

        liquidityRouter.modifyLiquidity(
            key,
            IPoolManager.ModifyLiquidityParams({
                tickLower: -120, tickUpper: 120, liquidityDelta: -1e18, salt: bytes32(0)
            }),
            bytes("remove while pause is active")
        );
    }

    function test_exactOutputBuyAndUnderlyingOutRespectDirectionPolicy() public {
        _initializeAndSeedLiquidity();

        vm.prank(KEEPER);
        hook.publishPolicy(false);
        _swap(_exactOutputParams(address(underlying) > address(quote)), bytes("exact output buy"));

        vm.prank(KEEPER);
        hook.publishPolicy(true);
        vm.expectRevert();
        _swap(_exactOutputParams(address(underlying) > address(quote)), bytes("paused exact output buy"));

        // Underlying-out is determined by token direction, not by exact-in/out amount sign.
        _swap(_exactOutputParams(address(underlying) < address(quote)), bytes("exact output underlying out"));
    }

    function test_reverseTokenOrderingCoversExactInputAndExactOutputDirections() public {
        MockERC20 reverseQuote = new MockERC20("Reverse Quote", "RVQ", 18);
        MockERC20 reverseUnderlying = new MockERC20("Reverse Underlying", "RVU", 18);
        assertLt(uint160(address(reverseQuote)), uint160(address(reverseUnderlying)));

        reverseUnderlying.mint(address(this), 1e24);
        reverseQuote.mint(address(this), 1e24);
        OptraGuardHook reverseHook =
            _deployHook(address(reverseUnderlying), address(reverseQuote), address(this), KEEPER);
        PoolKey memory reverseKey = _poolKey(
            address(reverseUnderlying), address(reverseQuote), IHooks(address(reverseHook)), POOL_FEE, TICK_SPACING
        );
        PoolModifyLiquidityTest reverseLiquidityRouter = new PoolModifyLiquidityTest(manager);
        PoolSwapTest reverseSwapRouter = new PoolSwapTest(manager);
        reverseUnderlying.approve(address(reverseLiquidityRouter), type(uint256).max);
        reverseQuote.approve(address(reverseLiquidityRouter), type(uint256).max);
        reverseUnderlying.approve(address(reverseSwapRouter), type(uint256).max);
        reverseQuote.approve(address(reverseSwapRouter), type(uint256).max);

        manager.initialize(reverseKey, uint160(Q96));
        reverseLiquidityRouter.modifyLiquidity(
            reverseKey,
            IPoolManager.ModifyLiquidityParams({
                tickLower: -120, tickUpper: 120, liquidityDelta: 1e18, salt: bytes32(0)
            }),
            bytes("")
        );

        vm.prank(KEEPER);
        reverseHook.publishPolicy(false);
        bool reverseOrderingBuyZeroForOne = address(reverseUnderlying) > address(reverseQuote);
        IPoolManager.SwapParams memory exactInputBuy = IPoolManager.SwapParams({
            zeroForOne: reverseOrderingBuyZeroForOne,
            amountSpecified: -int256(1e12),
            sqrtPriceLimitX96: reverseOrderingBuyZeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1
        });
        IPoolManager.SwapParams memory exactOutputBuy = _exactOutputParams(reverseOrderingBuyZeroForOne);
        PoolSwapTest.TestSettings memory settings =
            PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false});
        reverseSwapRouter.swap(reverseKey, exactInputBuy, settings, bytes("reverse exact input buy"));
        reverseSwapRouter.swap(reverseKey, exactOutputBuy, settings, bytes("reverse exact output buy"));

        // The hook fails closed for buys with no policy, but allows both exact-in and exact-out sells.
        reverseHook.revokeKeeper();
        IPoolManager.SwapParams memory exactInputSell = IPoolManager.SwapParams({
            zeroForOne: !reverseOrderingBuyZeroForOne,
            amountSpecified: -int256(1e12),
            sqrtPriceLimitX96: !reverseOrderingBuyZeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1
        });
        reverseSwapRouter.swap(reverseKey, exactInputSell, settings, bytes("reverse exact input underlying out"));
        reverseSwapRouter.swap(
            reverseKey,
            _exactOutputParams(!reverseOrderingBuyZeroForOne),
            settings,
            bytes("reverse exact output underlying out")
        );
    }

    function testFuzz_policyFreshness(uint32 rawElapsed) public {
        _initializeAndSeedLiquidity();
        vm.prank(KEEPER);
        hook.publishPolicy(false);

        uint64 elapsed = uint64(uint256(rawElapsed) % (uint256(POLICY_AGE) + 2));
        vm.warp(uint256(hook.policyUpdatedAt()) + elapsed);
        assertEq(hook.isPolicyFresh(), elapsed <= POLICY_AGE);

        if (elapsed <= POLICY_AGE) {
            _swap(_buyUnderlyingParams(), bytes("fuzz fresh"));
        } else {
            vm.expectRevert();
            _swap(_buyUnderlyingParams(), bytes("fuzz stale"));
        }
    }
}

contract OptraPolicyInvariantHandler {
    OptraGuardHook internal hook;

    function setHook(OptraGuardHook hook_) external {
        hook = hook_;
    }

    function publish(bool pauseEntries) external {
        hook.publishPolicy(pauseEntries);
    }
}

contract OptraGuardHookInvariantTest is OptraGuardHookFixture {
    OptraPolicyInvariantHandler internal handler;

    function setUp() public override {
        super.setUp();
        handler = new OptraPolicyInvariantHandler();
        hook = _deployHook(address(underlying), address(quote), address(this), address(handler));
        handler.setHook(hook);
        key = _poolKey(address(underlying), address(quote), IHooks(address(hook)), POOL_FEE, TICK_SPACING);
        manager.initialize(key, uint160(Q96));
        bytes4[] memory selectors = new bytes4[](1);
        selectors[0] = handler.publish.selector;
        targetContract(address(handler));
        targetSelector(FuzzSelector({addr: address(handler), selectors: selectors}));
    }

    function invariant_missingPolicyAlwaysHasPausedZeroTimestampState() public view {
        if (!hook.policyPublished()) {
            assertTrue(hook.entryPaused());
            assertEq(hook.policyUpdatedAt(), 0);
            assertFalse(hook.isPolicyFresh());
        } else {
            assertEq(uint256(hook.policyUpdatedAt()), block.timestamp);
            assertTrue(hook.isPolicyFresh());
        }
    }
}
