// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script} from "forge-std/Script.sol";
import {VmSafe} from "forge-std/Vm.sol";
import {console2} from "forge-std/console2.sol";
import {OptraGuardHook} from "../src/OptraGuardHook.sol";
import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {IHooks} from "v4-core/interfaces/IHooks.sol";
import {Hooks} from "v4-core/libraries/Hooks.sol";
import {PoolModifyLiquidityTest} from "v4-core/test/PoolModifyLiquidityTest.sol";
import {PoolSwapTest} from "v4-core/test/PoolSwapTest.sol";
import {Currency} from "v4-core/types/Currency.sol";
import {PoolId, PoolIdLibrary} from "v4-core/types/PoolId.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";
import {MockERC20} from "solmate/src/test/utils/mocks/MockERC20.sol";

/// @dev Permissionless CREATE2 helper for mining/deploying the hook from a testnet script.
contract OptraTestnetCreate2Factory {
    error Create2DeploymentFailed();
    error InvalidPermissionBits(uint160 actualBits);

    uint160 internal constant HOOK_MASK = (1 << 14) - 1;
    uint160 internal constant EXPECTED_HOOK_BITS = (1 << 13) | (1 << 7);

    function deploy(bytes32 salt, bytes calldata initCode) external returns (address deployed) {
        bytes memory code = initCode;
        assembly ("memory-safe") {
            deployed := create2(0, add(code, 0x20), mload(code), salt)
        }
        if (deployed == address(0)) revert Create2DeploymentFailed();

        uint160 actualBits = uint160(deployed) & HOOK_MASK;
        if (actualBits != EXPECTED_HOOK_BITS) revert InvalidPermissionBits(actualBits);
    }
}

