import pkg from "hardhat";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import "dotenv/config";

const { ethers } = pkg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const LOCAL_CHAIN_ID = 31337n;
export const DEFAULT_SEED_AMOUNT = 1000n;
export const DEFAULT_SEED_REASON = "Test credits";

/**
 * Ensures the connected network is the local Hardhat chain (31337).
 * @param {bigint | number | string} chainId
 */
export function assertLocalChainId(chainId) {
    const normalized = typeof chainId === "bigint" ? chainId : BigInt(chainId);
    if (normalized !== LOCAL_CHAIN_ID) {
        throw new Error(
            `Refusing to run seedLocal on non-local chainId ${normalized.toString()}. Only local Hardhat chainId ${LOCAL_CHAIN_ID.toString()} is allowed.`
        );
    }
}

/**
 * Resolves the CarbonCreditToken address from override, addresses.json, or env.
 * @param {object} [options]
 * @param {string} [options.tokenAddress]
 * @param {string} [options.addressesFilePath]
 * @returns {string}
 */
export function resolveTokenAddress({ tokenAddress, addressesFilePath } = {}) {
    const explicit = tokenAddress || process.env.SEED_TOKEN_ADDRESS;
    if (explicit) {
        if (!ethers.isAddress(explicit)) {
            throw new Error(`Invalid CarbonCreditToken address override: ${explicit}`);
        }
        return explicit;
    }

    const defaultAddressesPath = path.resolve(__dirname, "..", "addresses.json");
    const resolvedPath = addressesFilePath || defaultAddressesPath;
    if (fs.existsSync(resolvedPath)) {
        const parsed = JSON.parse(fs.readFileSync(resolvedPath, "utf8"));
        if (parsed?.tokenAddress) {
            if (!ethers.isAddress(parsed.tokenAddress)) {
                throw new Error(`Invalid tokenAddress in ${resolvedPath}: ${parsed.tokenAddress}`);
            }
            return parsed.tokenAddress;
        }
    }

    const envAddress = process.env.CARBON_CREDIT_TOKEN_ADDRESS;
    if (envAddress) {
        if (!ethers.isAddress(envAddress)) {
            throw new Error(`Invalid CARBON_CREDIT_TOKEN_ADDRESS: ${envAddress}`);
        }
        return envAddress;
    }

    throw new Error(
        `Could not determine CarbonCreditToken address. Deploy first (addresses.json) or set CARBON_CREDIT_TOKEN_ADDRESS.`
    );
}

/**
 * Seeds test credits on the local Hardhat network (chainId 31337).
 */
export async function seedLocalCredits({
    ethersInstance = ethers,
    tokenAddress,
    addressesFilePath,
    signer,
    targetAddress,
    amount = DEFAULT_SEED_AMOUNT,
    reason = DEFAULT_SEED_REASON,
} = {}) {
    const activeSigner = signer ?? (await ethersInstance.getSigners())[0];
    if (!activeSigner) {
        throw new Error("No signer available to execute local seed transaction.");
    }

    const provider = activeSigner.provider ?? ethersInstance.provider;
    const network = await provider.getNetwork();
    assertLocalChainId(network.chainId);

    const resolvedTokenAddress = resolveTokenAddress({ tokenAddress, addressesFilePath });
    const recipient = targetAddress ?? activeSigner.address;

    const creditToken = await ethersInstance.getContractAt(
        "CarbonCreditToken",
        resolvedTokenAddress,
        activeSigner
    );

    const tx = await creditToken.awardCredits(recipient, amount, reason);
    const receipt = await tx.wait();

    return {
        chainId: network.chainId,
        tokenAddress: resolvedTokenAddress,
        recipient,
        amount,
        reason,
        txHash: tx.hash,
        receipt,
    };
}

export async function main() {
    const result = await seedLocalCredits();
    console.log(
        `[seedLocal] Minted ${result.amount.toString()} credits to ${result.recipient} on token ${result.tokenAddress} (tx: ${result.txHash})`
    );
    return result;
}

const isDirectExecution = process.argv.some((arg) => {
    try {
        return path.resolve(arg) === __filename;
    } catch {
        return false;
    }
});

if (isDirectExecution) {
    main().catch((err) => {
        console.error(`[seedLocal] Error: ${err.message}`);
        process.exitCode = 1;
    });
}
