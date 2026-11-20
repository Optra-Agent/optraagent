// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {OptraGuardHook} from "../src/OptraGuardHook.sol";
import {Hooks} from "v4-core/libraries/Hooks.sol";
import {TickMath} from "v4-core/libraries/TickMath.sol";
import {IHooks} from "v4-core/interfaces/IHooks.sol";
import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {PoolManager} from "v4-core/PoolManager.sol";
import {PoolModifyLiquidityTest} from "v4-core/test/PoolModifyLiquidityTest.sol";
import {PoolSwapTest} from "v4-core/test/PoolSwapTest.sol";
import {Currency} from "v4-core/types/Currency.sol";
import {PoolId, PoolIdLibrary} from "v4-core/types/PoolId.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";
import {MockERC20} from "solmate/src/test/utils/mocks/MockERC20.sol";

/// @dev Temporary unrestricted CREATE2 helper used only by this local simulation script.
contract OptraSimulationCreate2Factory {
    error HookAddressBitsMismatch(address deployed, uint160 actualBits, uint160 expectedBits);
    error Create2DeploymentFailed();

    function deploy(bytes32 salt, bytes calldata initCode, uint160 expectedHookBits)
        external
        returns (address deployed)
    {
        bytes memory code = initCode;
        assembly ("memory-safe") {
            deployed := create2(0, add(code, 0x20), mload(code), salt)
        }
        if (deployed == address(0)) revert Create2DeploymentFailed();

        uint160 mask = (1 << 14) - 1;
        uint160 actualBits = uint160(deployed) & mask;
        if (actualBits != expectedHookBits) {
            revert HookAddressBitsMismatch(deployed, actualBits, expectedHookBits);
        }
    }
}

