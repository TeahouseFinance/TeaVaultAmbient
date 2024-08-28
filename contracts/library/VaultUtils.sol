// SPDX-License-Identifier: BUSL-1.1
// Teahouse Finance

pragma solidity =0.8.26;

import {ERC20Upgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import {FullMath} from "@uniswap/v3-core/contracts/libraries/FullMath.sol";

import {ICrocQuery} from "../interface/ICrocQuery.sol";
import {ITeaVaultAmbient} from "../interface/ITeaVaultAmbient.sol";

library VaultUtils {
    uint8 internal constant RESOLUTION = 64;
    uint256 internal constant Q64 = 0x10000000000000000;
    int24 internal constant MIN_TICK = -665454;
    int24 internal constant MAX_TICK = 831818;

    function positionInfo(
        ICrocQuery _ambientQuery,
        address _account,
        ERC20Upgradeable _token0,
        ERC20Upgradeable _token1,
        uint256 _poolIdx,
        ITeaVaultAmbient.Position storage position
    ) internal view returns (
        uint256 amount0,
        uint256 amount1,
        uint256 fee0,
        uint256 fee1
    ) {
        (, amount0, amount1) = _ambientQuery.queryRangeTokens(
            _account,
            _token0,
            _token1,
            _poolIdx,
            position.tickLower,
            position.tickUpper
        );

        (, fee0, fee1) = _ambientQuery.queryConcRewards(
            _account,
            _token0,
            _token1,
            _poolIdx,
            position.tickLower,
            position.tickUpper
        );
    }

    function estimatedValueInToken0(
        ICrocQuery _ambientQuery,
        ERC20Upgradeable _token0,
        ERC20Upgradeable _token1,
        uint256 _poolIdx,
        uint256 _amount0,
        uint256 _amount1
    ) internal view returns (uint256 value0) {
        uint128 sqrtPriceX64 = _ambientQuery.queryPrice(_token0, _token1, _poolIdx);

        value0 = _amount0 + FullMath.mulDiv(
            _amount1,
            Q64,
            FullMath.mulDiv(sqrtPriceX64, sqrtPriceX64, Q64)
        );
    }

    function estimatedValueInToken1(
        ICrocQuery _ambientQuery,
        ERC20Upgradeable _token0,
        ERC20Upgradeable _token1,
        uint256 _poolIdx,
        uint256 _amount0,
        uint256 _amount1
    ) internal view returns (uint256 value1) {
        uint128 sqrtPriceX64 = _ambientQuery.queryPrice(_token0, _token1, _poolIdx);

        value1 = _amount1 + FullMath.mulDiv(
            _amount0,
            FullMath.mulDiv(sqrtPriceX64, sqrtPriceX64, Q64),
            Q64
        );
    }

    function getLiquidityForAmounts(
        ICrocQuery _ambientQuery,
        ERC20Upgradeable _token0,
        ERC20Upgradeable _token1,
        uint256 _poolIdx,
        int24 _tickLower,
        int24 _tickUpper,
        uint256 _amount0,
        uint256 _amount1
    ) internal view returns (uint256 liquidity) {
        liquidity = _getLiquidityForAmounts(
            _ambientQuery.queryPrice(_token0, _token1, _poolIdx),
            _getSqrtRatioAtTick(_tickLower),
            _getSqrtRatioAtTick(_tickUpper),
            _amount0,
            _amount1
        );
    }

    function getAmountsForLiquidity(
        ICrocQuery _ambientQuery,
        ERC20Upgradeable _token0,
        ERC20Upgradeable _token1,
        uint256 _poolIdx,
        int24 _tickLower,
        int24 _tickUpper,
        uint256 _liquidity
    ) internal view returns (
        uint256 amount0,
        uint256 amount1
    ) {
        return _getAmountsForLiquidity(
            _ambientQuery.queryPrice(_token0, _token1, _poolIdx),
            _getSqrtRatioAtTick(_tickLower),
            _getSqrtRatioAtTick(_tickUpper),
            _liquidity
        );
    }

    function _getSqrtRatioAtTick(int24 tick) internal pure returns (uint128 sqrtPriceX64) {
        // Set to unchecked, but the original UniV3 library was written in a pre-checked version of Solidity
        unchecked { 
            require(tick >= MIN_TICK && tick <= MAX_TICK);
            uint256 absTick = tick < 0 ? uint256(-int256(tick)) : uint256(int256(tick));

            uint256 ratio = absTick & 0x1 != 0 ? 0xfffcb933bd6fad37aa2d162d1a594001 : 0x100000000000000000000000000000000;
            if (absTick & 0x2 != 0) ratio = (ratio * 0xfff97272373d413259a46990580e213a) >> 128;
            if (absTick & 0x4 != 0) ratio = (ratio * 0xfff2e50f5f656932ef12357cf3c7fdcc) >> 128;
            if (absTick & 0x8 != 0) ratio = (ratio * 0xffe5caca7e10e4e61c3624eaa0941cd0) >> 128;
            if (absTick & 0x10 != 0) ratio = (ratio * 0xffcb9843d60f6159c9db58835c926644) >> 128;
            if (absTick & 0x20 != 0) ratio = (ratio * 0xff973b41fa98c081472e6896dfb254c0) >> 128;
            if (absTick & 0x40 != 0) ratio = (ratio * 0xff2ea16466c96a3843ec78b326b52861) >> 128;
            if (absTick & 0x80 != 0) ratio = (ratio * 0xfe5dee046a99a2a811c461f1969c3053) >> 128;
            if (absTick & 0x100 != 0) ratio = (ratio * 0xfcbe86c7900a88aedcffc83b479aa3a4) >> 128;
            if (absTick & 0x200 != 0) ratio = (ratio * 0xf987a7253ac413176f2b074cf7815e54) >> 128;
            if (absTick & 0x400 != 0) ratio = (ratio * 0xf3392b0822b70005940c7a398e4b70f3) >> 128;
            if (absTick & 0x800 != 0) ratio = (ratio * 0xe7159475a2c29b7443b29c7fa6e889d9) >> 128;
            if (absTick & 0x1000 != 0) ratio = (ratio * 0xd097f3bdfd2022b8845ad8f792aa5825) >> 128;
            if (absTick & 0x2000 != 0) ratio = (ratio * 0xa9f746462d870fdf8a65dc1f90e061e5) >> 128;
            if (absTick & 0x4000 != 0) ratio = (ratio * 0x70d869a156d2a1b890bb3df62baf32f7) >> 128;
            if (absTick & 0x8000 != 0) ratio = (ratio * 0x31be135f97d08fd981231505542fcfa6) >> 128;
            if (absTick & 0x10000 != 0) ratio = (ratio * 0x9aa508b5b7a84e1c677de54f3e99bc9) >> 128;
            if (absTick & 0x20000 != 0) ratio = (ratio * 0x5d6af8dedb81196699c329225ee604) >> 128;
            if (absTick & 0x40000 != 0) ratio = (ratio * 0x2216e584f5fa1ea926041bedfe98) >> 128;
            if (absTick & 0x80000 != 0) ratio = (ratio * 0x48a170391f7dc42444e8fa2) >> 128;

            if (tick > 0) ratio = type(uint256).max / ratio;

            // this divides by 1<<64 rounding up to go from a Q128.128 to a Q64.64
            // we then downcast because we know the result always fits within 128 bits due to our tick input constraint
            // we round up in the division so getTickAtSqrtRatio of the output price is always consistent
            sqrtPriceX64 = uint128((ratio >> 64) + (ratio % (1 << 64) == 0 ? 0 : 1));
        }
    }

    function _getLiquidityForAmount0(
        uint128 sqrtRatioAX64,
        uint128 sqrtRatioBX64,
        uint256 amount0
    ) internal pure returns (
        uint256 liquidity
    ) {
        if (sqrtRatioAX64 > sqrtRatioBX64) (sqrtRatioAX64, sqrtRatioBX64) = (sqrtRatioBX64, sqrtRatioAX64);
        uint256 intermediate = FullMath.mulDiv(sqrtRatioAX64, sqrtRatioBX64, Q64);

        return FullMath.mulDiv(amount0, intermediate, sqrtRatioBX64 - sqrtRatioAX64);
    }

    function _getLiquidityForAmount1(
        uint128 sqrtRatioAX64,
        uint128 sqrtRatioBX64,
        uint256 amount1
    ) internal pure returns (
        uint256 liquidity
    ) {
        if (sqrtRatioAX64 > sqrtRatioBX64) (sqrtRatioAX64, sqrtRatioBX64) = (sqrtRatioBX64, sqrtRatioAX64);

        return FullMath.mulDiv(amount1, Q64, sqrtRatioBX64 - sqrtRatioAX64);
    }

    function _getAmount0ForLiquidity(
        uint128 sqrtRatioAX64,
        uint128 sqrtRatioBX64,
        uint256 liquidity
    ) internal pure returns (
        uint256 amount0
    ) {
        if (sqrtRatioAX64 > sqrtRatioBX64) (sqrtRatioAX64, sqrtRatioBX64) = (sqrtRatioBX64, sqrtRatioAX64);

        return FullMath.mulDiv(liquidity << RESOLUTION, sqrtRatioBX64 - sqrtRatioAX64, sqrtRatioBX64) / sqrtRatioAX64;
    }

    function _getAmount1ForLiquidity(
        uint128 sqrtRatioAX64,
        uint128 sqrtRatioBX64,
        uint256 liquidity
    ) internal pure returns (
        uint256 amount1
    ) {
        if (sqrtRatioAX64 > sqrtRatioBX64) (sqrtRatioAX64, sqrtRatioBX64) = (sqrtRatioBX64, sqrtRatioAX64);

        return FullMath.mulDiv(liquidity, sqrtRatioBX64 - sqrtRatioAX64, Q64);
    }

    function _getLiquidityForAmounts(
        uint128 sqrtRatioX64,
        uint128 sqrtRatioAX64,
        uint128 sqrtRatioBX64,
        uint256 amount0,
        uint256 amount1
    ) internal pure returns (
        uint256 liquidity
    ) {
        if (sqrtRatioAX64 > sqrtRatioBX64) (sqrtRatioAX64, sqrtRatioBX64) = (sqrtRatioBX64, sqrtRatioAX64);

        if (sqrtRatioX64 <= sqrtRatioAX64) {
            liquidity = _getLiquidityForAmount0(sqrtRatioAX64, sqrtRatioBX64, amount0);
        } else if (sqrtRatioX64 < sqrtRatioBX64) {
            uint256 liquidity0 = _getLiquidityForAmount0(sqrtRatioX64, sqrtRatioBX64, amount0);
            uint256 liquidity1 = _getLiquidityForAmount1(sqrtRatioAX64, sqrtRatioX64, amount1);

            liquidity = liquidity0 < liquidity1 ? liquidity0 : liquidity1;
        } else {
            liquidity = _getLiquidityForAmount1(sqrtRatioAX64, sqrtRatioBX64, amount1);
        }
    }

    function _getAmountsForLiquidity(
        uint128 sqrtRatioX64,
        uint128 sqrtRatioAX64,
        uint128 sqrtRatioBX64,
        uint256 liquidity
    ) internal pure returns (
        uint256 amount0,
        uint256 amount1
    ) {
        if (sqrtRatioAX64 > sqrtRatioBX64) (sqrtRatioAX64, sqrtRatioBX64) = (sqrtRatioBX64, sqrtRatioAX64);

        if (sqrtRatioX64 <= sqrtRatioAX64) {
            amount0 = _getAmount0ForLiquidity(sqrtRatioAX64, sqrtRatioBX64, liquidity);
        } else if (sqrtRatioX64 < sqrtRatioBX64) {
            amount0 = _getAmount0ForLiquidity(sqrtRatioX64, sqrtRatioBX64, liquidity);
            amount1 = _getAmount1ForLiquidity(sqrtRatioAX64, sqrtRatioX64, liquidity);
        } else {
            amount1 = _getAmount1ForLiquidity(sqrtRatioAX64, sqrtRatioBX64, liquidity);
        }
    }
}