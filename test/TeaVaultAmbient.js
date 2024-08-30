const helpers = require("@nomicfoundation/hardhat-toolbox/network-helpers");
const { anyValue } = require("@nomicfoundation/hardhat-chai-matchers/withArgs");
const { expect } = require("chai");
const { ethers, upgrades } = require("hardhat");

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
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
const testToken0 = loadEnvVar(process.env.AMBIENT_TEST_TOKEN0, "No AMBIENT_TEST_TOKEN0");
const testToken1 = loadEnvVar(process.env.AMBIENT_TEST_TOKEN1, "No AMBIENT_TEST_TOKEN1");
const testDecimalOffset = loadEnvVarInt(process.env.AMBIENT_TEST_DECIMAL_OFFSET, "No AMBIENT_TEST_DECIMAL_OFFSET");
const testPoolIndex = loadEnvVarInt(process.env.AMBIENT_TEST_POOL_INDEX, "No AMBIENT_TEST_POOL_INDEX");

describe("TeaVaultAmbient", function () {
    async function deployTeaVaultAmbientFixture() {
        // fork a testing environment
        await helpers.reset(testRpc, testBlock);

        // Contracts are deployed using the first signer/account by default
        const [ owner, manager, treasury, user ] = await ethers.getSigners();

        // get ERC20 tokens
        const MockToken = await ethers.getContractFactory("MockToken");
        const token0 = MockToken.attach(testToken0);
        const token1 = MockToken.attach(testToken1);

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

        await teaVaultAmbientFactory.createVault(
            owner.address,
            "Test Vault",
            "TVAULT",
            testDecimalOffset,
            testToken0,
            testToken1,
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

        const events = await teaVaultAmbientFactory.queryFilter("VaultDeployed");
        const vault = TeaVaultAmbient.attach(events[0].args[0]);

        return { owner, manager, treasury, user, vault, token0, token1 };
    }

    describe("Deployment", function() {
        it("Should set the correct tokens", async function () {
            const { vault, token0, token1 } = await helpers.loadFixture(deployTeaVaultAmbientFixture);

            expect(await vault.assetToken0()).to.equal(token0.target);
            expect(await vault.assetToken1()).to.equal(token1.target);

            const poolInfo = await vault.getPoolInfo();
            expect(poolInfo[0]).to.equal(token0.target);
            expect(poolInfo[1]).to.equal(token1.target);
        });

        it("Should set the correct decimals", async function () {
            const { vault, token0 } = await helpers.loadFixture(deployTeaVaultAmbientFixture);

            const token0Decimals = await getDecimals(token0);
            expect(await vault.decimals()).to.equal(token0Decimals + testDecimalOffset);
        });
    });

    describe("Owner functions", function() {
        it("Should be able to set fees from owner", async function() {
            const { owner, vault } = await helpers.loadFixture(deployTeaVaultAmbientFixture);

            const feeConfig = {
                treasury: owner.address,
                entryFee: 1000,
                exitFee: 2000,
                performanceFee: 100000,
                managementFee: 10000,
            };

            await vault.setFeeConfig(feeConfig);
            const fees = await vault.feeConfig();

            expect(feeConfig.treasury).to.equal(fees.treasury);
            expect(feeConfig.entryFee).to.equal(fees.entryFee);
            expect(feeConfig.exitFee).to.equal(fees.exitFee);
            expect(feeConfig.performanceFee).to.equal(fees.performanceFee);
            expect(feeConfig.managementFee).to.equal(fees.managementFee);
        });

        it("Should not be able to set incorrect fees", async function() {
            const { owner, vault } = await helpers.loadFixture(deployTeaVaultAmbientFixture);

            const feeConfig1 = {
                treasury: owner.address,
                entryFee: 500001,
                exitFee: 500000,
                performanceFee: 100000,
                managementFee: 10000,
            };

            await expect(vault.setFeeConfig(feeConfig1))
            .to.be.revertedWithCustomError(vault, "InvalidFeePercentage");

            const feeConfig2 = {
                treasury: owner.address,
                entryFee: 1000,
                exitFee: 2000,
                performanceFee: 1000001,
                managementFee: 10000,
            };

            await expect(vault.setFeeConfig(feeConfig2))
            .to.be.revertedWithCustomError(vault, "InvalidFeePercentage");

            const feeConfig3 = {
                treasury: owner.address,
                entryFee: 1000,
                exitFee: 2000,
                performanceFee: 100000,
                managementFee: 1000001,
            };

            await expect(vault.setFeeConfig(feeConfig3))
            .to.be.revertedWithCustomError(vault, "InvalidFeePercentage");
        });

        it("Should not be able to set fees from non-owner", async function() {
            const { manager, vault } = await helpers.loadFixture(deployTeaVaultAmbientFixture);

            const feeConfig = {
                treasury: manager.address,
                entryFee: 1000,
                exitFee: 2000,
                performanceFee: 100000,
                managementFee: 10000,
            }

            await expect(vault.connect(manager).setFeeConfig(feeConfig))
            .to.be.revertedWithCustomError(vault, "OwnableUnauthorizedAccount");
        });

        it("Should be able to assign manager from owner", async function() {
            const { manager, vault } = await helpers.loadFixture(deployTeaVaultAmbientFixture);

            await vault.assignManager(manager.address);
            expect(await vault.manager()).to.equal(manager.address);
        });

        it("Should not be able to assign manager from non-owner", async function() {
            const { manager, user, vault } = await helpers.loadFixture(deployTeaVaultAmbientFixture);

            await expect(vault.connect(manager).assignManager(user.address))
            .to.be.revertedWithCustomError(vault, "OwnableUnauthorizedAccount");
            expect(await vault.manager()).to.equal(manager.address);
        });
    });

    describe("User functions", function() {        
        it("Should be able to deposit and withdraw from user", async function() {
            const { owner, treasury, user, vault, token0 } = await helpers.loadFixture(deployTeaVaultAmbientFixture);

            // set fees
            const feeConfig = {
                treasury: treasury.address,
                entryFee: 1000,
                exitFee: 2000,
                performanceFee: 100000,
                managementFee: 10000,
            }

            await vault.setFeeConfig(feeConfig);

            // deposit
            const token0Decimals = await getDecimals(token0);
            const vaultDecimals = await getDecimals(vault);
            await approveToken(token0, vault, ethers.parseUnits("10000", token0Decimals));
            const shares = ethers.parseUnits("100", vaultDecimals);
            const token0Amount = ethers.parseUnits("100", token0Decimals);

            // let token0Before = await getTokenBalance(token0, user);
            // if (token0 == ZERO_ADDRESS) {
            //     // deposit native token
            //     expect(await vault.connect(user).deposit(shares, UINT256_MAX, UINT256_MAX, { value: token0Amount }))
            //     .to.changeTokenBalance(vault, user, shares);    
            // }
            // else {
            //     // deposit ERC20 token
            //     expect(await vault.connect(user).deposit(shares, UINT256_MAX, UINT256_MAX))
            //     .to.changeTokenBalance(vault, user, shares);    
            // }
            // let token0After = await getBalance(token0, user);
            // expect(token0Before - token0After).to.equal(token0Amount);

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
