/**
 * backend/signer.js
 *
 * This module manages the BACKEND_ROLE wallet.
 * It provides functions to award credits, record debt, and clear debt.
 */

import { ethers } from "ethers";
import "dotenv/config";

// Contract ABI (just the functions we need for signing)
const CARBON_CREDIT_TOKEN_ABI = [
    "function awardCredits(address entity, uint256 amount, string calldata reason)",
    "function recordDebt(address entity, uint256 amount, string calldata reason)",
    "function clearDebt(address entity, uint256 amount)",
];

export let provider = null;
let wallet = null;
let creditToken = null;
let txQueue = Promise.resolve();

/**
 * Serialize all EOA-signed transactions through a FIFO async queue
 * so concurrent approvals never collide on account nonces.
 */
export function enqueueTx(task) {
    const run = txQueue.then(() => task());
    txQueue = run.catch(() => {});
    return run;
}

function getRpcHttpUrl() {
    const rpcUrl = process.env.RPC_URL;
    if (!rpcUrl) {
        throw new Error("RPC_URL environment variable is required");
    }
    return rpcUrl.replace("ws://", "http://").replace("wss://", "https://");
}

export function getProvider() {
    if (!provider) {
        provider = new ethers.JsonRpcProvider(getRpcHttpUrl());
    }
    return provider;
}

export function initSigner() {
    const rpcProvider = getProvider();
    if (!wallet || !creditToken) {
        const privateKey = process.env.BACKEND_PRIVATE_KEY;
        const tokenAddress = process.env.CARBON_CREDIT_TOKEN_ADDRESS;
        if (!privateKey) {
            throw new Error("BACKEND_PRIVATE_KEY environment variable is required");
        }
        if (!tokenAddress) {
            throw new Error("CARBON_CREDIT_TOKEN_ADDRESS environment variable is required");
        }
        wallet = new ethers.Wallet(privateKey, rpcProvider);
        creditToken = new ethers.Contract(tokenAddress, CARBON_CREDIT_TOKEN_ABI, wallet);
    }
    return { provider: rpcProvider, wallet, creditToken };
}

export function resetSigner() {
    provider = null;
    wallet = null;
    creditToken = null;
    txQueue = Promise.resolve();
}

export function setSignerForTest({
    provider: testProvider,
    wallet: testWallet,
    creditToken: testToken,
} = {}) {
    provider = testProvider ?? null;
    wallet = testWallet ?? null;
    creditToken = testToken ?? null;
}

export function awardCredits(entity, amount, reason) {
    return enqueueTx(async () => {
        const { creditToken: token } = initSigner();
        console.log(`[Signer] Awarding ${amount} credits to ${entity}...`);
        const tx = await token.awardCredits(entity, amount, reason);
        return await tx.wait();
    });
}

export function recordDebt(entity, amount, reason) {
    return enqueueTx(async () => {
        const { creditToken: token } = initSigner();
        console.log(`[Signer] Recording ${amount} debt for ${entity}...`);
        const tx = await token.recordDebt(entity, amount, reason);
        return await tx.wait();
    });
}

export function clearDebt(entity, amount) {
    return enqueueTx(async () => {
        const { creditToken: token } = initSigner();
        console.log(`[Signer] Clearing ${amount} debt for ${entity}...`);
        const tx = await token.clearDebt(entity, amount);
        return await tx.wait();
    });
}
