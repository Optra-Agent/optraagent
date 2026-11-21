// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IHooks} from "v4-core/interfaces/IHooks.sol";
import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {Hooks} from "v4-core/libraries/Hooks.sol";
import {BeforeSwapDelta} from "v4-core/types/BeforeSwapDelta.sol";
import {BalanceDelta} from "v4-core/types/BalanceDelta.sol";
import {Currency} from "v4-core/types/Currency.sol";
import {PoolId, PoolIdLibrary} from "v4-core/types/PoolId.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";

/// @notice Experimental one-pool gate for risk-increasing swaps in an OPTRA-controlled v4 spot pool.
/// @dev This hook cannot identify options orders, user exposure, or position exits.
contract OptraGuardHook is IHooks {
    using PoolIdLibrary for PoolKey;

    error InvalidConfiguration();
    error UnauthorizedAdmin();
    error UnauthorizedKeeper();
    error UnauthorizedCallback();
    error UnsupportedCallback();
    error WrongPoolCreator();
    error WrongPoolPair();
    error PoolAlreadyBound();
    error PoolNotBound();
    error MissingPolicy();
    error EntriesPaused();
    error StalePolicy(uint64 updatedAt, uint256 currentTime, uint64 maxAge);
    error TimestampOutOfRange();

    uint64 public constant MAX_POLICY_AGE = 15 minutes;
    address private constant ROBINHOOD_MAINNET_POOL_MANAGER = 0x8366a39CC670B4001A1121B8F6A443A643e40951;

    event KeeperChanged(address indexed previousKeeper, address indexed newKeeper);
    event PolicyPublished(bool entryPaused, uint64 publishedAt, address indexed keeper);
    event PoolBound(bytes32 indexed poolId, address indexed creator);

    IPoolManager public immutable poolManager;
    /// @notice address(0) represents native ETH; quoteToken must always be an ERC-20.
    address public immutable underlyingToken;
    address public immutable quoteToken;
    address public immutable poolCreator;
    address public immutable admin;
    uint64 public immutable maxPolicyAge;

    address public keeper;
    bytes32 public configuredPoolId;
    bool public poolBound;
    bool public policyPublished;
    bool public entryPaused;
    uint64 public policyUpdatedAt;

    modifier onlyPoolManager() {
        if (msg.sender != address(poolManager)) revert UnauthorizedCallback();
        _;
    }

    constructor(
        IPoolManager poolManager_,
        // address(0) is intentionally valid here to represent native ETH.
        // forge-lint: disable-next-line(missing-zero-check)
        address underlyingToken_,
        address quoteToken_,
        address poolCreator_,
        address admin_,
        address keeper_,
        uint64 maxPolicyAge_
    ) {
        if (
            address(poolManager_) == address(0) || address(poolManager_).code.length == 0
                || (underlyingToken_ != address(0) && underlyingToken_.code.length == 0) || quoteToken_ == address(0)
                || quoteToken_.code.length == 0 || underlyingToken_ == quoteToken_ || poolCreator_ == address(0)
                || admin_ == address(0) || keeper_ == address(0) || maxPolicyAge_ == 0 || maxPolicyAge_ > MAX_POLICY_AGE
        ) revert InvalidConfiguration();

        if (
            block.chainid == 4663
                && (address(poolManager_) != ROBINHOOD_MAINNET_POOL_MANAGER
                    || poolCreator_.code.length == 0
                    || admin_.code.length == 0
                    || keeper_ == admin_)
        ) {
            revert InvalidConfiguration();
        }

        poolManager = poolManager_;
        underlyingToken = underlyingToken_;
        quoteToken = quoteToken_;
        poolCreator = poolCreator_;
        admin = admin_;
        keeper = keeper_;
        maxPolicyAge = maxPolicyAge_;
        entryPaused = true;

        Hooks.validateHookPermissions(IHooks(address(this)), getHookPermissions());
    }

    function getHookPermissions() public pure returns (Hooks.Permissions memory permissions) {
        permissions.beforeInitialize = true;
        permissions.beforeSwap = true;
    }

    /// @notice Binds this instance to the first matching pool initialized by its immutable creator.
    function beforeInitialize(address sender, PoolKey calldata key, uint160)
        external
        override
        onlyPoolManager
        returns (bytes4)
    {
        if (poolBound) revert PoolAlreadyBound();
        if (sender != poolCreator) revert WrongPoolCreator();
        if (!_matchesConfiguredPair(key)) revert WrongPoolPair();
        if (address(key.hooks) != address(this)) revert WrongPoolPair();

        configuredPoolId = PoolId.unwrap(key.toId());
        poolBound = true;
        emit PoolBound(configuredPoolId, sender);
        return IHooks.beforeInitialize.selector;
    }

    /// @notice Keeper-published pause state is timestamped by the chain, never by caller-supplied data.
    function publishPolicy(bool pauseEntries) external {
        if (msg.sender != keeper) revert UnauthorizedKeeper();
        // Chain time is the only clock available to this onchain freshness gate; the
        // configured age bound limits, but cannot eliminate, validator timestamp influence.
        // forge-lint: disable-next-line(block-timestamp)
        if (block.timestamp > type(uint64).max) revert TimestampOutOfRange();

        policyPublished = true;
        entryPaused = pauseEntries;
        // forge-lint: disable-next-line(unsafe-typecast)
        policyUpdatedAt = uint64(block.timestamp);
        emit PolicyPublished(pauseEntries, policyUpdatedAt, msg.sender);
    }

    /// @notice The immutable admin can rotate or revoke the keeper; rotation invalidates old policy state.
    function setKeeper(address newKeeper) external {
        if (msg.sender != admin) revert UnauthorizedAdmin();
        if (newKeeper == address(0)) revert InvalidConfiguration();
        if (block.chainid == 4663 && newKeeper == admin) revert InvalidConfiguration();

        _setKeeper(newKeeper);
    }

    /// @notice Admin emergency revocation invalidates policy and leaves risk-increasing swaps blocked.
    function revokeKeeper() external {
        if (msg.sender != admin) revert UnauthorizedAdmin();
        _setKeeper(address(0));
    }

    function _setKeeper(address newKeeper) private {
        address previousKeeper = keeper;
        keeper = newKeeper;
        policyPublished = false;
        entryPaused = true;
        policyUpdatedAt = 0;
        emit KeeperChanged(previousKeeper, newKeeper);
    }

    function isPolicyFresh() external view returns (bool) {
        if (!policyPublished) return false;
        // forge-lint: disable-next-line(block-timestamp)
        if (block.timestamp < policyUpdatedAt) return false;
        // forge-lint: disable-next-line(block-timestamp)
        return block.timestamp - policyUpdatedAt <= maxPolicyAge;
    }

    function beforeSwap(address, PoolKey calldata key, IPoolManager.SwapParams calldata params, bytes calldata)
        external
        view
        override
        onlyPoolManager
        returns (bytes4, BeforeSwapDelta, uint24)
    {
        _requireConfiguredPool(key);

        // A sell of the configured underlying out of this pool is always permitted. This is
        // only token direction; it does not prove an options position is being closed.
        if (_sellsUnderlying(params.zeroForOne)) {
            return (IHooks.beforeSwap.selector, BeforeSwapDelta.wrap(0), 0);
        }

        if (!policyPublished) revert MissingPolicy();
        if (entryPaused) revert EntriesPaused();
        // forge-lint: disable-next-line(block-timestamp)
        if (block.timestamp < policyUpdatedAt || block.timestamp - policyUpdatedAt > maxPolicyAge) {
            revert StalePolicy(policyUpdatedAt, block.timestamp, maxPolicyAge);
        }

        return (IHooks.beforeSwap.selector, BeforeSwapDelta.wrap(0), 0);
    }

    function _matchesConfiguredPair(PoolKey calldata key) private view returns (bool) {
        address currency0 = Currency.unwrap(key.currency0);
        address currency1 = Currency.unwrap(key.currency1);
        return address(key.hooks) == address(this)
            && ((currency0 == underlyingToken && currency1 == quoteToken)
                || (currency1 == underlyingToken && currency0 == quoteToken));
    }

    function _requireConfiguredPool(PoolKey calldata key) private view {
        if (!poolBound) revert PoolNotBound();
        if (PoolId.unwrap(key.toId()) != configuredPoolId || !_matchesConfiguredPair(key)) revert WrongPoolPair();
    }

    function _sellsUnderlying(bool zeroForOne) private view returns (bool) {
        // Currency order is address-sorted by v4; address(0) sorts native ETH first.
        bool underlyingIsCurrency0 = underlyingToken < quoteToken;
        return underlyingIsCurrency0 ? zeroForOne : !zeroForOne;
    }

    function afterInitialize(address, PoolKey calldata, uint160, int24)
        external
        view
        override
        onlyPoolManager
        returns (bytes4)
    {
        revert UnsupportedCallback();
    }

    function beforeAddLiquidity(address, PoolKey calldata, IPoolManager.ModifyLiquidityParams calldata, bytes calldata)
        external
        view
        override
        onlyPoolManager
        returns (bytes4)
    {
        revert UnsupportedCallback();
    }

    function afterAddLiquidity(
        address,
        PoolKey calldata,
        IPoolManager.ModifyLiquidityParams calldata,
        BalanceDelta,
        BalanceDelta,
        bytes calldata
    ) external view override onlyPoolManager returns (bytes4, BalanceDelta) {
        revert UnsupportedCallback();
    }

    function beforeRemoveLiquidity(
        address,
        PoolKey calldata,
        IPoolManager.ModifyLiquidityParams calldata,
        bytes calldata
    ) external view override onlyPoolManager returns (bytes4) {
        revert UnsupportedCallback();
    }

    function afterRemoveLiquidity(
        address,
        PoolKey calldata,
        IPoolManager.ModifyLiquidityParams calldata,
        BalanceDelta,
        BalanceDelta,
        bytes calldata
    ) external view override onlyPoolManager returns (bytes4, BalanceDelta) {
        revert UnsupportedCallback();
    }

    function afterSwap(address, PoolKey calldata, IPoolManager.SwapParams calldata, BalanceDelta, bytes calldata)
        external
        view
        override
        onlyPoolManager
        returns (bytes4, int128)
    {
        revert UnsupportedCallback();
    }

    function beforeDonate(address, PoolKey calldata, uint256, uint256, bytes calldata)
        external
        view
        override
        onlyPoolManager
        returns (bytes4)
    {
        revert UnsupportedCallback();
    }

    function afterDonate(address, PoolKey calldata, uint256, uint256, bytes calldata)
        external
        view
        override
        onlyPoolManager
        returns (bytes4)
    {
        revert UnsupportedCallback();
    }
}
