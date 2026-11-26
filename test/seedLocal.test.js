import { expect } from "chai";
import fs from "fs";
import os from "os";
import path from "path";
import pkg from "hardhat";
import {
    assertLocalChainId,
    DEFAULT_SEED_AMOUNT,
    LOCAL_CHAIN_ID,
    resolveTokenAddress,
    seedLocalCredits,
} from "../scripts/seedLocal.js";

const { ethers } = pkg;

describe("scripts/seedLocal.js", function () {
    const CREDIT_TOKEN = 0n;

    it("accepts local Hardhat chainId 31337 and rejects non-local chainIds", function () {
        expect(() => assertLocalChainId(LOCAL_CHAIN_ID)).to.not.throw();
        expect(() => assertLocalChainId(31337)).to.not.throw();
        expect(() => assertLocalChainId(1n)).to.throw(/non-local chainId 1/);
        expect(() => assertLocalChainId(11155111n)).to.throw(/non-local chainId 11155111/);
    });

    it("resolves tokenAddress from addresses.json and mints 1000 test credits to Account #0", async function () {
        const [deployer] = await ethers.getSigners();
        const CarbonCreditToken = await ethers.getContractFactory("CarbonCreditToken");
        const creditToken = await CarbonCreditToken.deploy(
            deployer.address,
            "https://carbocred.io/meta/{id}.json"
        );
        await creditToken.waitForDeployment();
        const tokenAddress = await creditToken.getAddress();

        const BACKEND_ROLE = await creditToken.BACKEND_ROLE();
        await (await creditToken.grantRole(BACKEND_ROLE, deployer.address)).wait();

        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "carbocred-seed-"));
        const addressesFilePath = path.join(tempDir, "addresses.json");
        fs.writeFileSync(addressesFilePath, JSON.stringify({ tokenAddress }, null, 2));

        try {
            expect(resolveTokenAddress({ addressesFilePath })).to.equal(tokenAddress);

            const result = await seedLocalCredits({
                ethersInstance: ethers,
                addressesFilePath,
                signer: deployer,
            });

            expect(result.chainId).to.equal(31337n);
            expect(result.recipient).to.equal(deployer.address);
            expect(result.amount).to.equal(DEFAULT_SEED_AMOUNT);
            expect(result.txHash).to.match(/^0x[a-fA-F0-9]{64}$/);
            expect(await creditToken.balanceOf(deployer.address, CREDIT_TOKEN)).to.equal(1000n);
        } finally {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    it("refuses to seed when provider reports a non-local chainId", async function () {
        const [deployer] = await ethers.getSigners();
        const fakeSigner = {
            address: deployer.address,
            provider: {
                getNetwork: async () => ({ chainId: 11155111n }),
            },
        };

        await expect(
            seedLocalCredits({
                ethersInstance: ethers,
                tokenAddress: deployer.address,
                signer: fakeSigner,
            })
        ).to.be.rejectedWith(/non-local chainId 11155111/);
    });
});
