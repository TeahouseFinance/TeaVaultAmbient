const helpers = require("@nomicfoundation/hardhat-toolbox/network-helpers");
const { anyValue } = require("@nomicfoundation/hardhat-chai-matchers/withArgs");
const { expect } = require("chai");
const { ethers, upgrades } = require("hardhat");

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
const NATIVE_ADDRESS = ZERO_ADDRESS;
const NATIVE_DECIMALS = 18;
const UINT256_MAX = '0x' + 'f'.repeat(64);
const UINT64_MAX = '0x' + 'f'.repeat(16);

const UniswapV3SwapRouterABI = [
    "function WETH9() external view returns (address)",
    "function exactInputSingle((address,address,uint24,address,uint256,uint256,uint256,uint160)) external payable returns (uint256)",
    "function multicall(bytes[] calldata data) external payable returns (bytes[] memory results)",
    "function unwrapWETH9(uint256 amountMinimum, address recipient) external payable",
    "function refundETH() external payable"
];

function loadEnvVar(env, errorMsg) {
    if (env == undefined) {
        throw errorMsg;
    }

    return env;
}

function loadEnvVarInt(env, errorMsg) {
    if (env == undefined) {
        throw errorMsg;
    }

    return parseInt(env);
}


// setup ambient parameters
const testRpc = loadEnvVar(process.env.AMBIENT_TEST_RPC, "No AMBIENT_TEST_RPC");
const testBlock = loadEnvVarInt(process.env.AMBIENT_TEST_BLOCK, "No AMBIENT_TEST_BLOCK");
const testSwapDex = loadEnvVar(process.env.AMBIENT_TEST_SWAP_DEX, "No AMBIENT_TEST_SWAP_DEX");
const testImpact = loadEnvVar(process.env.AMBIENT_TEST_IMPACT, "No AMBIENT_TEST_IMPACT");
const testQuery = loadEnvVar(process.env.AMBIENT_TEST_QUERY, "No AMBIENT_TEST_QUERY");
const testCallPath = loadEnvVarInt(process.env.AMBIENT_TEST_CALL_PATH, "No AMBIENT_TEST_CALL_PATH");
const testMintCode = loadEnvVarInt(process.env.AMBIENT_TEST_MINT_CODE, "No AMBIENT_TEST_MINT_CODE");
const testBurnCode = loadEnvVarInt(process.env.AMBIENT_TEST_BURN_CODE, "No AMBIENT_TEST_BURN_CODE");
const testHarvestCode = loadEnvVarInt(process.env.AMBIENT_TEST_HARVEST_CODE, "No AMBIENT_TEST_HARVEST_CODE");
const testToken1Native = loadEnvVar(process.env.AMBIENT_TEST_TOKEN1_NATIVE, "No AMBIENT_TEST_TOKEN1_NATIVE");
const testToken1NativeWhale = loadEnvVar(process.env.AMBIENT_TEST_TOKEN1_NATIVE_WHALE, "No AMBIENT_TEST_TOKEN1_NATIVE_WHALE");
const testDecimalOffsetNative = loadEnvVarInt(process.env.AMBIENT_TEST_DECIMAL_OFFSET_NATIVE, "No AMBIENT_TEST_DECIMAL_OFFSET_NATIVE");
const testToken0ERC20 = loadEnvVar(process.env.AMBIENT_TEST_TOKEN0_ERC20, "No AMBIENT_TEST_TOKEN0_ERC20");
const testToken1ERC20 = loadEnvVar(process.env.AMBIENT_TEST_TOKEN1_ERC20, "No AMBIENT_TEST_TOKEN1_ERC20");
const testToken0ERC20Whale = loadEnvVar(process.env.AMBIENT_TEST_TOKEN0_ERC20_WHALE, "No AMBIENT_TEST_TOKEN0_ERC20_WHALE");
const testToken1ERC20Whale = loadEnvVar(process.env.AMBIENT_TEST_TOKEN1_ERC20_WHALE, "No AMBIENT_TEST_TOKEN1_ERC20_WHALE");
const testDecimalOffsetERC20 = loadEnvVarInt(process.env.AMBIENT_TEST_DECIMAL_OFFSET_ERC20, "No AMBIENT_TEST_DECIMAL_OFFSET_ERC20");
const testPoolIndex = loadEnvVarInt(process.env.AMBIENT_TEST_POOL_INDEX, "No AMBIENT_TEST_POOL_INDEX");
const testRouter = loadEnvVar(process.env.AMBIENT_TEST_UNISWAP_ROUTER, "No AMBIENT_TEST_UNISWAP_ROUTER");

