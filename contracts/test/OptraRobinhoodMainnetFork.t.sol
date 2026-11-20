// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {OptraGuardHook} from "../src/OptraGuardHook.sol";
import {OptraTestnetCreate2Factory} from "../script/OptraTestnetDeployment.s.sol";
import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {IHooks} from "v4-core/interfaces/IHooks.sol";
import {TickMath} from "v4-core/libraries/TickMath.sol";
import {PoolManager} from "v4-core/PoolManager.sol";
import {PoolModifyLiquidityTest} from "v4-core/test/PoolModifyLiquidityTest.sol";
import {PoolSwapTest} from "v4-core/test/PoolSwapTest.sol";
import {Currency} from "v4-core/types/Currency.sol";
import {PoolId, PoolIdLibrary} from "v4-core/types/PoolId.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";
import {MockERC20} from "solmate/src/test/utils/mocks/MockERC20.sol";

/// @notice Transient fork simulation against Robinhood Mainnet's live v4 PoolManager.
/// @dev Mock tokens, hook, pool, liquidity, and swaps exist only in Foundry fork state.
contract OptraRobinhoodMainnetForkTest is Test {
    using PoolIdLibrary for PoolKey;

    uint256 private constant ROBINHOOD_MAINNET_CHAIN_ID = 4663;
    address private constant POOL_MANAGER = 0x8366a39CC670B4001A1121B8F6A443A643e40951;
    bytes32 private constant POOL_MANAGER_RUNTIME_SHA256 =
        0x6eb21c69298b064e37fcf8089a941ae096fe08c0f179b2d399567aef1b10585b;
    uint64 private constant POLICY_MAX_AGE = 300;
    uint24 private constant POOL_FEE = 3000;
    int24 private constant TICK_SPACING = 60;
    uint160 private constant Q96 = uint160(1 << 96);
    uint160 private constant HOOK_MASK = (1 << 14) - 1;
    uint160 private constant EXPECTED_HOOK_BITS = (1 << 13) | (1 << 7);
    uint256 private constant EXACT_INPUT_AMOUNT = 1e12;
    uint256 private constant EXACT_OUTPUT_AMOUNT = 1e6;

    IPoolManager private manager;
    MockERC20 private underlying;
    MockERC20 private quote;
    OptraGuardHook private hook;
    PoolKey private key;
    PoolModifyLiquidityTest private liquidityRouter;
    PoolSwapTest private swapRouter;

    function setUp() public {
        if (!vm.envOr("RUN_OPTRA_ROBINHOOD_MAINNET_FORK", false)) {
            vm.skip(true, "set RUN_OPTRA_ROBINHOOD_MAINNET_FORK=true for Mainnet fork simulation");
        }
        require(block.chainid == ROBINHOOD_MAINNET_CHAIN_ID, "Robinhood Mainnet chain ID 4663 required");

        manager = IPoolManager(POOL_MANAGER);
        assertEq(address(manager).code.length, 24_009, "PoolManager runtime size changed");
        assertEq(sha256(POOL_MANAGER.code), POOL_MANAGER_RUNTIME_SHA256, "PoolManager runtime changed");

        underlying = new MockERC20("OPTRA FORK ASSET", "fOPTRA", 18);
        quote = new MockERC20("OPTRA FORK QUOTE", "fUSDG", 18);
        underlying.mint(address(this), 1e24);
        quote.mint(address(this), 1e24);

        OptraTestnetCreate2Factory factory = new OptraTestnetCreate2Factory();
        bytes memory initCode = abi.encodePacked(
            type(OptraGuardHook).creationCode,
            abi.encode(
                manager,
                address(underlying),
                address(quote),
                address(this),
                address(this),
                address(0xBEEF),
                POLICY_MAX_AGE
            )
        );
        bytes32 initCodeHash = keccak256(initCode);
        bytes32 salt = _findSalt(address(factory), initCodeHash);
        address hookAddress = factory.deploy(salt, initCode);
        assertEq(uint160(hookAddress) & HOOK_MASK, EXPECTED_HOOK_BITS);
        hook = OptraGuardHook(hookAddress);

        key = _poolKey(address(underlying), address(quote), IHooks(hookAddress));
        liquidityRouter = new PoolModifyLiquidityTest(manager);
        swapRouter = new PoolSwapTest(manager);
        underlying.approve(address(liquidityRouter), type(uint256).max);
        quote.approve(address(liquidityRouter), type(uint256).max);
        underlying.approve(address(swapRouter), type(uint256).max);
        quote.approve(address(swapRouter), type(uint256).max);

        manager.initialize(key, Q96);
        liquidityRouter.modifyLiquidity(
            key,
            IPoolManager.ModifyLiquidityParams({
                tickLower: -120, tickUpper: 120, liquidityDelta: 1e18, salt: bytes32(0)
            }),
            bytes("")
        );
        assertTrue(hook.poolBound());
        assertEq(hook.configuredPoolId(), PoolId.unwrap(key.toId()));
    }

    function test_mainnetPoolManagerEnforcesFreshPolicyAndKeepsUnderlyingOutAvailable() public {
        PoolSwapTest.TestSettings memory settings =
            PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false});
        bool buyZeroForOne = address(underlying) > address(quote);
        bool sellZeroForOne = !buyZeroForOne;

        vm.expectRevert();
        swapRouter.swap(key, _swapParams(buyZeroForOne, -int256(EXACT_INPUT_AMOUNT)), settings, bytes("missing policy"));
        swapRouter.swap(
            key, _swapParams(sellZeroForOne, -int256(EXACT_INPUT_AMOUNT)), settings, bytes("underlying out")
        );

        vm.prank(address(0xBEEF));
        hook.publishPolicy(false);
        swapRouter.swap(
            key, _swapParams(buyZeroForOne, -int256(EXACT_INPUT_AMOUNT)), settings, bytes("fresh exact input buy")
        );
        swapRouter.swap(
            key, _swapParams(buyZeroForOne, int256(EXACT_OUTPUT_AMOUNT)), settings, bytes("fresh exact output buy")
        );

        vm.prank(address(0xBEEF));
        hook.publishPolicy(true);
        vm.expectRevert();
        swapRouter.swap(key, _swapParams(buyZeroForOne, -int256(EXACT_INPUT_AMOUNT)), settings, bytes("paused buy"));
        swapRouter.swap(
            key,
            _swapParams(sellZeroForOne, int256(EXACT_OUTPUT_AMOUNT)),
            settings,
            bytes("paused exact output underlying out")
        );

        vm.prank(address(0xBEEF));
        hook.publishPolicy(false);
        vm.warp(block.timestamp + POLICY_MAX_AGE + 1);
        assertFalse(hook.isPolicyFresh());
        vm.expectRevert();
        swapRouter.swap(key, _swapParams(buyZeroForOne, -int256(EXACT_INPUT_AMOUNT)), settings, bytes("stale buy"));
        swapRouter.swap(
            key, _swapParams(sellZeroForOne, -int256(EXACT_INPUT_AMOUNT)), settings, bytes("stale underlying out")
        );
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

    function _poolKey(address tokenA, address tokenB, IHooks hooks) private pure returns (PoolKey memory poolKey) {
        if (tokenA < tokenB) {
            poolKey = PoolKey(Currency.wrap(tokenA), Currency.wrap(tokenB), POOL_FEE, TICK_SPACING, hooks);
        } else {
            poolKey = PoolKey(Currency.wrap(tokenB), Currency.wrap(tokenA), POOL_FEE, TICK_SPACING, hooks);
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