/// @notice Phase A deploys and initializes a paused, synthetic Testnet pool.
/// @dev Dry-run is allowed without approval; broadcast/resume requires explicit owner approval.
contract OptraTestnetDeployment is Script {
    using PoolIdLibrary for PoolKey;

    uint256 internal constant ROBINHOOD_TESTNET_CHAIN_ID = 46630;
    address internal constant ROBINHOOD_TESTNET_POOL_MANAGER = 0x8366a39CC670B4001A1121B8F6A443A643e40951;
    // SHA-256 matched live Testnet RPC runtime bytecode to Blockscout's deployed bytecode
    // at finalized fork block 154028053 on 2026-11-16.
    bytes32 internal constant EXPECTED_POOL_MANAGER_BYTECODE_SHA256 =
        0x6eb21c69298b064e37fcf8089a941ae096fe08c0f179b2d399567aef1b10585b;
    uint160 internal constant HOOK_MASK = (1 << 14) - 1;
    uint160 internal constant EXPECTED_HOOK_BITS = (1 << 13) | (1 << 7);
    uint64 internal constant ACCEPTANCE_POLICY_MAX_AGE = 300;
    uint24 internal constant POOL_FEE = 3000;
    int24 internal constant TICK_SPACING = 60;
    uint160 internal constant INITIAL_SQRT_PRICE_X96 = uint160(1 << 96);

    function run() external {
        require(block.chainid == ROBINHOOD_TESTNET_CHAIN_ID, "Robinhood Testnet chain ID 46630 required");
        bool broadcasting =
            vm.isContext(VmSafe.ForgeContext.ScriptBroadcast) || vm.isContext(VmSafe.ForgeContext.ScriptResume);
        if (broadcasting) {
            require(
                vm.envOr("OPTRA_TESTNET_DEPLOYMENT_APPROVED", false),
                "owner approval required for public Testnet transactions"
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

        vm.startBroadcast();
        // These unrestricted-mint assets and v4 test helpers are synthetic test fixtures only.
        MockERC20 underlying = new MockERC20("OPTRA TEST ASSET", "mOPTRA", 18);
        MockERC20 quote = new MockERC20("OPTRA TEST QUOTE", "mUSDG", 18);
        OptraTestnetCreate2Factory factory = new OptraTestnetCreate2Factory();
        PoolModifyLiquidityTest liquidityRouter = new PoolModifyLiquidityTest(manager);
        PoolSwapTest swapRouter = new PoolSwapTest(manager);

        bytes memory initCode = abi.encodePacked(
            type(OptraGuardHook).creationCode,
            abi.encode(
                manager, address(underlying), address(quote), deployer, deployer, deployer, ACCEPTANCE_POLICY_MAX_AGE
            )
        );
        bytes32 initCodeHash = keccak256(initCode);
        bytes32 salt = _findSalt(address(factory), initCodeHash);
        address expectedHook = _create2Address(address(factory), salt, initCodeHash);
        address hook = factory.deploy(salt, initCode);
        require(hook == expectedHook, "CREATE2 address mismatch");
        require(uint160(hook) & HOOK_MASK == EXPECTED_HOOK_BITS, "hook callback flags mismatch");

        PoolKey memory key = _poolKey(address(underlying), address(quote), IHooks(hook));
        manager.initialize(key, INITIAL_SQRT_PRICE_X96);
        OptraGuardHook guard = OptraGuardHook(hook);
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
        require(Hooks.isValidHookAddress(IHooks(hook), POOL_FEE), "hook address invalid for fee");
        vm.stopBroadcast();

        OptraGuardHook readback = OptraGuardHook(hook);
        require(readback.poolBound(), "hook pool binding readback failed");
        require(readback.configuredPoolId() == PoolId.unwrap(key.toId()), "pool id readback mismatch");
        require(
            readback.poolCreator() == deployer && readback.admin() == deployer && readback.keeper() == deployer,
            "hook role readback mismatch"
        );
        require(readback.maxPolicyAge() == ACCEPTANCE_POLICY_MAX_AGE, "acceptance expiry readback mismatch");
        require(readback.entryPaused() && !readback.policyPublished(), "Phase A must finish paused without policy");
        require(underlying.decimals() == 18 && quote.decimals() == 18, "test asset decimals mismatch");

        console2.log("phase", "A: SAFE DEPLOYMENT");
        console2.log("chain id", block.chainid);
        console2.log("deployer", deployer);
        console2.log("PoolManager", address(manager));
        console2.log("mock underlying mOPTRA", address(underlying));
        console2.log("mock quote mUSDG", address(quote));
        console2.log("CREATE2 factory", address(factory));
        console2.log("test-only liquidity router", address(liquidityRouter));
        console2.log("test-only swap router", address(swapRouter));
        console2.log("OptraGuardHook", hook);
        console2.log("pool id");
        console2.logBytes32(PoolId.unwrap(key.toId()));
        console2.log("CREATE2 salt");
        console2.logBytes32(salt);
        console2.log("init code hash");
        console2.logBytes32(initCodeHash);
        console2.log("constructor args (ABI encoded)");
        console2.logBytes(
            abi.encode(
                manager, address(underlying), address(quote), deployer, deployer, deployer, ACCEPTANCE_POLICY_MAX_AGE
            )
        );
        console2.log("fee", uint256(POOL_FEE));
        console2.log("tick spacing", int256(TICK_SPACING));
        console2.log("initial sqrt price X96", uint256(INITIAL_SQRT_PRICE_X96));
        console2.log("acceptance policy max age seconds", uint256(ACCEPTANCE_POLICY_MAX_AGE));
        console2.log("entry paused", readback.entryPaused());
        console2.log("policy published", readback.policyPublished());
        console2.log(
            "Verification: forge verify-contract <HOOK> src/OptraGuardHook.sol:OptraGuardHook --chain 46630 --verifier blockscout --verifier-url https://explorer.testnet.chain.robinhood.com/api/ --constructor-args <ENCODED_CONSTRUCTOR_ARGS> --compiler-version v0.8.26 --optimizer-runs 44444444 --via-ir --evm-version cancun"
        );
        console2.log("Phase A leaves the synthetic pool without minted supply, liquidity, or an active policy.");
    }

    function _poolKey(address tokenA, address tokenB, IHooks hooks) private pure returns (PoolKey memory key) {
        if (tokenA < tokenB) {
            key = PoolKey(Currency.wrap(tokenA), Currency.wrap(tokenB), POOL_FEE, TICK_SPACING, hooks);
        } else {
            key = PoolKey(Currency.wrap(tokenB), Currency.wrap(tokenA), POOL_FEE, TICK_SPACING, hooks);
        }
    }

    function _findSalt(address deployer, bytes32 initCodeHash) private pure returns (bytes32 salt) {
        for (uint256 i; i < 1_000_000; i++) {
            salt = bytes32(i);
            if (uint160(_create2Address(deployer, salt, initCodeHash)) & HOOK_MASK == EXPECTED_HOOK_BITS) {
                return salt;
            }
        }
        revert("CREATE2 permission salt not found");
    }

    function _create2Address(address deployer, bytes32 salt, bytes32 initCodeHash) private pure returns (address) {
        return address(uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), deployer, salt, initCodeHash)))));
    }
}