describe("TeaVaultAmbient", function () {
    async function deployTeaVaultAmbientFixture() {
        // fork a testing environment
        await helpers.reset(testRpc, testBlock);

        // Contracts are deployed using the first signer/account by default
        const [ owner, manager, treasury, user ] = await ethers.getSigners();

        // get ERC20 tokens
        const MockToken = await ethers.getContractFactory("MockToken");
        const token1Native = MockToken.attach(testToken1Native);

        const token0ERC20 = MockToken.attach(testToken0ERC20);
        const token1ERC20 = MockToken.attach(testToken1ERC20);

        // get tokens from whale
        await helpers.impersonateAccount(testToken1NativeWhale);
        const token1NativeWhale = await ethers.getSigner(testToken1NativeWhale);
        await helpers.setBalance(token1NativeWhale.address, ethers.parseEther("100"));  // assign some eth to the whale in case it's a contract and not accepting eth
        await token1Native.connect(token1NativeWhale).transfer(user, ethers.parseUnits("100000", await token1Native.decimals()));

        await helpers.impersonateAccount(testToken0ERC20Whale);
        const token0Whale = await ethers.getSigner(testToken0ERC20Whale);
        await helpers.setBalance(token0Whale.address, ethers.parseEther("100"));  // assign some eth to the whale in case it's a contract and not accepting eth
        await token0ERC20.connect(token0Whale).transfer(user, ethers.parseUnits("100000", await token0ERC20.decimals()));

        await helpers.impersonateAccount(testToken1ERC20Whale);
        const token1Whale = await ethers.getSigner(testToken1ERC20Whale);
        await helpers.setBalance(token1Whale.address, ethers.parseEther("100"));  // assign some eth to the whale in case it's a contract and not accepting eth
        await token1ERC20.connect(token1Whale).transfer(user, ethers.parseUnits("100000", await token1ERC20.decimals()));

        // deploy vault
        const TeaVaultAmbient = await ethers.getContractFactory("TeaVaultAmbient");
        const ambientBeacon = await upgrades.deployBeacon(TeaVaultAmbient);

        const TeaVaultAmbientFactory = await ethers.getContractFactory("TeaVaultAmbientFactory");
        const teaVaultAmbientFactory = await upgrades.deployProxy(
            TeaVaultAmbientFactory,
            [
                owner.address,
                ambientBeacon.target,
                testSwapDex,
                testImpact,
                testQuery,
                {
                    callPath: testCallPath,
                    mintCodeFixedInLiquidityUnits: testMintCode,
                    burnCodeFixedInLiquidityUnits: testBurnCode,
                    harvestCodeAccumulatedFees: testHarvestCode,
                },
            ]
        );

        // create native pool
        const txNative = await teaVaultAmbientFactory.createVault(
            owner.address,
            "Test Vault Native",
            "TVAULT-N",
            testDecimalOffsetNative,
            NATIVE_ADDRESS,
            testToken1Native,
            testPoolIndex,
            manager.address,
            999999,
            {
                treasury: treasury.address,
                entryFee: 0,
                exitFee: 0,
                performanceFee: 0,
                managementFee: 0,
            },
        );

        let events = await teaVaultAmbientFactory.queryFilter("VaultDeployed", txNative.blockNumber, txNative.blockNumber);
        const vaultNative = TeaVaultAmbient.attach(events[0].args[0]);

        // create ERC20 pool
        const txERC20 = await teaVaultAmbientFactory.createVault(
            owner.address,
            "Test Vault ERC20",
            "TVAULT-E",
            testDecimalOffsetERC20,
            testToken0ERC20,
            testToken1ERC20,
            testPoolIndex,
            manager.address,
            999999,
            {
                treasury: treasury.address,
                entryFee: 0,
                exitFee: 0,
                performanceFee: 0,
                managementFee: 0,
            },
        );

        events = await teaVaultAmbientFactory.queryFilter("VaultDeployed", txERC20.blockNumber, txERC20.blockNumber);
        const vaultERC20 = TeaVaultAmbient.attach(events[0].args[0]);

        return { owner, manager, treasury, user, vaultNative, token1Native, vaultERC20, token0ERC20, token1ERC20 };
    }

    describe("Deployment", function() {
        it("Should set the correct tokens", async function () {
            const { vaultNative, token1Native } = await helpers.loadFixture(deployTeaVaultAmbientFixture);

            expect(await vaultNative.assetToken0()).to.equal(NATIVE_ADDRESS);
            expect(await vaultNative.assetToken1()).to.equal(token1Native.target);

            const poolInfo = await vaultNative.getPoolInfo();
            expect(poolInfo[0]).to.equal(NATIVE_ADDRESS);
            expect(poolInfo[1]).to.equal(token1Native.target);
        });

        it("Should set the correct decimals", async function () {
            const { vaultNative, vaultERC20, token0ERC20 } = await helpers.loadFixture(deployTeaVaultAmbientFixture);

            expect(await vaultNative.decimals()).to.equal(NATIVE_DECIMALS);

            const token0Decimals = await token0ERC20.decimals();
            expect(await vaultERC20.decimals()).to.equal(token0Decimals + BigInt(testDecimalOffsetERC20));
        });
    });

    describe("Owner functions", function() {
        it("Should be able to set fees from owner", async function() {
            const { owner, vaultNative } = await helpers.loadFixture(deployTeaVaultAmbientFixture);

            const feeConfig = {
                treasury: owner.address,
                entryFee: 1000,
                exitFee: 2000,
                performanceFee: 100000,
                managementFee: 10000,
            };

            await vaultNative.setFeeConfig(feeConfig);
            const fees = await vaultNative.feeConfig();

            expect(feeConfig.treasury).to.equal(fees.treasury);
            expect(feeConfig.entryFee).to.equal(fees.entryFee);
            expect(feeConfig.exitFee).to.equal(fees.exitFee);
            expect(feeConfig.performanceFee).to.equal(fees.performanceFee);
            expect(feeConfig.managementFee).to.equal(fees.managementFee);
        });

        it("Should not be able to set incorrect fees", async function() {
            const { owner, vaultNative } = await helpers.loadFixture(deployTeaVaultAmbientFixture);

            const feeConfig1 = {
                treasury: owner.address,
                entryFee: 500001,
                exitFee: 500000,
                performanceFee: 100000,
                managementFee: 10000,
            };

            await expect(vaultNative.setFeeConfig(feeConfig1))
            .to.be.revertedWithCustomError(vaultNative, "InvalidFeePercentage");

            const feeConfig2 = {
                treasury: owner.address,
                entryFee: 1000,
                exitFee: 2000,
                performanceFee: 1000001,
                managementFee: 10000,
            };

            await expect(vaultNative.setFeeConfig(feeConfig2))
            .to.be.revertedWithCustomError(vaultNative, "InvalidFeePercentage");

            const feeConfig3 = {
                treasury: owner.address,
                entryFee: 1000,
                exitFee: 2000,
                performanceFee: 100000,
                managementFee: 1000001,
            };

            await expect(vaultNative.setFeeConfig(feeConfig3))
            .to.be.revertedWithCustomError(vaultNative, "InvalidFeePercentage");
        });

        it("Should not be able to set fees from non-owner", async function() {
            const { manager, vaultNative } = await helpers.loadFixture(deployTeaVaultAmbientFixture);

            const feeConfig = {
                treasury: manager.address,
                entryFee: 1000,
                exitFee: 2000,
                performanceFee: 100000,
                managementFee: 10000,
            }

            await expect(vaultNative.connect(manager).setFeeConfig(feeConfig))
            .to.be.revertedWithCustomError(vaultNative, "OwnableUnauthorizedAccount");
        });

        it("Should be able to assign manager from owner", async function() {
            const { manager, vaultNative } = await helpers.loadFixture(deployTeaVaultAmbientFixture);

            await vaultNative.assignManager(manager.address);
            expect(await vaultNative.manager()).to.equal(manager.address);
        });

        it("Should not be able to assign manager from non-owner", async function() {
            const { manager, user, vaultNative } = await helpers.loadFixture(deployTeaVaultAmbientFixture);

            await expect(vaultNative.connect(manager).assignManager(user.address))
            .to.be.revertedWithCustomError(vaultNative, "OwnableUnauthorizedAccount");
            expect(await vaultNative.manager()).to.equal(manager.address);
        });
    });

    describe("User functions with native token", function() {        
        it("Should be able to deposit and withdraw from user", async function() {
            const { treasury, user, vaultNative } = await helpers.loadFixture(deployTeaVaultAmbientFixture);

            // set fees
            const feeConfig = {
                treasury: treasury.address,
                entryFee: 1000n,
                exitFee: 2000n,
                performanceFee: 100000n,
                managementFee: 10000n,
            }

            await vaultNative.setFeeConfig(feeConfig);

            const feeMultiplier = await vaultNative.FEE_MULTIPLIER();

            // deposit
            const token0Decimals = NATIVE_DECIMALS;
            const vaultDecimals = await vaultNative.decimals();
            const shares = ethers.parseUnits("1", vaultDecimals);
            const token0Amount = ethers.parseUnits("1", token0Decimals);
            const token0EntryFee = token0Amount * feeConfig.entryFee / feeMultiplier;
            const token0AmountWithFee = token0Amount + token0EntryFee;

            let token0Before = await ethers.provider.getBalance(user);
            let treasureBefore = await ethers.provider.getBalance(treasury);
            
            // deposit native token
            let tx;
            expect(tx = await vaultNative.connect(user).deposit(shares, token0AmountWithFee, 0n, { value: token0AmountWithFee }))
            .to.changeTokenBalance(vaultNative, user, shares);
            let receipt = await ethers.provider.getTransactionReceipt(tx.hash);
            let gasFee = tx.gasPrice * receipt.gasUsed;
            let token0After = await ethers.provider.getBalance(user);
            expect(token0Before - token0After).to.equal(token0AmountWithFee + gasFee);

            expect(await ethers.provider.getBalance(vaultNative.target)).to.equal(token0Amount);    // vault received amount0
            let treasureAfter = await ethers.provider.getBalance(treasury);
            expect(treasureAfter - treasureBefore).to.equal(token0EntryFee);        // treasury received entry fee

            const depositTime = await vaultNative.lastCollectManagementFee();

            // withdraw
            token0Before = await ethers.provider.getBalance(user);
            expect(tx = await vaultNative.connect(user).withdraw(shares, 0, 0))
            .to.changeTokenBalance(vaultNative, user, -shares);
            token0After = await ethers.provider.getBalance(user);
            receipt = await ethers.provider.getTransactionReceipt(tx.hash);
            gasFee = tx.gasPrice * receipt.gasUsed;

            const withdrawTime = await vaultNative.lastCollectManagementFee();
            const managementFeeTimeDiff = feeConfig.managementFee * (withdrawTime - depositTime);
            const secondsInAYear = await vaultNative.SECONDS_IN_A_YEAR();
            const denominator = feeMultiplier * secondsInAYear - managementFeeTimeDiff;
            const managementFee = (shares * managementFeeTimeDiff + denominator - 1n) / denominator;    // shares in management fee

            const exitFeeShares = shares * feeConfig.exitFee / feeMultiplier;
            const totalSupply = await vaultNative.totalSupply();
            expect(totalSupply).to.equal(managementFee + exitFeeShares);    // remaining share tokens

            expectedAmount0 = token0Amount * (shares - exitFeeShares) / (shares + managementFee);
            expect(token0After - token0Before).to.be.closeTo(expectedAmount0 - gasFee, 100); // user received expectedAmount0 of token0
            expect(await vaultNative.balanceOf(treasury.address)).to.equal(exitFeeShares + managementFee); // treasury received exitFeeShares and managementFee of share
        });

        it("Should not be able to deposit and withdraw incorrect amounts", async function() {
            const { user, treasury, vaultNative } = await helpers.loadFixture(deployTeaVaultAmbientFixture);

            // set fees
            const feeConfig = {
                treasury: treasury.address,
                entryFee: 1000n,
                exitFee: 2000n,
                performanceFee: 100000n,
                managementFee: 10000n,
            }

            await vaultNative.setFeeConfig(feeConfig);

            const feeMultiplier = await vaultNative.FEE_MULTIPLIER();

            // deposit without enough value
            const token0Decimals = NATIVE_DECIMALS;
            const vaultDecimals = await vaultNative.decimals();
            const shares = ethers.parseUnits("1", vaultDecimals);
            const token0Amount = ethers.parseUnits("1", token0Decimals);
            const token0EntryFee = token0Amount * feeConfig.entryFee / feeMultiplier;
            const token0AmountWithFee = token0Amount + token0EntryFee;

            await expect(vaultNative.connect(user).deposit(shares, token0AmountWithFee, 0), { value: token0Amount })
            .to.be.revertedWithCustomError(vaultNative, "InsufficientValue");

            await expect(vaultNative.connect(user).deposit(shares, token0Amount, 0n, { value: token0AmountWithFee }))
            .to.be.revertedWithCustomError(vaultNative, "InvalidPriceSlippage");

            await vaultNative.connect(user).deposit(shares, token0AmountWithFee, 0, { value: token0AmountWithFee });

            // withdraw more than owned shares
            await expect(vaultNative.connect(user).withdraw(shares * 2n, 0, 0))
            .to.be.revertedWithCustomError(vaultNative, "ERC20InsufficientBalance");
        });

        it("Should revert with slippage checks when withdrawing", async function() {
            const { user, vaultNative } = await helpers.loadFixture(deployTeaVaultAmbientFixture);

            const token0Decimals = NATIVE_DECIMALS;
            const vaultDecimals = await vaultNative.decimals();
            const shares = ethers.parseUnits("1", vaultDecimals);
            const token0Amount = ethers.parseUnits("1", token0Decimals);

            await vaultNative.connect(user).deposit(shares, token0Amount, 0, { value: token0Amount });

            // withdraw with slippage check
            await expect(vaultNative.connect(user).withdraw(shares, token0Amount + 100n, 0n))
            .to.be.revertedWithCustomError(vaultNative, "InvalidPriceSlippage");
        });
    });

    describe("Manager functions with native token", function() {        
        it("Should be able to swap, add liquidity, remove liquidity, and withdraw", async function() {
            const { treasury, user, manager, vaultNative, token1Native } = await helpers.loadFixture(deployTeaVaultAmbientFixture);

            // set fees
            const feeConfig = {
                treasury: treasury.address,
                entryFee: 1000n,
                exitFee: 2000n,
                performanceFee: 100000n,
                managementFee: 0n,          // leave management fee at zero to make sure the vault can be emptied
            }

            await vaultNative.setFeeConfig(feeConfig);

            const feeMultiplier = await vaultNative.FEE_MULTIPLIER();

            // deposit
            const token0Decimals = NATIVE_DECIMALS;
            const vaultDecimals = await vaultNative.decimals();
            const shares = ethers.parseUnits("1", vaultDecimals);
            const token0Amount = ethers.parseUnits("1", token0Decimals);
            const token0EntryFee = token0Amount * feeConfig.entryFee / feeMultiplier;
            const token0AmountWithFee = token0Amount + token0EntryFee;

            await vaultNative.connect(user).deposit(shares, token0AmountWithFee, 0n, { value: token0AmountWithFee })

            // manager swap, using UniswapV3
            const v3Router = new ethers.Contract(testRouter, UniswapV3SwapRouterABI, ethers.provider);
            const weth9 = await v3Router.WETH9();
            const swapAmount = token0Amount / 2n;
            const swapRelayer = await vaultNative.swapRelayer();
            const swapParams = [
                weth9,
                token1Native.target,
                500,
                swapRelayer,
                UINT64_MAX,
                swapAmount,
                0n,
                0n
            ];
            const outAmount = await v3Router.connect(user).exactInputSingle.staticCall(swapParams, { value: swapAmount });
            const uniswapV3SwapData = v3Router.interface.encodeFunctionData("exactInputSingle", [ swapParams ]);
            await vaultNative.connect(manager).executeSwap(true, swapAmount, outAmount, v3Router.target, uniswapV3SwapData);

            const amount0AfterSwap = await ethers.provider.getBalance(vaultNative);
            const amount1AfterSwap = await token1Native.balanceOf(vaultNative);
            expect(amount0AfterSwap).to.gte(token0Amount - swapAmount); // should use swapAmount or less
            expect(amount1AfterSwap).to.gte(outAmount); // should receive outAmount or more

            // add liquidity
            const poolInfo = await vaultNative.getPoolInfo();
            const currentTick = poolInfo[7];
            const tickSpacing = poolInfo[5];

            // add positions
            const tick0 = ((currentTick - tickSpacing * 30n) / tickSpacing) * tickSpacing;
            const tick1 = ((currentTick - tickSpacing * 10n) / tickSpacing) * tickSpacing;
            const tick2 = ((currentTick + tickSpacing * 10n) / tickSpacing) * tickSpacing;
            const tick3 = ((currentTick + tickSpacing * 30n) / tickSpacing) * tickSpacing;

            // add "center" position
            let liquidity1 = await vaultNative.getLiquidityForAmounts(tick1, tick2, amount0AfterSwap / 3n, amount1AfterSwap / 3n);
            await vaultNative.connect(manager).addLiquidity(tick1, tick2, liquidity1, 0, 0, UINT64_MAX);

            let positionInfo = await vaultNative.positionInfo(0);
            let amounts = await vaultNative.getAmountsForLiquidity(tick1, tick2, liquidity1);
            expect(positionInfo[0]).to.be.closeTo(amounts[0], 1n);
            expect(positionInfo[1]).to.be.closeTo(amounts[1], 1n);
            
            // add "lower" position
            const amount0 = await ethers.provider.getBalance(vaultNative);
            let liquidity0 = await vaultNative.getLiquidityForAmounts(tick0, tick1, amount0, 0);
            await vaultNative.connect(manager).addLiquidity(tick0, tick1, liquidity0, 0, 0, UINT64_MAX);

            positionInfo = await vaultNative.positionInfo(1);
            amounts = await vaultNative.getAmountsForLiquidity(tick0, tick1, liquidity0);
            expect(positionInfo[0]).to.be.closeTo(amounts[0], 1n);
            expect(positionInfo[1]).to.be.closeTo(amounts[1], 1n);

            // add "upper" position
            const amount1 = await token1Native.balanceOf(vaultNative);
            let liquidity2 = await vaultNative.getLiquidityForAmounts(tick2, tick3, 0, amount1 - 10n); // slightly lower amount1 to avoid precision problem
            await vaultNative.connect(manager).addLiquidity(tick2, tick3, liquidity2, 0, 0, UINT64_MAX);

            positionInfo = await vaultNative.positionInfo(2);
            amounts = await vaultNative.getAmountsForLiquidity(tick2, tick3, liquidity2);
            expect(positionInfo[0]).to.be.closeTo(amounts[0], 1n);
            expect(positionInfo[1]).to.be.closeTo(amounts[1], 1n);

            // check assets and token values
            let assets = await vaultNative.vaultAllUnderlyingAssets();
            expect(assets[0]).to.be.closeTo(amount0AfterSwap, amount0AfterSwap / 100n);
            expect(assets[1]).to.be.closeTo(amount1AfterSwap, amount1AfterSwap / 100n);

            expect(await vaultNative.estimatedValueInToken0()).to.be.closeTo(amount0AfterSwap * 2n, amount0AfterSwap * 2n / 100n);
            expect(await vaultNative.estimatedValueInToken1()).to.be.closeTo(amount1AfterSwap * 2n, amount1AfterSwap * 2n / 100n);

            // add more liquidity
            const shares2 = ethers.parseUnits("2", vaultDecimals);
            const totalShares = await vaultNative.totalSupply();
            let token0Amount2 = (assets[0] * shares2 + totalShares - 1n) / totalShares;
            let token1Amount2 = (assets[1] * shares2 + totalShares - 1n) / totalShares;
            token0Amount2 += (token0Amount2 * feeConfig.entryFee + feeMultiplier - 1n) / feeMultiplier;
            token1Amount2 += (token1Amount2 * feeConfig.entryFee + feeMultiplier - 1n) / feeMultiplier;

            // deposit more
            await token1Native.connect(user).approve(vaultNative, token1Amount2);
            await vaultNative.connect(user).deposit(shares2 * 99n/ 100n, token0Amount2, token1Amount2, { value: token0Amount2 });

            // reduce some position
            await helpers.time.increase(1000);   // advance some time to get over the "JIT" limit
            const position = await vaultNative.positions(2);
            await vaultNative.connect(manager).removeLiquidity(position.tickLower, position.tickUpper, position.liquidity, 0, 0, UINT64_MAX);

            // check assets and token values
            assets = await vaultNative.vaultAllUnderlyingAssets();
            const newAmount0 = amount0AfterSwap + token0Amount2;
            const newAmount1 = amount1AfterSwap + token1Amount2;
            expect(assets[0]).to.be.closeTo(newAmount0, newAmount0 / 100n);
            expect(assets[1]).to.be.closeTo(newAmount1, newAmount1 / 100n);

            expect(await vaultNative.estimatedValueInToken0()).to.be.closeTo(newAmount0 * 2n, newAmount0 * 2n / 100n);
            expect(await vaultNative.estimatedValueInToken1()).to.be.closeTo(newAmount1 * 2n, newAmount1 * 2n / 100n);

            // manager swap back, using CrocSwapDex
            const swapAmount2 = await token1Native.balanceOf(vaultNative);
            const crocSwapDex = await ethers.getContractAt("ICrocSwapDex", testSwapDex);
            const abiCoder = ethers.AbiCoder.defaultAbiCoder();
            const callData = abiCoder.encode(
                [
                    "address",
                    "address",
                    "uint256", 
                    "bool", 
                    "bool",
                    "uint128",
                    "uint16",
                    "uint128",
                    "uint128",
                    "uint8"
                ],
                [
                    ZERO_ADDRESS,
                    token1Native.target,
                    testPoolIndex,
                    false,  // sell
                    false,  // in quote quantity
                    swapAmount2,
                    0n,
                    0n,
                    0n,
                    0n
                ]
            );

            const crocImpact = await ethers.getContractAt("ICrocImpact", testImpact);
            const outAmount2 = await crocImpact.calcImpact(
                ZERO_ADDRESS,
                token1Native.target,
                testPoolIndex,
                false,  // sell
                false,  // in quote quantity
                swapAmount2,
                0n,
                0n
            );
            const swapCallData = crocSwapDex.interface.encodeFunctionData("userCmd", [ 1, callData ]);
            await vaultNative.connect(manager).executeSwap(false, swapAmount2, -outAmount2[0], crocSwapDex, swapCallData);

            // withdraw
            const amount0Before = await ethers.provider.getBalance(user);
            const amount1Before = await token1Native.balanceOf(user);
            const userShares = await vaultNative.balanceOf(user);
            expect(await vaultNative.connect(user).withdraw(userShares, 0, 0))
            .to.changeTokenBalance(vaultNative, user, -userShares);
            const amount0After = await ethers.provider.getBalance(user);
            const amount1After = await token1Native.balanceOf(user);

            // estimate value of received tokens
            const amount0Diff = amount0After - amount0Before;
            const amount1Diff = amount1After - amount1Before;
            const sqrtPriceQ64 = poolInfo[6];
            const price = sqrtPriceQ64 * sqrtPriceQ64;
            const totalIn0 = amount1Diff * price / (1n << 128n) + amount0Diff;

            // expect withdrawn tokens to be > 95% of invested token0
            const investedToken0 = token0AmountWithFee + token0Amount2 + token1Amount2 * price / (1n << 128n);
            expect(totalIn0).to.be.closeTo(investedToken0, investedToken0 / 50n);

            // remove the remaining share
            const remainShares = await vaultNative.balanceOf(treasury);
            await vaultNative.connect(treasury).withdraw(remainShares, 0, 0);
            expect(await vaultNative.totalSupply()).to.equal(0);

            // positions should be empty
            expect(await vaultNative.getAllPositions()).to.eql([]);
        });
    });

    describe("User functions with ERC20 tokens", function() {        
        it("Should be able to deposit and withdraw from user", async function() {
            const { treasury, user, vaultERC20, token0ERC20 } = await helpers.loadFixture(deployTeaVaultAmbientFixture);

            // set fees
            const feeConfig = {
                treasury: treasury.address,
                entryFee: 1000n,
                exitFee: 2000n,
                performanceFee: 100000n,
                managementFee: 10000n,
            }

            await vaultERC20.setFeeConfig(feeConfig);

            const feeMultiplier = await vaultERC20.FEE_MULTIPLIER();

            // deposit
            const token0Decimals = await token0ERC20.decimals();
            const vaultDecimals = await vaultERC20.decimals();
            const shares = ethers.parseUnits("1", vaultDecimals);
            const token0Amount = ethers.parseUnits("1", token0Decimals);
            const token0EntryFee = token0Amount * feeConfig.entryFee / feeMultiplier;
            const token0AmountWithFee = token0Amount + token0EntryFee;

            let token0Before = await token0ERC20.balanceOf(user);
            let treasureBefore = await token0ERC20.balanceOf(treasury);
            
            // deposit native token
            await token0ERC20.connect(user).approve(vaultERC20, token0AmountWithFee);
            expect(await vaultERC20.connect(user).deposit(shares, token0AmountWithFee, 0n))
            .to.changeTokenBalance(vaultERC20, user, shares);
            let token0After = await token0ERC20.balanceOf(user);
            expect(token0Before - token0After).to.equal(token0AmountWithFee);

            expect(await token0ERC20.balanceOf(vaultERC20)).to.equal(token0Amount);    // vault received amount0
            let treasureAfter = await token0ERC20.balanceOf(treasury);
            expect(treasureAfter - treasureBefore).to.equal(token0EntryFee);        // treasury received entry fee

            const depositTime = await vaultERC20.lastCollectManagementFee();

            // withdraw
            token0Before = await token0ERC20.balanceOf(user);
            expect( await vaultERC20.connect(user).withdraw(shares, 0, 0))
            .to.changeTokenBalance(vaultERC20, user, -shares);
            token0After = await token0ERC20.balanceOf(user);

            const withdrawTime = await vaultERC20.lastCollectManagementFee();
            const managementFeeTimeDiff = feeConfig.managementFee * (withdrawTime - depositTime);
            const secondsInAYear = await vaultERC20.SECONDS_IN_A_YEAR();
            const denominator = feeMultiplier * secondsInAYear - managementFeeTimeDiff;
            const managementFee = (shares * managementFeeTimeDiff + denominator - 1n) / denominator;    // shares in management fee

            const exitFeeShares = shares * feeConfig.exitFee / feeMultiplier;
            const totalSupply = await vaultERC20.totalSupply();
            expect(totalSupply).to.equal(managementFee + exitFeeShares);    // remaining share tokens

            expectedAmount0 = token0Amount * (shares - exitFeeShares) / (shares + managementFee);
            expect(token0After - token0Before).to.be.closeTo(expectedAmount0, 100); // user received expectedAmount0 of token0
            expect(await vaultERC20.balanceOf(treasury.address)).to.equal(exitFeeShares + managementFee); // treasury received exitFeeShares and managementFee of share
        });

        it("Should not be able to deposit and withdraw incorrect amounts", async function() {
            const { user, treasury, vaultERC20, token0ERC20 } = await helpers.loadFixture(deployTeaVaultAmbientFixture);

            // set fees
            const feeConfig = {
                treasury: treasury.address,
                entryFee: 1000n,
                exitFee: 2000n,
                performanceFee: 100000n,
                managementFee: 10000n,
            }

            await vaultERC20.setFeeConfig(feeConfig);

            const feeMultiplier = await vaultERC20.FEE_MULTIPLIER();

            // deposit without enough value
            const token0Decimals = await token0ERC20.decimals();
            const vaultDecimals = await vaultERC20.decimals();
            const shares = ethers.parseUnits("1", vaultDecimals);
            const token0Amount = ethers.parseUnits("1", token0Decimals);
            const token0EntryFee = token0Amount * feeConfig.entryFee / feeMultiplier;
            const token0AmountWithFee = token0Amount + token0EntryFee;
            
            await token0ERC20.connect(user).approve(vaultERC20, token0Amount);
            await expect(vaultERC20.connect(user).deposit(shares, token0AmountWithFee, 0))
            .to.be.reverted;    // likely to be reverted with ERC20 token's insufficient allowance

            await token0ERC20.connect(user).approve(vaultERC20, token0Amount);
            await expect(vaultERC20.connect(user).deposit(shares, token0Amount, 0))
            .to.be.revertedWithCustomError(vaultERC20, "InvalidPriceSlippage");            

            await token0ERC20.connect(user).approve(vaultERC20, 0n);
            await token0ERC20.connect(user).approve(vaultERC20, token0AmountWithFee);
            await vaultERC20.connect(user).deposit(shares, token0AmountWithFee, 0);

            // withdraw more than owned shares
            await expect(vaultERC20.connect(user).withdraw(shares * 2n, 0, 0))
            .to.be.revertedWithCustomError(vaultERC20, "ERC20InsufficientBalance");
        });

        it("Should revert with slippage checks when withdrawing", async function() {
            const { user, vaultERC20, token0ERC20 } = await helpers.loadFixture(deployTeaVaultAmbientFixture);

            const token0Decimals = await token0ERC20.decimals();
            const vaultDecimals = await vaultERC20.decimals();
            const shares = ethers.parseUnits("1", vaultDecimals);
            const token0Amount = ethers.parseUnits("1", token0Decimals);

            await token0ERC20.connect(user).approve(vaultERC20, token0Amount);
            await vaultERC20.connect(user).deposit(shares, token0Amount, 0);

            // withdraw with slippage check
            await expect(vaultERC20.connect(user).withdraw(shares, token0Amount + 100n, 0n))
            .to.be.revertedWithCustomError(vaultERC20, "InvalidPriceSlippage");
        });
    });

    describe("Manager functions with ERC20 tokens", function() {        
        it("Should be able to swap, add liquidity, remove liquidity, and withdraw", async function() {
            const { treasury, user, manager, vaultERC20, token0ERC20, token1ERC20 } = await helpers.loadFixture(deployTeaVaultAmbientFixture);

            // set fees
            const feeConfig = {
                treasury: treasury.address,
                entryFee: 1000n,
                exitFee: 2000n,
                performanceFee: 100000n,
                managementFee: 0n,          // leave management fee at zero to make sure the vault can be emptied
            }

            await vaultERC20.setFeeConfig(feeConfig);

            const feeMultiplier = await vaultERC20.FEE_MULTIPLIER();

            // deposit
            const token0Decimals = await token0ERC20.decimals();
            const vaultDecimals = await vaultERC20.decimals();
            const shares = ethers.parseUnits("1", vaultDecimals);
            const token0Amount = ethers.parseUnits("1", token0Decimals);
            const token0EntryFee = token0Amount * feeConfig.entryFee / feeMultiplier;
            const token0AmountWithFee = token0Amount + token0EntryFee;

            await token0ERC20.connect(user).approve(vaultERC20, token0AmountWithFee);
            await vaultERC20.connect(user).deposit(shares, token0AmountWithFee, 0n);

            // manager swap, using UniswapV3
            const v3Router = new ethers.Contract(testRouter, UniswapV3SwapRouterABI, ethers.provider);
            const swapAmount = token0Amount / 2n;
            const swapRelayer = await vaultERC20.swapRelayer();
            const swapParams = [
                token0ERC20.target,
                token1ERC20.target,
                500,
                swapRelayer,
                UINT64_MAX,
                swapAmount,
                0n,
                0n
            ];
            await token0ERC20.connect(user).approve(v3Router, swapAmount);
            const outAmount = await v3Router.connect(user).exactInputSingle.staticCall(swapParams);
            const uniswapV3SwapData = v3Router.interface.encodeFunctionData("exactInputSingle", [ swapParams ]);
            await vaultERC20.connect(manager).executeSwap(true, swapAmount, outAmount, v3Router.target, uniswapV3SwapData);

            const amount0AfterSwap = await token0ERC20.balanceOf(vaultERC20);
            const amount1AfterSwap = await token1ERC20.balanceOf(vaultERC20);
            expect(amount0AfterSwap).to.gte(token0Amount - swapAmount); // should use swapAmount or less
            expect(amount1AfterSwap).to.gte(outAmount); // should receive outAmount or more

            // add liquidity
            const poolInfo = await vaultERC20.getPoolInfo();
            const currentTick = poolInfo[7];
            const tickSpacing = poolInfo[5];

            // add positions
            const tick0 = ((currentTick - tickSpacing * 30n) / tickSpacing) * tickSpacing;
            const tick1 = ((currentTick - tickSpacing * 10n) / tickSpacing) * tickSpacing;
            const tick2 = ((currentTick + tickSpacing * 10n) / tickSpacing) * tickSpacing;
            const tick3 = ((currentTick + tickSpacing * 30n) / tickSpacing) * tickSpacing;

            // add "center" position
            let liquidity1 = await vaultERC20.getLiquidityForAmounts(tick1, tick2, amount0AfterSwap / 3n, amount1AfterSwap / 3n);
            await vaultERC20.connect(manager).addLiquidity(tick1, tick2, liquidity1, 0, 0, UINT64_MAX);

            let positionInfo = await vaultERC20.positionInfo(0);
            let amounts = await vaultERC20.getAmountsForLiquidity(tick1, tick2, liquidity1);
            expect(positionInfo[0]).to.be.closeTo(amounts[0], 1n);
            expect(positionInfo[1]).to.be.closeTo(amounts[1], 1n);
            
            // add "lower" position
            const amount0 = await token0ERC20.balanceOf(vaultERC20);
            let liquidity0 = await vaultERC20.getLiquidityForAmounts(tick0, tick1, amount0, 0);
            await vaultERC20.connect(manager).addLiquidity(tick0, tick1, liquidity0, 0, 0, UINT64_MAX);

            positionInfo = await vaultERC20.positionInfo(1);
            amounts = await vaultERC20.getAmountsForLiquidity(tick0, tick1, liquidity0);
            expect(positionInfo[0]).to.be.closeTo(amounts[0], 1n);
            expect(positionInfo[1]).to.be.closeTo(amounts[1], 1n);

            // add "upper" position
            const amount1 = await token1ERC20.balanceOf(vaultERC20);
            let liquidity2 = await vaultERC20.getLiquidityForAmounts(tick2, tick3, 0, amount1 - 10n); // slightly lower amount1 to avoid precision problem
            await vaultERC20.connect(manager).addLiquidity(tick2, tick3, liquidity2, 0, 0, UINT64_MAX);

            positionInfo = await vaultERC20.positionInfo(2);
            amounts = await vaultERC20.getAmountsForLiquidity(tick2, tick3, liquidity2);
            expect(positionInfo[0]).to.be.closeTo(amounts[0], 1n);
            expect(positionInfo[1]).to.be.closeTo(amounts[1], 1n);

            // check assets and token values
            let assets = await vaultERC20.vaultAllUnderlyingAssets();
            expect(assets[0]).to.be.closeTo(amount0AfterSwap, amount0AfterSwap / 100n);
            expect(assets[1]).to.be.closeTo(amount1AfterSwap, amount1AfterSwap / 100n);

            expect(await vaultERC20.estimatedValueInToken0()).to.be.closeTo(amount0AfterSwap * 2n, amount0AfterSwap * 2n / 100n);
            expect(await vaultERC20.estimatedValueInToken1()).to.be.closeTo(amount1AfterSwap * 2n, amount1AfterSwap * 2n / 100n);

            // add more liquidity
            const shares2 = ethers.parseUnits("2", vaultDecimals);
            const totalShares = await vaultERC20.totalSupply();
            let token0Amount2 = (assets[0] * shares2 + totalShares - 1n) / totalShares;
            let token1Amount2 = (assets[1] * shares2 + totalShares - 1n) / totalShares;
            token0Amount2 += (token0Amount2 * feeConfig.entryFee + feeMultiplier - 1n) / feeMultiplier;
            token1Amount2 += (token1Amount2 * feeConfig.entryFee + feeMultiplier - 1n) / feeMultiplier;

            // deposit more
            await token0ERC20.connect(user).approve(vaultERC20, token0Amount2);
            await token1ERC20.connect(user).approve(vaultERC20, token1Amount2);
            await vaultERC20.connect(user).deposit(shares2 * 99n/ 100n, token0Amount2, token1Amount2);

            // reduce some position
            await helpers.time.increase(1000);   // advance some time to get over the "JIT" limit
            const position = await vaultERC20.positions(2);
            await vaultERC20.connect(manager).removeLiquidity(position.tickLower, position.tickUpper, position.liquidity, 0, 0, UINT64_MAX);

            // check assets and token values
            assets = await vaultERC20.vaultAllUnderlyingAssets();
            const newAmount0 = amount0AfterSwap + token0Amount2;
            const newAmount1 = amount1AfterSwap + token1Amount2;
            expect(assets[0]).to.be.closeTo(newAmount0, newAmount0 / 100n);
            expect(assets[1]).to.be.closeTo(newAmount1, newAmount1 / 100n);

            expect(await vaultERC20.estimatedValueInToken0()).to.be.closeTo(newAmount0 * 2n, newAmount0 * 2n / 100n);
            expect(await vaultERC20.estimatedValueInToken1()).to.be.closeTo(newAmount1 * 2n, newAmount1 * 2n / 100n);

            // manager swap back, using CrocSwapDex
            const swapAmount2 = await token1ERC20.balanceOf(vaultERC20);
            const crocSwapDex = await ethers.getContractAt("ICrocSwapDex", testSwapDex);
            const abiCoder = ethers.AbiCoder.defaultAbiCoder();
            const callData = abiCoder.encode(
                [
                    "address",
                    "address",
                    "uint256", 
                    "bool", 
                    "bool",
                    "uint128",
                    "uint16",
                    "uint128",
                    "uint128",
                    "uint8"
                ],
                [
                    token0ERC20.target,
                    token1ERC20.target,
                    testPoolIndex,
                    false,  // sell
                    false,  // in quote quantity
                    swapAmount2,
                    0n,
                    0n,
                    0n,
                    0n
                ]
            );

            const crocImpact = await ethers.getContractAt("ICrocImpact", testImpact);
            const outAmount2 = await crocImpact.calcImpact(
                token0ERC20.target,
                token1ERC20.target,
                testPoolIndex,
                false,  // sell
                false,  // in quote quantity
                swapAmount2,
                0n,
                0n
            );
            const swapCallData = crocSwapDex.interface.encodeFunctionData("userCmd", [ 1, callData ]);
            await vaultERC20.connect(manager).executeSwap(false, swapAmount2, -outAmount2[0], crocSwapDex, swapCallData);

            // withdraw
            const amount0Before = await token0ERC20.balanceOf(user);
            const amount1Before = await token1ERC20.balanceOf(user);
            const userShares = await vaultERC20.balanceOf(user);
            expect(await vaultERC20.connect(user).withdraw(userShares, 0, 0))
            .to.changeTokenBalance(vaultERC20, user, -userShares);
            const amount0After = await token0ERC20.balanceOf(user);
            const amount1After = await token1ERC20.balanceOf(user);

            // estimate value of received tokens
            const amount0Diff = amount0After - amount0Before;
            const amount1Diff = amount1After - amount1Before;
            const sqrtPriceQ64 = poolInfo[6];
            const price = sqrtPriceQ64 * sqrtPriceQ64;
            const totalIn0 = amount1Diff * price / (1n << 128n) + amount0Diff;

            // expect withdrawn tokens to be > 95% of invested token0
            const investedToken0 = token0AmountWithFee + token0Amount2 + token1Amount2 * price / (1n << 128n);
            expect(totalIn0).to.be.closeTo(investedToken0, investedToken0 / 50n);

            // remove the remaining share
            const remainShares = await vaultERC20.balanceOf(treasury);
            await vaultERC20.connect(treasury).withdraw(remainShares, 0, 0);
            expect(await vaultERC20.totalSupply()).to.equal(0);

            // positions should be empty
            expect(await vaultERC20.getAllPositions()).to.eql([]);
        });
    });
});
