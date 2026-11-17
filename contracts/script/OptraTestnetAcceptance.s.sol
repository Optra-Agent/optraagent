// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script} from "forge-std/Script.sol";
import {VmSafe} from "forge-std/Vm.sol";
import {console2} from "forge-std/console2.sol";
import {OptraGuardHook} from "../src/OptraGuardHook.sol";
import {Hooks} from "v4-core/libraries/Hooks.sol";
import {IHooks} from "v4-core/interfaces/IHooks.sol";
import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {TickMath} from "v4-core/libraries/TickMath.sol";
import {PoolModifyLiquidityTest} from "v4-core/test/PoolModifyLiquidityTest.sol";
import {PoolSwapTest} from "v4-core/test/PoolSwapTest.sol";
import {Currency} from "v4-core/types/Currency.sol";
import {PoolId, PoolIdLibrary} from "v4-core/types/PoolId.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";
import {MockERC20} from "solmate/src/test/utils/mocks/MockERC20.sol";

/// @notice Phase B separately activates and tests the synthetic Robinhood Testnet pool.
/// @dev Public broadcasts require OPTRA_TESTNET_ACCEPTANCE_APPROVED=true and a Foundry keystore account.
contract OptraTestnetAcceptance is Script {
    using PoolIdLibrary for PoolKey;

    uint256 internal constant ROBINHOOD_TESTNET_CHAIN_ID = 46630;
    address internal constant ROBINHOOD_TESTNET_POOL_MANAGER = 0x8366a39CC670B4001A1121B8F6A443A643e40951;
    bytes32 internal constant EXPECTED_POOL_MANAGER_BYTECODE_SHA256 =
        0x6eb21c69298b064e37fcf8089a941ae096fe08c0f179b2d399567aef1b10585b;
    uint64 internal constant ACCEPTANCE_POLICY_MAX_AGE = 300;
    uint24 internal constant POOL_FEE = 3000;
    int24 internal constant TICK_SPACING = 60;
    uint256 internal constant TEST_ASSET_SUPPLY = 1e24;
    int256 internal constant EXACT_INPUT_AMOUNT = -int256(1e12);
    int256 internal constant EXACT_OUTPUT_AMOUNT = int256(1e6);

    function run() external {
        require(block.chainid == ROBINHOOD_TESTNET_CHAIN_ID, "Robinhood Testnet chain ID 46630 required");
        bool broadcasting =
            vm.isContext(VmSafe.ForgeContext.ScriptBroadcast) || vm.isContext(VmSafe.ForgeContext.ScriptResume);
        if (broadcasting) {
            require(
                vm.envOr("OPTRA_TESTNET_ACCEPTANCE_APPROVED", false),
                "separate owner approval required for policy activation and swap acceptance"
            );
            require(
                tx.origin == vm.envAddress("OPTRA_TESTNET_DEPLOYER_ADDRESS"),
                "Foundry signer does not match approved Testnet deployer"
            );
        }

        address deployer = tx.origin;
        require(deployer != address(0), "Foundry sender required; pass --sender or --account");
        IPoolManager manager = IPoolManager(ROBINHOOD_TESTNET_POOL_MANAGER);
        require(address(manager).code.length != 0, "Robinhood Testnet PoolManager has no code");
        require(
            sha256(address(manager).code) == EXPECTED_POOL_MANAGER_BYTECODE_SHA256,
            "PoolManager runtime hash differs from verified Testnet deployment"
        );

        address underlyingAddress = vm.envAddress("OPTRA_TESTNET_UNDERLYING");
        address quoteAddress = vm.envAddress("OPTRA_TESTNET_QUOTE");
        address hookAddress = vm.envAddress("OPTRA_TESTNET_HOOK");
        address liquidityRouterAddress = vm.envAddress("OPTRA_TESTNET_LIQUIDITY_ROUTER");
        address swapRouterAddress = vm.envAddress("OPTRA_TESTNET_SWAP_ROUTER");
        require(
            underlyingAddress.code.length != 0 && quoteAddress.code.length != 0 && hookAddress.code.length != 0
                && liquidityRouterAddress.code.length != 0 && swapRouterAddress.code.length != 0,
            "Phase A contract address has no code"
        );

        MockERC20 underlying = MockERC20(underlyingAddress);
        MockERC20 quote = MockERC20(quoteAddress);
        OptraGuardHook guard = OptraGuardHook(hookAddress);
        PoolModifyLiquidityTest liquidityRouter = PoolModifyLiquidityTest(liquidityRouterAddress);
        PoolSwapTest swapRouter = PoolSwapTest(swapRouterAddress);
        require(address(guard.poolManager()) == address(manager), "hook PoolManager mismatch");
        require(
            guard.underlyingToken() == underlyingAddress && guard.quoteToken() == quoteAddress, "hook pair mismatch"
        );
        require(
            guard.poolCreator() == deployer && guard.admin() == deployer && guard.keeper() == deployer,
            "hook role mismatch"
        );
        require(guard.maxPolicyAge() == ACCEPTANCE_POLICY_MAX_AGE, "hook must use 300-second acceptance expiry");
        require(
            guard.poolBound() && guard.entryPaused() && !guard.policyPublished(),
            "Phase B requires a bound, paused Phase A pool without a policy"
        );
        require(
            underlying.totalSupply() == 0 && quote.totalSupply() == 0,
            "Phase B requires an untouched synthetic fixture; inspect or redeploy after interruption"
        );
        require(underlying.decimals() == 18 && quote.decimals() == 18, "mock asset decimals mismatch");

        PoolKey memory key = _poolKey(underlyingAddress, quoteAddress, IHooks(hookAddress));
        bytes32 poolId = PoolId.unwrap(key.toId());
        require(guard.configuredPoolId() == poolId, "pool id mismatch");
        Hooks.Permissions memory permissions = guard.getHookPermissions();
        require(
            permissions.beforeInitialize && permissions.beforeSwap && !permissions.afterInitialize
                && !permissions.beforeAddLiquidity && !permissions.afterAddLiquidity
                && !permissions.beforeRemoveLiquidity && !permissions.afterRemoveLiquidity && !permissions.afterSwap
                && !permissions.beforeDonate && !permissions.afterDonate && !permissions.beforeSwapReturnDelta
                && !permissions.afterSwapReturnDelta && !permissions.afterAddLiquidityReturnDelta
                && !permissions.afterRemoveLiquidityReturnDelta,
            "unexpected hook permissions"
        );
        require((uint160(hookAddress) & ((1 << 14) - 1)) == ((1 << 13) | (1 << 7)), "hook address flags mismatch");

        vm.startBroadcast();
        underlying.mint(deployer, TEST_ASSET_SUPPLY);
        quote.mint(deployer, TEST_ASSET_SUPPLY);
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

        guard.publishPolicy(false);
        require(!guard.entryPaused() && guard.policyPublished() && guard.isPolicyFresh(), "allow policy not active");
        PoolSwapTest.TestSettings memory settings =
            PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false});
        bool buyZeroForOne = underlyingAddress > quoteAddress;
        bool sellZeroForOne = !buyZeroForOne;
        swapRouter.swap(
            key,
            _swapParams(buyZeroForOne, EXACT_INPUT_AMOUNT),
            settings,
            bytes("OPTRA synthetic acceptance exact-input buy")
        );
        swapRouter.swap(
            key,
            _swapParams(buyZeroForOne, EXACT_OUTPUT_AMOUNT),
            settings,
            bytes("OPTRA synthetic acceptance exact-output buy")
        );

        guard.publishPolicy(true);
        swapRouter.swap(
            key,
            _swapParams(sellZeroForOne, EXACT_INPUT_AMOUNT),
            settings,
            bytes("OPTRA synthetic acceptance underlying-out exact-input")
        );
        swapRouter.swap(
            key,
            _swapParams(sellZeroForOne, EXACT_OUTPUT_AMOUNT),
            settings,
            bytes("OPTRA synthetic acceptance underlying-out exact-output")
        );
        vm.stopBroadcast();

        require(guard.entryPaused() && guard.policyPublished() && guard.isPolicyFresh(), "final pause readback failed");
        require(guard.configuredPoolId() == poolId, "final pool id readback mismatch");
        _requirePausedBuysRejected(swapRouter, key, settings, buyZeroForOne);

        console2.log("phase", "B: CONTROLLED TESTNET ACCEPTANCE");
        console2.log("deployer", deployer);
        console2.log("OptraGuardHook", hookAddress);
        console2.log("Pool ID");
        console2.logBytes32(poolId);
        console2.log("final policy published", guard.policyPublished());
        console2.log("final entry paused", guard.entryPaused());
        console2.log("final policy fresh", guard.isPolicyFresh());
        console2.log("denied exact-input and exact-output buys", true);
        console2.log("allowed underlying-out exact-input and exact-output swaps", true);
        console2.log("assets and all swap activity are synthetic Testnet-only demonstrations");
    }

    function _requirePausedBuysRejected(
        PoolSwapTest swapRouter,
        PoolKey memory key,
        PoolSwapTest.TestSettings memory settings,
        bool buyZeroForOne
    ) private {
        (bool exactInputAllowed,) = address(swapRouter)
            .call(
                abi.encodeWithSelector(
                    PoolSwapTest.swap.selector,
                    key,
                    _swapParams(buyZeroForOne, EXACT_INPUT_AMOUNT),
                    settings,
                    bytes("read-only verification: denied exact-input buy")
                )
            );
        require(!exactInputAllowed, "paused exact-input buy unexpectedly succeeded");

        (bool exactOutputAllowed,) = address(swapRouter)
            .call(
                abi.encodeWithSelector(
                    PoolSwapTest.swap.selector,
                    key,
                    _swapParams(buyZeroForOne, EXACT_OUTPUT_AMOUNT),
                    settings,
                    bytes("read-only verification: denied exact-output buy")
                )
            );
        require(!exactOutputAllowed, "paused exact-output buy unexpectedly succeeded");
    }

    function _poolKey(address tokenA, address tokenB, IHooks hooks) private pure returns (PoolKey memory key) {
        if (tokenA < tokenB) {
            key = PoolKey(Currency.wrap(tokenA), Currency.wrap(tokenB), POOL_FEE, TICK_SPACING, hooks);
        } else {
            key = PoolKey(Currency.wrap(tokenB), Currency.wrap(tokenA), POOL_FEE, TICK_SPACING, hooks);
        }
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