/// @notice Local-only v4 integration proof. The script hard-fails on any non-Anvil chain ID.
contract OptraLocalSimulation is Script {
    using PoolIdLibrary for PoolKey;

    uint256 internal constant LOCAL_ANVIL_CHAIN_ID = 31337;
    uint64 internal constant POLICY_MAX_AGE = 300;
    uint24 internal constant POOL_FEE = 3000;
    int24 internal constant TICK_SPACING = 60;
    uint160 internal constant HOOK_MASK = (1 << 14) - 1;
    uint160 internal constant EXPECTED_HOOK_BITS = (1 << 13) | (1 << 7);
    uint160 internal constant SQRT_PRICE_1_1 = uint160(1 << 96);

    function run() external {
        require(block.chainid == LOCAL_ANVIL_CHAIN_ID, "local Anvil chain ID 31337 required");

        uint256 privateKey = vm.envOr(
            "OPTRA_ANVIL_PRIVATE_KEY", uint256(0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80)
        );
        address deployer = vm.addr(privateKey);

        vm.startBroadcast(privateKey);
        PoolManager manager = new PoolManager(deployer);
        MockERC20 underlying = new MockERC20("OPTRA Local Asset", "OLA", 18);
        MockERC20 quote = new MockERC20("OPTRA Local Quote", "OLQ", 18);
        OptraSimulationCreate2Factory create2Factory = new OptraSimulationCreate2Factory();
        PoolModifyLiquidityTest liquidityRouter = new PoolModifyLiquidityTest(manager);
        PoolSwapTest swapRouter = new PoolSwapTest(manager);

        underlying.mint(deployer, 1e24);
        quote.mint(deployer, 1e24);
        underlying.approve(address(liquidityRouter), type(uint256).max);
        quote.approve(address(liquidityRouter), type(uint256).max);
        underlying.approve(address(swapRouter), type(uint256).max);
        quote.approve(address(swapRouter), type(uint256).max);

        bytes memory initCode = abi.encodePacked(
            type(OptraGuardHook).creationCode,
            abi.encode(manager, address(underlying), address(quote), deployer, deployer, deployer, POLICY_MAX_AGE)
        );
        bytes32 salt = _findSalt(address(create2Factory), keccak256(initCode));
        address expectedHook = _create2Address(address(create2Factory), salt, keccak256(initCode));
        address deployedHook = create2Factory.deploy(salt, initCode, EXPECTED_HOOK_BITS);
        require(deployedHook == expectedHook, "CREATE2 address mismatch");

        PoolKey memory key = _poolKey(address(underlying), address(quote), IHooks(deployedHook));
        manager.initialize(key, SQRT_PRICE_1_1);

        liquidityRouter.modifyLiquidity(
            key,
            IPoolManager.ModifyLiquidityParams({
                tickLower: -120, tickUpper: 120, liquidityDelta: 1e18, salt: bytes32(0)
            }),
            bytes("")
        );

        OptraGuardHook hook = OptraGuardHook(deployedHook);
        hook.publishPolicy(false);
        require(hook.policyPublished(), "policy publication not readable");
        require(!hook.entryPaused(), "policy should allow risk-increasing swaps");
        require(hook.isPolicyFresh(), "new policy should be fresh");

        bool buyZeroForOne = address(underlying) > address(quote);
        IPoolManager.SwapParams memory buy = _swapParams(buyZeroForOne);
        PoolSwapTest.TestSettings memory settings =
            PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false});
        swapRouter.swap(key, buy, settings, bytes("ordinary caller data"));
        swapRouter.swap(key, _exactOutputParams(buyZeroForOne), settings, bytes("exact output underlying buy"));

        hook.publishPolicy(true);
        require(hook.entryPaused(), "pause policy should be readable");
        require(PoolId.unwrap(key.toId()) == hook.configuredPoolId(), "pool binding readback mismatch");
        vm.stopBroadcast();

        // These calls intentionally remain simulations: a rejected attempt is not useful
        // as a broadcast transaction and should not make forge script fail.
        vm.prank(deployer);
        (bool pausedBuySucceeded,) = address(swapRouter)
            .call(abi.encodeWithSelector(PoolSwapTest.swap.selector, key, buy, settings, bytes("attempt during pause")));
        require(!pausedBuySucceeded, "paused risk-increasing swap unexpectedly succeeded");
        IPoolManager.SwapParams memory exactOutputBuy = _exactOutputParams(buyZeroForOne);
        vm.prank(deployer);
        (bool pausedExactOutputBuySucceeded,) = address(swapRouter)
            .call(
                abi.encodeWithSelector(
                    PoolSwapTest.swap.selector, key, exactOutputBuy, settings, bytes("paused exact output buy")
                )
            );
        require(!pausedExactOutputBuySucceeded, "paused exact-output buy unexpectedly succeeded");

        bool sellZeroForOne = address(underlying) < address(quote);
        IPoolManager.SwapParams memory sell = _swapParams(sellZeroForOne);
        IPoolManager.SwapParams memory exactOutputSell = _exactOutputParams(sellZeroForOne);
        vm.prank(deployer);
        (bool sellSucceeded,) = address(swapRouter)
            .call(abi.encodeWithSelector(PoolSwapTest.swap.selector, key, sell, settings, bytes("underlying out")));
        require(sellSucceeded, "paused underlying-out simulation failed");
        vm.prank(deployer);
        (bool exactOutputSellSucceeded,) = address(swapRouter)
            .call(
                abi.encodeWithSelector(
                    PoolSwapTest.swap.selector, key, exactOutputSell, settings, bytes("exact output underlying out")
                )
            );
        require(exactOutputSellSucceeded, "paused exact-output underlying-out simulation failed");

        console2.log("local chain id", block.chainid);
        console2.log("PoolManager", address(manager));
        console2.log("Hook CREATE2 factory", address(create2Factory));
        console2.log("OptraGuardHook", deployedHook);
        console2.log("Pool ID");
        console2.logBytes32(PoolId.unwrap(key.toId()));
        console2.log("CREATE2 salt");
        console2.logBytes32(salt);
        console2.log("init code hash");
        console2.logBytes32(keccak256(initCode));
        console2.log("hook permission bits", uint160(deployedHook) & HOOK_MASK);
        console2.log("pool bound", hook.poolBound());
        console2.log("policy published", hook.policyPublished());
        console2.log("entry paused", hook.entryPaused());
        console2.log("policy timestamp", uint256(hook.policyUpdatedAt()));
        console2.log(
            "Local transactions include exact-input/output buys and underlying-out swaps; paused buys are simulated as rejected calls."
        );
    }

    function _poolKey(address tokenA, address tokenB, IHooks hooks) private pure returns (PoolKey memory key) {
        if (tokenA < tokenB) {
            key = PoolKey(Currency.wrap(tokenA), Currency.wrap(tokenB), POOL_FEE, TICK_SPACING, hooks);
        } else {
            key = PoolKey(Currency.wrap(tokenB), Currency.wrap(tokenA), POOL_FEE, TICK_SPACING, hooks);
        }
    }

    function _swapParams(bool zeroForOne) private pure returns (IPoolManager.SwapParams memory) {
        return IPoolManager.SwapParams({
            zeroForOne: zeroForOne,
            amountSpecified: -int256(1e12),
            sqrtPriceLimitX96: zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1
        });
    }

    function _exactOutputParams(bool zeroForOne) private pure returns (IPoolManager.SwapParams memory) {
        return IPoolManager.SwapParams({
            zeroForOne: zeroForOne,
            amountSpecified: int256(1e6),
            sqrtPriceLimitX96: zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1
        });
    }

    function _findSalt(address deployer, bytes32 initCodeHash) private pure returns (bytes32 salt) {
        for (uint256 i; i < 1_000_000; i++) {
            salt = bytes32(i);
            address candidate = _create2Address(deployer, salt, initCodeHash);
            if (uint160(candidate) & HOOK_MASK == EXPECTED_HOOK_BITS) return salt;
        }
        revert("CREATE2 permission salt not found");
    }

    function _create2Address(address deployer, bytes32 salt, bytes32 initCodeHash) private pure returns (address) {
        return address(uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), deployer, salt, initCodeHash)))));
    }
}
