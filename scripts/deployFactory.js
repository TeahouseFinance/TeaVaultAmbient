const { ethers, upgrades } = require("hardhat");

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

const owner = loadEnvVar(process.env.OWNER, "No OWNER");
const swapDex = loadEnvVar(process.env.AMBIENT_SWAP_DEX, "No AMBIENT_SWAP_DEX");
const impact = loadEnvVar(process.env.AMBIENT_IMPACT, "No AMBIENT_IMPACT");
const query = loadEnvVar(process.env.AMBIENT_QUERY, "No AMBIENT_QUERY");
const swapCallPath = loadEnvVarInt(process.env.AMBIENT_SWAP_CALL_PATH, "No AMBIENT_SWAP_CALL_PATH");
const lpCallPath = loadEnvVarInt(process.env.AMBIENT_LP_CALL_PATH, "No AMBIENT_LP_CALL_PATH");
const mintCode = loadEnvVarInt(process.env.AMBIENT_MINT_CODE, "No AMBIENT_MINT_CODE");
const burnCode = loadEnvVarInt(process.env.AMBIENT_BURN_CODE, "No AMBIENT_BURN_CODE");
const harvestCode = loadEnvVarInt(process.env.AMBIENT_HARVEST_CODE, "No AMBIENT_HARVEST_CODE");

const waitTime = 20000
const sleep = (delay) => new Promise((resolve) => setTimeout(resolve, delay))

async function main() {
    const TeaVaultAmbient = await ethers.getContractFactory("TeaVaultAmbient");
    const ambientBeacon = await upgrades.deployBeacon(TeaVaultAmbient);
    await sleep(waitTime);

    const TeaVaultAmbientFactory = await ethers.getContractFactory("TeaVaultAmbientFactory");
    const teaVaultAmbientFactory = await upgrades.deployProxy(
        TeaVaultAmbientFactory,
        [
            owner,
            ambientBeacon.target,
            swapDex,
            impact,
            query,
            {
                swapCallPath: swapCallPath,
                lpCallPath: lpCallPath,
                mintCodeFixedInLiquidityUnits: mintCode,
                burnCodeFixedInLiquidityUnits: burnCode,
                harvestCodeAccumulatedFees: harvestCode,
            },
        ]
    );

    console.log("TeaVaultAmbientFactory deployed", teaVaultAmbientFactory.target);
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});