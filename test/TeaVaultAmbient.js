const helpers = require("@nomicfoundation/hardhat-toolbox/network-helpers");
const { anyValue } = require("@nomicfoundation/hardhat-chai-matchers/withArgs");
const { expect } = require("chai");
const { ethers, upgrades } = require("hardhat");

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
const NATIVE_ADDRESS = ZERO_ADDRESS;
const NATIVE_DECIMALS = 18;
const UINT256_MAX = '0x' + 'f'.repeat(64);
const UINT64_MAX = '0x' + 'f'.repeat(16);

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

// various ERC20 functions for supporting native token
async function getDecimals(token) {
    if (token.target == ZERO_ADDRESS) {
        return 18;
    }
    else {
        return token.decimals();
    }
}

async function approveToken(token, target, amount) {
    if (token.target != ZERO_ADDRESS) {
        return token.approve(target, amount);
    }
}

async function getTokenBalance(token, target) {
    if (token.target == ZERO_ADDRESS) {
        return ethers.provider.getBalance(target);
    }
    else {
        return token.balanceOf(target);
    }
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
const testDecimalOffsetNative = loadEnvVarInt(process.env.AMBIENT_TEST_DECIMAL_OFFSET_NATIVE, "No AMBIENT_TEST_DECIMAL_OFFSET_NATIVE");
const testToken0ERC20 = loadEnvVar(process.env.AMBIENT_TEST_TOKEN0_ERC20, "No AMBIENT_TEST_TOKEN0_ERC20");
const testToken1ERC20 = loadEnvVar(process.env.AMBIENT_TEST_TOKEN1_ERC20, "No AMBIENT_TEST_TOKEN1_ERC20");
const testDecimalOffsetERC20 = loadEnvVarInt(process.env.AMBIENT_TEST_DECIMAL_OFFSET_ERC20, "No AMBIENT_TEST_DECIMAL_OFFSET_ERC20");
const testPoolIndex = loadEnvVarInt(process.env.AMBIENT_TEST_POOL_INDEX, "No AMBIENT_TEST_POOL_INDEX");

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

        let events = await teaVaultAmbientFactory.queryFilter("VaultDeployed", txNative.block, txNative.block);
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

        events = await teaVaultAmbientFactory.queryFilter("VaultDeployed", txERC20.block, txERC20.block);
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

            const token0Decimals = await getDecimals(token0ERC20);
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
            const { owner, treasury, user, vaultNative, token1Native } = await helpers.loadFixture(deployTeaVaultAmbientFixture);

            // set fees
            const feeConfig = {
                treasury: treasury.address,
                entryFee: 1000n,
                exitFee: 2000n,
                performanceFee: 100000n,
                managementFee: 10000n,
            }

            await vaultNative.setFeeConfig(feeConfig);

            // deposit
            const token0Decimals = NATIVE_DECIMALS;
            const vaultDecimals = await getDecimals(vaultNative);
            //await approveToken(token0, vault, ethers.parseUnits("100", token0Decimals));
            const shares = ethers.parseUnits("1", vaultDecimals);
            const token0Amount = ethers.parseUnits("1", token0Decimals);
            const token0AmountWithFee = token0Amount * (1000000n + feeConfig.entryFee) / 1000000n

            let token0Before = await ethers.provider.getBalance(user);
            let gasFee = 0n;
            // deposit native token
            let tx;
            expect(tx = await vaultNative.connect(user).deposit(shares, token0AmountWithFee, 0n, { value: token0AmountWithFee }))
            .to.changeTokenBalance(vaultNative, user, shares);
            const receipt = await ethers.provider.getTransactionReceipt(tx.hash);
            gasFee = tx.gasPrice * receipt.gasUsed;
            let token0After = await ethers.provider.getBalance(user);
            expect(token0Before - token0After).to.equal(token0AmountWithFee + gasFee);

            // let expectedAmount0 = ethers.BigNumber.from(token0Amount);
            // const entryFeeAmount0 = expectedAmount0.mul(feeConfig.entryFee).div("1000000");
            // expectedAmount0 = expectedAmount0.add(entryFeeAmount0);
            // expect(token0Before.sub(token0After)).to.equal(expectedAmount0); // user spent expectedAmount0 of token0
            // expect(await token0.balanceOf(owner.address)).to.equal(entryFeeAmount0); // vault received entryFeeAmount0 of token0
            // const depositTime = await vault.lastCollectManagementFee();

            // // withdraw
            // token0Before = await token0.balanceOf(user.address);
            // await vault.connect(user).withdraw(shares, 0, 0);
            // expect(await vault.balanceOf(user.address)).to.equal(0);
            // token0After = await token0.balanceOf(user.address);

            // const withdrawTime = await vault.lastCollectManagementFee();
            // const managementFeeTimeDiff = feeConfig.managementFee * (withdrawTime - depositTime);
            // const feeMultiplier = await vault.FEE_MULTIPLIER();
            // const secondsInAYear = await vault.SECONDS_IN_A_YEAR();
            // const denominator = feeMultiplier * secondsInAYear - managementFeeTimeDiff;
            // const managementFee = ethers.BigNumber.from(shares).mul(managementFeeTimeDiff).add(denominator - 1).div(denominator);

            // const totalSupply = await vault.totalSupply();
            // expectedAmount0 = ethers.BigNumber.from(token0Amount).mul(totalSupply.sub(managementFee)).div(totalSupply);
            // const exitFeeAmount0 = expectedAmount0.mul(feeConfig.exitFee).div("1000000");
            // const exitFeeShares = ethers.BigNumber.from(shares).mul(feeConfig.exitFee).div("1000000");
            // expectedAmount0 = expectedAmount0.sub(exitFeeAmount0);
            // expect(token0After.sub(token0Before)).to.be.closeTo(expectedAmount0, 100); // user received expectedAmount0 of token0
            // expect(await vault.balanceOf(owner.address)).to.equal(exitFeeShares.add(managementFee)); // vault received exitFeeShares and managementFee of share
        });

        // it("Should not be able to deposit and withdraw incorrect amounts", async function() {
        //     const { user, vault, token0 } = await helpers.loadFixture(deployTeaVaultV3Pair);

        //     // deposit without enough allowance
        //     await token0.connect(user).approve(vault.address, "1000" + "0".repeat(await token0.decimals()));
        //     const shares = "10000" + "0".repeat(await vault.decimals());
        //     await expect(vault.connect(user).deposit(shares, UINT256_MAX, UINT256_MAX)).to.be.revertedWith("");

        //     const smallerShares = "100" + "0".repeat(await vault.decimals());
        //     await vault.connect(user).deposit(smallerShares, UINT256_MAX, UINT256_MAX);

        //     // withdraw more than owned shares
        //     await expect(vault.connect(user).withdraw(shares, 0, 0)).to.be.revertedWith("");
        // });

        // it("Should revert with slippage checks when depositing", async function() {
        //     const { user, vault, token0 } = await helpers.loadFixture(deployTeaVaultV3Pair);

        //     // deposit with slippage check
        //     await token0.connect(user).approve(vault.address, "10000" + "0".repeat(await token0.decimals()));
        //     const shares = "10000" + "0".repeat(await vault.decimals());
        //     await expect(vault.connect(user).deposit(shares, "100", "100")).to.be.revertedWith("");
        // });

        // it("Should revert with slippage checks when withdrawing", async function() {
        //     const { user, vault, token0 } = await helpers.loadFixture(deployTeaVaultV3Pair);

        //     await token0.connect(user).approve(vault.address, "1000" + "0".repeat(await token0.decimals()));
        //     const shares = "100" + "0".repeat(await vault.decimals());
        //     await vault.connect(user).deposit(shares, UINT256_MAX, UINT256_MAX);

        //     // withdraw with slippage check
        //     await expect(vault.connect(user).withdraw(shares, "100", "100")).to.be.revertedWith("");
        // });
    });
});
