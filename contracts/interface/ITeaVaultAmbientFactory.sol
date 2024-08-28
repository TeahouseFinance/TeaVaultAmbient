// SPDX-License-Identifier: BUSL-1.1
// Teahouse Finance

pragma solidity ^0.8.0;

import {ERC20Upgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";

import {ITeaVaultAmbient} from "./ITeaVaultAmbient.sol";

interface ITeaVaultAmbientFactory {

    event VaultDeployed(address deployedAddress);

    function createVault(
        address _owner,
        string calldata _name,
        string calldata _symbol,
        uint8 _decimalOffset,
        ERC20Upgradeable _token0,
        ERC20Upgradeable _token1,
        uint256 _poolIdx,
        address _manager,
        uint24 _feeCap,
        ITeaVaultAmbient.FeeConfig calldata _feeConfig
    ) external returns (
        address deployedAddress
    );
    function getBeacon() external view returns (address beaconAddress);
    function pauseAllVaults() external;
    function unpauseAllVaults() external;
    function isAllVaultsPaused() external view returns (bool isPaused);

}