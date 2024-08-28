// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

import {ERC20Upgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";

interface ICrocQuery {

    struct Pool {
        uint8 schema_;
        uint16 feeRate_;
        uint8 protocolTake_;
        uint16 tickSize_;
        uint8 jitThresh_;
        uint8 knockoutBits_;
        uint8 oracleFlags_;
    }

    function queryPoolParams(ERC20Upgradeable base, ERC20Upgradeable quote, uint256 poolIdx) external view returns (Pool memory pool);
    function queryCurveTick(ERC20Upgradeable base, ERC20Upgradeable quote, uint256 poolIdx) external view returns (int24 tick);
    function queryPrice(ERC20Upgradeable base, ERC20Upgradeable quote, uint256 poolIdx) external view returns (uint128 price);
    function queryRangeTokens (
        address owner,
        ERC20Upgradeable base,
        ERC20Upgradeable quote,
        uint256 poolIdx,
        int24 lowerTick,
        int24 upperTick
    ) external view returns (
        uint128 liq,
        uint128 baseQty,
        uint128 quoteQty
    );
    function queryConcRewards (
        address owner,
        ERC20Upgradeable base,
        ERC20Upgradeable quote,
        uint256 poolIdx,
        int24 lowerTick,
        int24 upperTick
    ) external view returns (
        uint128 liqRewards,
        uint128 baseRewards,
        uint128 quoteRewards
    );

}