// SPDX-License-Identifier: BUSL-1.1
// Teahouse Finance

pragma solidity =0.8.26;

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {ERC20Upgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {PausableUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import {ReentrancyGuardUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {FullMath} from "@uniswap/v3-core/contracts/libraries/FullMath.sol";

import {ICrocSwapDex} from "./interface/ICrocSwapDex.sol";
import {ICrocImpact} from "./interface/ICrocImpact.sol";
import {ICrocQuery} from "./interface/ICrocQuery.sol";
import {ITeaVaultAmbientFactory} from "./interface/ITeaVaultAmbientFactory.sol";
import {ITeaVaultAmbient} from "./interface/ITeaVaultAmbient.sol";
import {ISwapRelayer} from "./interface/ISwapRelayer.sol";
import {VaultUtils} from "./library/VaultUtils.sol";
import {TokenUtils} from "./library/TokenUtils.sol";

//import "hardhat/console.sol";

contract TeaVaultAmbient is
    ITeaVaultAmbient,
    Initializable,
    OwnableUpgradeable,
    ERC20Upgradeable,
    PausableUpgradeable,
    ReentrancyGuardUpgradeable
{
    using SafeERC20 for ERC20Upgradeable;
    using SafeCast for uint256;
    using FullMath for uint256;
    using TokenUtils for ERC20Upgradeable;

    uint8 internal DECIMALS;
    uint8 internal MAX_POSITION_LENGTH;
    uint256 public SECONDS_IN_A_YEAR;
    uint256 public DECIMALS_MULTIPLIER;
    uint256 public FEE_MULTIPLIER;
    uint256 public FEE_CAP;

    ITeaVaultAmbientFactory public factory;
    ISwapRelayer public swapRelayer;
    ICrocSwapDex public ambientSwapDex;
    ICrocImpact public ambientImpact;
    ICrocQuery public ambientQuery;
    ParamsConfig public paramsConfig;
    ERC20Upgradeable private token0;
    ERC20Upgradeable private token1;
    uint256 public poolIdx;
    address public manager;
    FeeConfig public feeConfig;
    Position[] public positions;
    uint256 public lastCollectManagementFee;

    uint256[31] private __gap;
    
    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers(); // prevent attackers from using implementation contracts (audit ID:4)
    }

    receive() external payable {}

    function initialize(
        address _owner,
        string calldata _name,
        string calldata _symbol,
        uint8 _decimalOffset,
        ISwapRelayer _swapRelayer,
        ICrocSwapDex _ambientSwapDex,
        ICrocImpact _ambientImpact,
        ICrocQuery _ambientQuery,
        ParamsConfig calldata _paramsConfig,
        ERC20Upgradeable _token0,
        ERC20Upgradeable _token1,
        uint256 _poolIdx,
        address _manager,
        uint24 _feeCap,
        FeeConfig calldata _feeConfig
    ) public initializer {
        _zeroAddressNotAllowed(address(_swapRelayer));
        _zeroAddressNotAllowed(address(_ambientSwapDex));
        _zeroAddressNotAllowed(address(_ambientImpact));
        _zeroAddressNotAllowed(address(_ambientQuery));
        _zeroAddressNotAllowed(_owner);
        _zeroAddressNotAllowed(_manager);

        __Ownable_init(_owner);
        __ERC20_init(_name, _symbol);
        __Pausable_init();
        __ReentrancyGuard_init();

        (_token0, _token1) = _token0 > _token1 ? (_token1, _token0) : (_token0, _token1);
        if (_ambientQuery.queryPoolParams(_token0, _token1, _poolIdx).schema_ != 1) revert PoolNotInitialized();

        DECIMALS = _decimalOffset + token0.getDecimals();
        MAX_POSITION_LENGTH = 5;
        SECONDS_IN_A_YEAR = 365 * 24 * 60 * 60;
        DECIMALS_MULTIPLIER = 10 ** _decimalOffset;
        FEE_MULTIPLIER = 1000000;
        if (_feeCap >= FEE_MULTIPLIER) revert InvalidFeeCap();
        FEE_CAP = _feeCap; 

        _assignManager(_manager);
        _setFeeConfig(_feeConfig);
       
        factory = ITeaVaultAmbientFactory(msg.sender);
        swapRelayer = _swapRelayer;
        ambientSwapDex = _ambientSwapDex;
        ambientImpact = _ambientImpact;
        ambientQuery = _ambientQuery;
        paramsConfig = _paramsConfig;
        token0 = _token0;
        token1 = _token1;
        poolIdx = _poolIdx;
    }

    function decimals() public override view returns (uint8) {
        return DECIMALS;
    }

    /// @inheritdoc ITeaVaultAmbient
    function pause() external override onlyOwner {
        _pause();
    }

    /// @inheritdoc ITeaVaultAmbient
    function unpause() external override onlyOwner {
        _unpause();
    }

    /// @inheritdoc ITeaVaultAmbient
    function isPaused() external override view returns (bool) {
        return _isPaused();
    }

    function _isPaused() internal view returns (bool) {
        return paused() || factory.isAllVaultsPaused();
    }

    /// @inheritdoc ITeaVaultAmbient
    function assetToken0() public view override returns (address) {
        return address(token0);
    }

    /// @inheritdoc ITeaVaultAmbient
    function assetToken1() public view override returns (address) {
        return address(token1);
    }

    /// @inheritdoc ITeaVaultAmbient
    function assignManager(address _manager) external override onlyOwner {
        _assignManager(_manager);
    }

    function _assignManager(address _manager) internal {
        _zeroAddressNotAllowed(_manager);
        manager = _manager;

        emit ManagerChanged(msg.sender, _manager);
    }

    /// @inheritdoc ITeaVaultAmbient
    function setFeeConfig(FeeConfig calldata _feeConfig) external override onlyOwner {
        _collectManagementFee();
        _collectAllSwapFee();
        _setFeeConfig(_feeConfig);
    }

    function _setFeeConfig(FeeConfig calldata _feeConfig) internal {
        _zeroAddressNotAllowed(_feeConfig.treasury);
        uint256 _FEE_CAP = FEE_CAP;
        if (_feeConfig.entryFee + _feeConfig.exitFee > _FEE_CAP) revert InvalidFeePercentage();
        if (_feeConfig.performanceFee > _FEE_CAP) revert InvalidFeePercentage();
        if (_feeConfig.managementFee > _FEE_CAP) revert InvalidFeePercentage();

        feeConfig = _feeConfig;

        emit FeeConfigChanged(msg.sender, block.timestamp, _feeConfig);
    }

    /// @inheritdoc ITeaVaultAmbient
    function getToken0Balance() external override view returns (uint256 balance) {
        return token0.getBalance(address(this));
    }

    /// @inheritdoc ITeaVaultAmbient
    function getToken1Balance() external override view returns (uint256 balance) {
        return token1.getBalance(address(this));
    }

    /// @inheritdoc ITeaVaultAmbient
    function getPoolInfo() external override view returns (
        ERC20Upgradeable,
        ERC20Upgradeable,
        uint8,
        uint8,
        uint16,
        uint16,
        uint160,
        int24
    ) {
        ICrocQuery _ambientQuery = ambientQuery;
        ERC20Upgradeable _token0 = token0;
        ERC20Upgradeable _token1 = token1;
        uint256 _poolIdx = poolIdx;

        uint8 decimals0 = token0.getDecimals();
        uint8 decimals1 = token1.getDecimals();
        ICrocQuery.Pool memory params = _ambientQuery.queryPoolParams(token0, token1, _poolIdx);
        uint16 feeRate = params.feeRate_;
        uint16 tickSize = params.tickSize_;
        uint160 sqrtPriceX64 = _ambientQuery.queryPrice(token0, token1, _poolIdx);
        int24 tick = _ambientQuery.queryCurveTick(token0, token1, _poolIdx);

        return (_token0, _token1, decimals0, decimals1, feeRate, tickSize, sqrtPriceX64, tick);
    }

    function _charge(ERC20Upgradeable _token, uint256 maxAmount) internal {
        if (_token.isNative()) {
            if (msg.value < maxAmount) revert InsufficientValue();
        }
        else {
            _token.safeTransferFrom(msg.sender, address(this), maxAmount);
        } 
    }

    /// @inheritdoc ITeaVaultAmbient
    function deposit(
        uint256 _shares,
        uint256 _amount0Max,
        uint256 _amount1Max
    ) external override payable nonReentrant onlyNotPaused checkShares(_shares) returns (
        uint256 depositedAmount0,
        uint256 depositedAmount1
    ) {
        _collectManagementFee();
        uint256 totalShares = totalSupply();
        ERC20Upgradeable _token0 = token0;
        ERC20Upgradeable _token1 = token1;
        bool isToken0Native = _token0.isNative();
        if (!isToken0Native && msg.value != 0) revert ValueShouldBeZero();

        if (totalShares == 0) {
            // vault is empty, default to 1:1 share to token0 ratio (offseted by _decimalOffset)
            depositedAmount0 = _shares / DECIMALS_MULTIPLIER;
            _charge(_token0, _amount0Max);
        }
        else {
            _collectAllSwapFee();
            uint256 token0BalanceOfVault = _token0.getBalance(address(this)) - msg.value;
            uint256 token1BalanceOfVault = _token1.getBalance(address(this)); 
            _charge(_token0, _amount0Max);
            _charge(_token1, _amount1Max);
            
            address _ambientSwapDex = address(ambientSwapDex);
            uint256 positionLength = positions.length;
            uint256 value = isToken0Native ? _amount0Max : 0;
            uint256 amount0;
            uint256 amount1;
            uint256 liquidity;

            _token0.nonNativeApprove(_ambientSwapDex, _amount0Max);
            _token1.nonNativeApprove(_ambientSwapDex, _amount1Max);
            for (uint256 i; i < positionLength; i++) {
                Position storage position = positions[i];

                liquidity = _fractionOfShares(position.liquidity, _shares, totalShares, true);
                (amount0, amount1) = _addLiquidity(value, position.tickLower, position.tickUpper, liquidity);

                position.liquidity += liquidity.toUint128();
                depositedAmount0 += amount0;
                depositedAmount1 += amount1;

                if (value > 0) {
                    // token0 is native, reduce value by deposited amount
                    value -= amount0;
                }
            }
            _token0.nonNativeApprove(_ambientSwapDex, 0);
            _token1.nonNativeApprove(_ambientSwapDex, 0);

            amount0 = _fractionOfShares(token0BalanceOfVault, _shares, totalShares, true);
            amount1 = _fractionOfShares(token1BalanceOfVault, _shares, totalShares, true);
            depositedAmount0 += amount0;
            depositedAmount1 += amount1;
        }

        if (depositedAmount0 == 0 && depositedAmount1 == 0) revert InvalidShareAmount();

        // collect entry fee from users
        // do not collect entry fee from fee recipient
        uint256 entryFeeAmount0;
        uint256 entryFeeAmount1;

        if (msg.sender != feeConfig.treasury) {
            entryFeeAmount0 = _fractionOfFees(depositedAmount0, feeConfig.entryFee);
            entryFeeAmount1 = _fractionOfFees(depositedAmount1, feeConfig.entryFee);
            _token0.safeUniversalTransfer(feeConfig.treasury, entryFeeAmount0);
            _token1.safeUniversalTransfer(feeConfig.treasury, entryFeeAmount1);

            depositedAmount0 += entryFeeAmount0;
            depositedAmount1 += entryFeeAmount1;
        }

        if (depositedAmount0 > _amount0Max || depositedAmount1 > _amount1Max) revert InvalidPriceSlippage(depositedAmount0, depositedAmount1);
        if (_amount0Max > depositedAmount0) {
            _token0.safeUniversalTransfer(msg.sender, _amount0Max - depositedAmount0);
        }
        if (_amount1Max > depositedAmount1) {
            _token1.safeUniversalTransfer(msg.sender, _amount1Max - depositedAmount1);
        }
        _mint(msg.sender, _shares);

        emit DepositShares(msg.sender, _shares, depositedAmount0, depositedAmount1, entryFeeAmount0, entryFeeAmount1);
    }

    /// @inheritdoc ITeaVaultAmbient
    function withdraw(
        uint256 _shares,
        uint256 _amount0Min,
        uint256 _amount1Min
    ) external override nonReentrant onlyNotPaused checkShares(_shares) returns (
        uint256 withdrawnAmount0,
        uint256 withdrawnAmount1
    ) {
        _collectManagementFee();
        uint256 totalShares = totalSupply();
        ERC20Upgradeable _token0 = token0;
        ERC20Upgradeable _token1 = token1;

        // collect exit fee for users
        // do not collect exit fee for fee recipient
        uint256 exitFeeAmount;
        if (msg.sender != feeConfig.treasury) {
            // calculate exit fee
            exitFeeAmount = _fractionOfFees(_shares, feeConfig.exitFee);
            if (exitFeeAmount > 0) {
                _transfer(msg.sender, feeConfig.treasury, exitFeeAmount);
            }

            _shares -= exitFeeAmount;
        }

        _burn(msg.sender, _shares);

        uint256 positionLength = positions.length;
        uint256 amount0;
        uint256 amount1;

        // collect all swap fees first
        _collectAllSwapFee();

        withdrawnAmount0 = _fractionOfShares(_token0.getBalance(address(this)), _shares, totalShares, false);
        withdrawnAmount1 = _fractionOfShares(_token1.getBalance(address(this)), _shares, totalShares, false);

        uint256 i;
        for (; i < positionLength; i++) {
            Position storage position = positions[i];
            int24 tickLower = position.tickLower;
            int24 tickUpper = position.tickUpper;
            uint256 liquidity = _fractionOfShares(position.liquidity, _shares, totalShares, false);
        
            (amount0, amount1) = _removeLiquidity(tickLower, tickUpper, liquidity);
            withdrawnAmount0 += amount0;
            withdrawnAmount1 += amount1;

            position.liquidity -= liquidity.toUint128();
        }

        // remove position entries with no liquidity
        i = 0;
        while(i < positions.length) {
            if (positions[i].liquidity == 0) {
                positions[i] = positions[positions.length - 1];
                positions.pop();
            }
            else {
                i++;
            }
        }

        if (withdrawnAmount0 < _amount0Min || withdrawnAmount1 < _amount1Min) revert InvalidPriceSlippage(withdrawnAmount0, withdrawnAmount1);

        token0.safeUniversalTransfer(msg.sender, withdrawnAmount0);
        token1.safeUniversalTransfer(msg.sender, withdrawnAmount1);

        emit WithdrawShares(msg.sender, _shares, withdrawnAmount0, withdrawnAmount1, exitFeeAmount);
    }

    /// @inheritdoc ITeaVaultAmbient
    function addLiquidity(
        int24 _tickLower,
        int24 _tickUpper,
        uint256 _liquidity,
        uint256 _amount0Min,
        uint256 _amount1Min,
        uint64 _deadline
    ) external override nonReentrant checkDeadline(_deadline) onlyManager returns (
        uint256 amount0,
        uint256 amount1
    ) {
        ERC20Upgradeable _token0 = token0;
        ERC20Upgradeable _token1 = token1;
        uint256 token0Balance = _token0.getBalance(address(this));
        uint256 token1Balance = _token1.getBalance(address(this));

        address _ambientSwapDex = address(ambientSwapDex);
        uint256 positionLength = positions.length;
        uint256 value = _token0.isNative() ? token0Balance : 0;
        uint256 i;
        bool added;

        _token0.nonNativeApprove(_ambientSwapDex, token0Balance);
        _token1.nonNativeApprove(_ambientSwapDex, token1Balance);
        for (; i < positionLength; i++) {
            Position storage position = positions[i];
            if (position.tickLower == _tickLower && position.tickUpper == _tickUpper) {
                (amount0, amount1) = _addLiquidity(value, _tickLower, _tickUpper, _liquidity, _amount0Min, _amount1Min);
                position.liquidity += _liquidity.toUint128();
                added = true;
            }
        }

        if (i == MAX_POSITION_LENGTH) revert PositionLengthExceedsLimit();

        if (!added) {
            (amount0, amount1) = _addLiquidity(value, _tickLower, _tickUpper, _liquidity, _amount0Min, _amount1Min);
            positions.push(Position({
                tickLower: _tickLower,
                tickUpper: _tickUpper,
                liquidity: _liquidity.toUint128()
            }));
        }

        _token0.nonNativeApprove(_ambientSwapDex, 0);
        _token1.nonNativeApprove(_ambientSwapDex, 0);
    }

    /// @inheritdoc ITeaVaultAmbient
    function removeLiquidity(
        int24 _tickLower,
        int24 _tickUpper,
        uint256 _liquidity,
        uint256 _amount0Min,
        uint256 _amount1Min,
        uint64 _deadline
    ) external override nonReentrant checkDeadline(_deadline) onlyManager returns (
        uint256 amount0,
        uint256 amount1
    ) {
        uint256 positionLength = positions.length;

        for (uint256 i; i < positionLength; i++) {
            Position storage position = positions[i];
            if (position.tickLower == _tickLower && position.tickUpper == _tickUpper) {
                // collect swap fee before remove liquidity to ensure correct calculation of performance fee
                _collectPositionSwapFee(position);

                (amount0, amount1) = _removeLiquidity(_tickLower, _tickUpper, _liquidity);
                if (amount0 < _amount0Min || amount1 < _amount1Min) revert InvalidPriceSlippage(amount0, amount1);

                if (position.liquidity == _liquidity) {
                    positions[i] = positions[positionLength - 1];
                    positions.pop();
                }
                else {
                    position.liquidity -= _liquidity.toUint128();
                }

                return (amount0, amount1);
            }
        }

        revert PositionDoesNotExist();
    }

    function _addLiquidity(
        uint256 _value,
        int24 _tickLower,
        int24 _tickUpper,
        uint256 _liquidity,
        uint256 _amount0Min,
        uint256 _amount1Min
    ) internal returns (
        uint256 amount0,
        uint256 amount1
    ) {
        (amount0, amount1) = _addLiquidity(_value, _tickLower, _tickUpper, _liquidity);

        if (amount0 < _amount0Min || amount1 < _amount1Min) revert InvalidPriceSlippage(amount0, amount1);
    }

    function _addLiquidity(
        uint256 _value,
        int24 _tickLower,
        int24 _tickUpper,
        uint256 _liquidity
    ) internal checkLiquidity(_liquidity) returns (
        uint256 amount0,
        uint256 amount1
    ) {
        // make sure the last 11bits to be zero to prevent "FD" error from Ambient
        uint256 roundUpX12Liquidity = (_liquidity >> 11) << 11;
        roundUpX12Liquidity = roundUpX12Liquidity < _liquidity ? roundUpX12Liquidity + (1 << 11) : roundUpX12Liquidity;

        (amount0, amount1) = _lpCall(
            _value,
            paramsConfig.lpCallPath,
            paramsConfig.mintCodeFixedInLiquidityUnits,
            _tickLower,
            _tickUpper,
            roundUpX12Liquidity.toUint128()
        );

        emit AddLiquidity(_tickLower, _tickUpper, roundUpX12Liquidity, amount0, amount1);
    }

    function _removeLiquidity(
        int24 _tickLower,
        int24 _tickUpper,
        uint256 _liquidity
    ) internal checkLiquidity(_liquidity) returns (
        uint256 amount0,
        uint256 amount1
    ) {
        uint256 roundDownX12Liquidity = (_liquidity >> 11) << 11;

        (amount0, amount1) = _lpCall(
            0,
            paramsConfig.lpCallPath,
            paramsConfig.burnCodeFixedInLiquidityUnits,
            _tickLower,
            _tickUpper,
            roundDownX12Liquidity.toUint128()
        );

        emit RemoveLiquidity(_tickLower, _tickUpper, roundDownX12Liquidity, amount0, amount1);
    }

    function _harvest(int24 _tickLower, int24 _tickUpper) internal returns (uint256 amount0, uint256 amount1) {
        (amount0, amount1) = _lpCall(
            0,
            paramsConfig.lpCallPath,
            paramsConfig.harvestCodeAccumulatedFees,
            _tickLower,
            _tickUpper,
            0
        );

        emit Harvest(_tickLower, _tickUpper, amount0, amount1);
    }

    function _lpCall(
        uint256 _value,
        uint16 _callpath,
        uint8 _code,
        int24 _tickLower,
        int24 _tickUpper,
        uint256 _qty
    ) internal returns (
        uint256 token0Amount,
        uint256 token1Amount
    ) { 
        bytes memory result = ambientSwapDex.userCmd{value: _value}(
            _callpath,
            abi.encode(
                _code,
                token0,
                token1,
                poolIdx,
                _tickLower,
                _tickUpper,
                _qty.toUint128(),
                uint128(0),
                type(uint128).max,
                uint8(0),
                address(0)
            )
        );

        (int128 token0Flow, int128 token1Flow) = abi.decode(result, (int128, int128));
        token0Amount = _abs(token0Flow);
        token1Amount = _abs(token1Flow);
    }

    /// @inheritdoc ITeaVaultAmbient
    function collectPositionSwapFee(
        int24 _tickLower,
        int24 _tickUpper
    ) external nonReentrant override returns (
        uint256 amount0,
        uint256 amount1
    ) {
        uint256 positionLength = positions.length;

        for (uint256 i; i < positionLength; i++) {
            Position storage position = positions[i];
            if (position.tickLower == _tickLower && position.tickUpper == _tickUpper) {
                return _collectPositionSwapFee(position);
            }
        }

        revert PositionDoesNotExist();
    }

    /// @inheritdoc ITeaVaultAmbient
    function collectAllSwapFee() external nonReentrant override returns (uint256 amount0, uint256 amount1) {
        return _collectAllSwapFee();
    }
    
    /// @inheritdoc ITeaVaultAmbient
    function collectManagementFee() external override returns (uint256 collectedShares) {
        return _collectManagementFee();
    }

    /// @dev mint shares as management fee, based on time since last time collected
    /// @dev must be called every time before totalSupply changed
    function _collectManagementFee() internal returns (uint256 collectedShares) {
        uint256 timeDiff = block.timestamp - lastCollectManagementFee;
        if (timeDiff > 0) {
            unchecked {
                uint256 feeTimesTimediff = feeConfig.managementFee * timeDiff;
                uint256 denominator = (
                    FEE_MULTIPLIER * SECONDS_IN_A_YEAR > feeTimesTimediff?
                        FEE_MULTIPLIER * SECONDS_IN_A_YEAR - feeTimesTimediff:
                        1
                );
                collectedShares = totalSupply().mulDivRoundingUp(feeTimesTimediff, denominator);
            }

            if (collectedShares > 0) {
                _mint(feeConfig.treasury, collectedShares);
                emit ManagementFeeCollected(collectedShares);
            }

            // Charge 0 management fee and initialize lastCollectManagementFee in the first deposit
            lastCollectManagementFee = block.timestamp;
        }
    }

    function _collectPositionSwapFee(Position storage position) internal returns(uint256 amount0, uint256 amount1) {
        (amount0, amount1) =  _harvest(position.tickLower, position.tickUpper);

        _collectPerformanceFee(amount0, amount1);
    }

    function _collectAllSwapFee() internal returns (uint256 amount0, uint256 amount1) {
        uint256 positionLength = positions.length;
        uint256 _amount0;
        uint256 _amount1;

        for (uint256 i; i < positionLength; i++) {
            Position storage position = positions[i];
            (_amount0, _amount1) = _harvest(position.tickLower, position.tickUpper);
            unchecked {
                amount0 += _amount0;
                amount1 += _amount1;
            }
        }

        _collectPerformanceFee(amount0, amount1);
    }

    function _collectPerformanceFee(uint256 amount0, uint256 amount1) internal {
        uint256 performanceFeeAmount0 = _fractionOfFees(amount0, feeConfig.performanceFee);
        uint256 performanceFeeAmount1 = _fractionOfFees(amount1, feeConfig.performanceFee);
        token0.safeUniversalTransfer(feeConfig.treasury, performanceFeeAmount0);
        token1.safeUniversalTransfer(feeConfig.treasury, performanceFeeAmount1);

        emit CollectSwapFees(amount0, amount1, performanceFeeAmount0, performanceFeeAmount1);
    }

    /// @inheritdoc ITeaVaultAmbient
    function ambientSwap(
        bool _zeroForOne,
        uint256 _maxPaidAmount,
        uint256 _minReceivedAmount,
        uint64 _deadline
    ) external override nonReentrant onlyManager checkDeadline(_deadline) returns (
        uint256 paidAmount,
        uint256 receivedAmount
    ) {
        ERC20Upgradeable _src = _zeroForOne ? token0 : token1;
        ERC20Upgradeable _dst = _zeroForOne ? token1 : token0;

        bool isSrcNative = _src.isNative();
        uint256 value = _maxPaidAmount;
        if (!isSrcNative) {
            _src.approve(address(ambientSwapDex), _maxPaidAmount);
            value = 0;
        }

        // swap using Ambient pool
        (int128 token0Flow, int128 token1Flow) = _ambientSwap(
            value,
            address(token0),
            address(token1),
            poolIdx,
            _zeroForOne,
            _zeroForOne,
            _maxPaidAmount.toUint128(),
            0,
            _zeroForOne ? 21267430153580247136652501917186561137 : 65538,     // do not care about price limit, use recommended max values
            _minReceivedAmount.toUint128(),
            0
        );
        _src.nonNativeApprove(address(ambientSwapDex), 0);

        (paidAmount, receivedAmount) = _zeroForOne ? 
            (_abs(token0Flow), _abs(token1Flow)) :
            (_abs(token1Flow), _abs(token0Flow));

        emit Swap(msg.sender, _src, _dst, block.timestamp, address(ambientSwapDex), paidAmount, receivedAmount);
    }

    function _ambientSwap(
        uint256 _value,
        address _baseToken,
        address _quoteToken,
        uint256 _poolIdx,
        bool _isBuy,
        bool _isBaseQty,
        uint128 _qty,
        uint16 _tip,
        uint128 _limitPrice,
        uint128 _minOut,
        uint8 _settleFlags
    ) internal returns (int128 baseFlow, int128 quoteFlow) {
        // swap using Ambient pool
        bytes memory results = ambientSwapDex.userCmd{value:_value}(
            paramsConfig.swapCallPath,
            abi.encode(
                _baseToken,
                _quoteToken,
                _poolIdx,
                _isBuy,
                _isBaseQty,
                _qty,
                _tip,
                _limitPrice,
                _minOut,
                _settleFlags
            )
        );

        (baseFlow, quoteFlow) = abi.decode(results, (int128, int128));
    }

    /// @inheritdoc ITeaVaultAmbient
    function executeSwap(
        bool _zeroForOne,
        uint256 _maxPaidAmount,
        uint256 _minReceivedAmount,
        address _swapRouter,
        bytes calldata _data,
        uint64 _deadline
    ) external override nonReentrant onlyManager checkDeadline(_deadline) returns (
        uint256 paidAmount,
        uint256 receivedAmount
    ) {
        ERC20Upgradeable _token0 = token0;
        ERC20Upgradeable _token1 = token1;

        // get in-pool swap result from ambient pool as a baseline of the swap rate
        (int128 token0Flow, int128 token1Flow, ) = ambientImpact.calcImpact(
            _token0,
            _token1,
            poolIdx,
            _zeroForOne,
            _zeroForOne,
            _maxPaidAmount.toUint128(),
            0,
            _zeroForOne ? 21267430153580247136652501917186561137 : 65538    // do not care about price limit, use recommended max values
        );

        (ERC20Upgradeable src, ERC20Upgradeable dst, uint256 baselineAmount) = _zeroForOne ? 
            (_token0, _token1, _abs(token1Flow)) : 
            (_token1, _token0, _abs(token0Flow));

        uint256 srcBalanceBefore = src.getBalance(address(this));
        uint256 dstBalanceBefore = dst.getBalance(address(this));

        ISwapRelayer _swapRelayer = swapRelayer;
        src.safeUniversalTransfer(address(_swapRelayer), _maxPaidAmount);

        _swapRelayer.swap(src, dst, _maxPaidAmount, _swapRouter, _data);

        uint256 srcBalanceAfter = src.getBalance(address(this));
        uint256 dstBalanceAfter = dst.getBalance(address(this));
        paidAmount = srcBalanceBefore - srcBalanceAfter;
        receivedAmount = dstBalanceAfter - dstBalanceBefore;

        // check if received amount not less than baseline and pre-set ammount
        if (receivedAmount < baselineAmount) revert WorseRate(baselineAmount, receivedAmount);
        if (receivedAmount < _minReceivedAmount) revert InsufficientSwapResult(_minReceivedAmount, receivedAmount);

        emit Swap(msg.sender, src, dst, block.timestamp, _swapRouter, paidAmount, receivedAmount);
    }

    /// @inheritdoc ITeaVaultAmbient
    function positionInfo(
        int24 _tickLower,
        int24 _tickUpper
    ) external override view returns (
        uint256 amount0,
        uint256 amount1,
        uint256 fee0,
        uint256 fee1
    ) {
        uint256 positionsLength = positions.length;
        for (uint256 i; i < positionsLength; i++) {
            Position storage position = positions[i];
            if (position.tickLower == _tickLower && position.tickUpper == _tickUpper) {
                return VaultUtils.positionInfo(ambientQuery, address(this), token0, token1, poolIdx, position);
            }
        }

        revert PositionDoesNotExist();
    }

    /// @inheritdoc ITeaVaultAmbient
    function positionInfo(
        uint256 _index
    ) external override view returns (
        uint256 amount0,
        uint256 amount1,
        uint256 fee0,
        uint256 fee1
    ) {
        if (_index >= positions.length) revert PositionDoesNotExist();
        return VaultUtils.positionInfo(ambientQuery, address(this), token0, token1, poolIdx, positions[_index]);
    }

    /// @inheritdoc ITeaVaultAmbient
    function allPositionInfo() public override view returns (uint256 amount0, uint256 amount1, uint256 fee0, uint256 fee1) {
        uint256 _amount0;
        uint256 _amount1;
        uint256 _fee0;
        uint256 _fee1;

        uint256 positionsLength = positions.length;
        ICrocQuery _ambientQuery = ambientQuery;
        ERC20Upgradeable _token0 = token0;
        ERC20Upgradeable _token1 = token1;
        uint256 _poolIdx = poolIdx;
        for (uint256 i; i < positionsLength; i++) {
            (_amount0, _amount1, _fee0, _fee1) = VaultUtils.positionInfo(
                _ambientQuery,
                address(this),
                _token0,
                _token1,
                _poolIdx,
                positions[i]
            );

            amount0 += _amount0;
            amount1 += _amount1;
            fee0 += _fee0;
            fee1 += _fee1;
        }
    }

    /// @inheritdoc ITeaVaultAmbient
    function vaultAllUnderlyingAssets() public override view returns (uint256 amount0, uint256 amount1) {        
        (uint256 _amount0, uint256 _amount1, uint256 _fee0, uint256 _fee1) = allPositionInfo();
        amount0 = _amount0 + _fee0;
        amount1 = _amount1 + _fee1;
        amount0 = amount0 + token0.getBalance(address(this));
        amount1 = amount1 + token1.getBalance(address(this));
    }

    /// @inheritdoc ITeaVaultAmbient
    function estimatedValueInToken0() external override view returns (uint256 value0) {
        (uint256 _amount0, uint256 _amount1) = vaultAllUnderlyingAssets();
        value0 = VaultUtils.estimatedValueInToken0(ambientQuery, token0, token1, poolIdx, _amount0, _amount1);
    }

    /// @inheritdoc ITeaVaultAmbient
    function estimatedValueInToken1() external override view returns (uint256 value1) {
        (uint256 _amount0, uint256 _amount1) = vaultAllUnderlyingAssets();
        value1 = VaultUtils.estimatedValueInToken1(ambientQuery, token0, token1, poolIdx, _amount0, _amount1);
    }

    /// @inheritdoc ITeaVaultAmbient
    function getLiquidityForAmounts(
        int24 tickLower,
        int24 tickUpper,
        uint256 amount0,
        uint256 amount1
    ) external override view returns (uint256 liquidity) {
        return VaultUtils.getLiquidityForAmounts(ambientQuery, token0, token1, poolIdx, tickLower, tickUpper, amount0, amount1);
    }

    /// @inheritdoc ITeaVaultAmbient
    function getAmountsForLiquidity(
        int24 tickLower,
        int24 tickUpper,
        uint256 liquidity
    ) external override view returns (uint256 amount0, uint256 amount1) {
        return VaultUtils.getAmountsForLiquidity(ambientQuery, token0, token1, poolIdx, tickLower, tickUpper, liquidity);
    }

    /// @inheritdoc ITeaVaultAmbient
    function getAllPositions() external override view returns (Position[] memory results) {
        return positions;
    }

    function _fractionOfShares(
        uint256 _assetAmount,
        uint256 _shares,
        uint256 _totalShares,
        bool _isRoundingUp
    ) internal pure returns (
        uint256 amount
    ) {
        amount = _isRoundingUp ? 
            _assetAmount.mulDivRoundingUp(_shares, _totalShares) :
            _assetAmount.mulDiv(_shares, _totalShares);
    }

    function _fractionOfFees(uint256 _baseAmount, uint32 _feeRate) internal view returns (uint256 fee) {
        fee = _baseAmount.mulDivRoundingUp(_feeRate, FEE_MULTIPLIER);
    }

    function _abs(int128 input) internal pure returns (uint256 output) {
        output = uint256(int256(input < 0 ? -input : input));
    }

    // sanity check functions & modifiers

    function _zeroAddressNotAllowed(address _address) internal pure {
        if (_address == address(0)) revert ZeroAddress();
    }

    function _onlyNotPaused() internal view {
        if (_isPaused()) revert EnforcedPause();
    }

    function _onlyManager() internal view {
        if (msg.sender != manager) revert CallerIsNotManager();
    }

    function _checkShares(uint256 _shares) internal pure {
        if (_shares == 0) revert ZeroShares();
    }

    function _checkLiquidity(uint256 _liquidity) internal pure {
        if (_liquidity == 0) revert ZeroLiquidity();
    }

    function _checkDeadline(uint256 _deadline) internal view {
        if (block.timestamp > _deadline) revert TransactionExpired();
    }

    modifier onlyNotPaused() {
        _onlyNotPaused();
        _;
    }

    modifier onlyManager() {
        _onlyManager();
        _;
    }

    modifier checkShares(uint256 _shares) {
        _checkShares(_shares);
        _;
    }

    modifier checkLiquidity(uint256 _liquidity) {
        _checkLiquidity(_liquidity);
        _;
    }

    modifier checkDeadline(uint256 _deadline) {
        _checkDeadline(_deadline);
        _;
    }
}