// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

interface ICrocSwapDex {

    function userCmd (uint16 _callpath, bytes calldata _cmd) external payable returns (bytes memory);

}