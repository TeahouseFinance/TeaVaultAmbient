// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

import {ERC20Upgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";

interface ICrocImpact {

    function calcImpact (
        ERC20Upgradeable base,
        ERC20Upgradeable quote,
        uint256 poolIdx,
        bool isBuy,
        bool inBaseQty,
        uint128 qty,
        uint16 poolTip,
        uint128 limitPrice
    ) external view returns (
        int128 baseFlow,
        int128 quoteFlow,
        uint128 finalPrice
    );

}