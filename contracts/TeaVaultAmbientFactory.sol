// SPDX-License-Identifier: BUSL-1.1
// Teahouse Finance

pragma solidity =0.8.26;

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {PausableUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import {UpgradeableBeacon} from "@openzeppelin/contracts/proxy/beacon/UpgradeableBeacon.sol";
import {BeaconProxy} from "@openzeppelin/contracts/proxy/beacon/BeaconProxy.sol";
import {ERC20Upgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";

import {ITeaVaultAmbientFactory} from "./interface/ITeaVaultAmbientFactory.sol";
import {TeaVaultAmbient} from "./TeaVaultAmbient.sol";
import {SwapRelayer} from "./SwapRelayer.sol";

contract TeaVaultAmbientFactory is ITeaVaultAmbientFactory, Initializable, UUPSUpgradeable, OwnableUpgradeable, PausableUpgradeable {
    address private vaultBeacon;
    SwapRelayer public swapRelayer;
    address public ambientSwapDex;
    address public ambientImpact;
    address public ambientQuery;
    TeaVaultAmbient.ParamsConfig public paramsConfig;

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}

    function initialize(
        address _owner,
        address _beacon,
        address _ambientSwapDex,
        address _ambientImpact,
        address _ambientQuery,
        TeaVaultAmbient.ParamsConfig calldata _paramsConfig
    ) public initializer {
        __UUPSUpgradeable_init();
        __Ownable_init(_owner);

        vaultBeacon = _beacon;
        swapRelayer = new SwapRelayer();
        ambientSwapDex = _ambientSwapDex;
        ambientImpact = _ambientImpact;
        ambientQuery = _ambientQuery;
        paramsConfig = _paramsConfig;
    }

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
        TeaVaultAmbient.FeeConfig calldata _feeConfig
    ) external onlyOwner returns (
        address deployedAddress
    ) {
        deployedAddress = address(new BeaconProxy(
            vaultBeacon,
            abi.encodeWithSelector(
                TeaVaultAmbient.initialize.selector,
                _owner,
                _name,
                _symbol,
                _decimalOffset,
                swapRelayer,
                ambientSwapDex,
                ambientImpact,
                ambientQuery,
                paramsConfig,
                _token0,
                _token1,
                _poolIdx,
                _manager,
                _feeCap,
                _feeConfig
            )
        ));

        emit VaultDeployed(deployedAddress);
    }

    function getBeacon() external override view returns (address beaconAddress) {
        beaconAddress = vaultBeacon;
    }

    function pauseAllVaults() external override onlyOwner {
        _pause();
    }

    function unpauseAllVaults() external override onlyOwner {
        _unpause();
    }

    function isAllVaultsPaused() external override view returns (bool isPaused) {
        isPaused = paused();
    }
}