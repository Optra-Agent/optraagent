// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {OptraGuardHook} from "../src/OptraGuardHook.sol";
import {IHooks} from "v4-core/interfaces/IHooks.sol";
import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {TickMath} from "v4-core/libraries/TickMath.sol";
import {PoolModifyLiquidityTest} from "v4-core/test/PoolModifyLiquidityTest.sol";
import {PoolSwapTest} from "v4-core/test/PoolSwapTest.sol";
import {Currency} from "v4-core/types/Currency.sol";
import {PoolId, PoolIdLibrary} from "v4-core/types/PoolId.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";
import {MockERC20} from "solmate/src/test/utils/mocks/MockERC20.sol";

/// @notice Fork-only integration against Robinhood Testnet's deployed PoolManager.
/// @dev Runs only with --fork-url, optionally pinned to an archive block. All deployments,
///      pool state, liquidity and swaps are transient Foundry fork state; nothing is broadcast.
contract OptraRobinhoodForkTest is Test {
    using PoolIdLibrary for PoolKey;

    uint256 private constant ROBINHOOD_TESTNET_CHAIN_ID = 46630;
    address private constant POOL_MANAGER = 0x8366a39CC670B4001A1121B8F6A443A643e40951;
    bytes32 private constant POOL_MANAGER_RUNTIME_SHA256 =
        0x6eb21c69298b064e37fcf8089a941ae096fe08c0f179b2d399567aef1b10585b;
    uint64 private constant POLICY_MAX_AGE = 1 days;
    uint24 private constant POOL_FEE = 3000;
    int24 private constant TICK_SPACING = 60;
    uint160 private constant Q96 = uint160(1 << 96);
    uint160 private constant HOOK_MASK = (1 << 14) - 1;
    uint160 private constant EXPECTED_HOOK_BITS = (1 << 13) | (1 << 7);

    IPoolManager private manager;
    MockERC20 private underlying;
    MockERC20 private quote;
    OptraGuardHook private hook;
    PoolKey private key;
    PoolModifyLiquidityTest private liquidityRouter;
    PoolSwapTest private swapRouter;

    function setUp() public {
        if (block.chainid != ROBINHOOD_TESTNET_CHAIN_ID) {
            vm.skip(true, "use the Robinhood Testnet fork command in contracts/README.md");
        }
        // Robinhood is Arbitrum-based: Solidity block.number reflects the L1 number here.
        // Set this env value only with an archive RPC and a pinned L2 fork block.
        uint256 expectedTimestamp = vm.envOr("OPTRA_RH_FORK_TIMESTAMP", uint256(0));
        if (expectedTimestamp != 0) {
            assertEq(block.timestamp, expectedTimestamp, "fork timestamp must match the pinned L2 block");
        }
        manager = IPoolManager(POOL_MANAGER);
        assertEq(sha256(POOL_MANAGER.code), POOL_MANAGER_RUNTIME_SHA256, "PoolManager runtime changed");

        underlying = new MockERC20("OPTRA TEST ASSET", "mOPTRA", 18);
        quote = new MockERC20("OPTRA TEST QUOTE", "mUSDG", 18);
        underlying.mint(address(this), 1e24);
        quote.mint(address(this), 1e24);

        hook = _deployHook();
        key = _poolKey(address(underlying), address(quote), IHooks(address(hook)));
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
        assertTrue(address(manager).code.length > 0);
    }

    function test_realPoolManager_initializesSeedsAndEnforcesPolicyForMockPool() public {
        bool buyZeroForOne = address(underlying) > address(quote);
        bool sellZeroForOne = !buyZeroForOne;
        PoolSwapTest.TestSettings memory settings =
            PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false});

        // PoolManager wraps hook reverts with ERC-7751 context, so assert the EVM-level block here.
        // The unit suite separately checks the unwrapped MissingPolicy selector.
        vm.expectRevert();
        swapRouter.swap(key, _exactInput(buyZeroForOne), settings, bytes("ignored caller data"));
        swapRouter.swap(key, _exactInput(sellZeroForOne), settings, bytes("underlying out"));

        hook.publishPolicy(false);
        swapRouter.swap(key, _exactInput(buyZeroForOne), settings, bytes("exact input buy"));
        swapRouter.swap(key, _exactOutput(buyZeroForOne), settings, bytes("exact output buy"));

        hook.publishPolicy(true);
        vm.expectRevert();
        swapRouter.swap(key, _exactInput(buyZeroForOne), settings, bytes("paused exact input buy"));
        vm.expectRevert();
        swapRouter.swap(key, _exactOutput(buyZeroForOne), settings, bytes("paused exact output buy"));

        swapRouter.swap(key, _exactInput(sellZeroForOne), settings, bytes("paused exact input sell"));
        swapRouter.swap(key, _exactOutput(sellZeroForOne), settings, bytes("paused exact output sell"));
        assertTrue(hook.entryPaused());
        assertTrue(hook.isPolicyFresh());
        assertEq(hook.configuredPoolId(), PoolId.unwrap(key.toId()));
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
                POLICY_MAX_AGE
            )
        );
        bytes32 initCodeHash = keccak256(initCode);
        bytes32 salt;
        address predicted;
        bool found;
        for (uint256 i; i < 1_000_000; i++) {
            salt = bytes32(i);
            predicted =
                address(uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), address(this), salt, initCodeHash)))));
            if (uint160(predicted) & HOOK_MASK == EXPECTED_HOOK_BITS) {
                found = true;
                break;
            }
        }
        require(found, "CREATE2 permission salt not found");

        address deployed;
        assembly ("memory-safe") {
            deployed := create2(0, add(initCode, 0x20), mload(initCode), salt)
        }
        require(deployed == predicted, "CREATE2 deployment mismatch");
        assertEq(uint160(deployed) & HOOK_MASK, EXPECTED_HOOK_BITS);
        deployedHook = OptraGuardHook(deployed);
    }

    function _poolKey(address tokenA, address tokenB, IHooks hooks) private pure returns (PoolKey memory poolKey) {
        if (tokenA < tokenB) {
            poolKey = PoolKey(Currency.wrap(tokenA), Currency.wrap(tokenB), POOL_FEE, TICK_SPACING, hooks);
        } else {
            poolKey = PoolKey(Currency.wrap(tokenB), Currency.wrap(tokenA), POOL_FEE, TICK_SPACING, hooks);
        }
    }

    function _exactInput(bool zeroForOne) private pure returns (IPoolManager.SwapParams memory) {
        return IPoolManager.SwapParams({
            zeroForOne: zeroForOne,
            amountSpecified: -int256(1e12),
            sqrtPriceLimitX96: zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1
        });
    }

    function _exactOutput(bool zeroForOne) private pure returns (IPoolManager.SwapParams memory) {
        return IPoolManager.SwapParams({
            zeroForOne: zeroForOne,
            amountSpecified: int256(1e6),
            sqrtPriceLimitX96: zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1
        });
    }
}
