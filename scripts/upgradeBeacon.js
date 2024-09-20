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

const beacon = loadEnvVar(process.env.BEACON, "No BEACON");

async function main() {
    const TeaVaultAmbient = await ethers.getContractFactory("TeaVaultAmbient");
    const ambientBeacon = await upgrades.upgradeBeacon(beacon, TeaVaultAmbient);

    console.log("Beacon upgraded", ambientBeacon.target);
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});