import { expect } from "chai";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import pkg from "hardhat";

const { ethers } = pkg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");

describe("CarboCred Deployment & Role Setup (ESM)", function () {
    const META_URI = "https://carbocred.io/meta/{id}.json";

    async function deployEcosystem({ deployer, backendWallet, metaURI = META_URI }) {
        const CarbonCreditToken = await ethers.getContractFactory("CarbonCreditToken");
        const creditToken = await CarbonCreditToken.deploy(deployer.address, metaURI);
        await creditToken.waitForDeployment();
        const tokenAddress = await creditToken.getAddress();

        const CarbonMarketplace = await ethers.getContractFactory("CarbonMarketplace");
        const marketplace = await CarbonMarketplace.deploy(tokenAddress);
        await marketplace.waitForDeployment();
        const marketplaceAddress = await marketplace.getAddress();

        const MARKETPLACE_ROLE = await creditToken.MARKETPLACE_ROLE();
        await (await creditToken.grantRole(MARKETPLACE_ROLE, marketplaceAddress)).wait();

        const BACKEND_ROLE = await creditToken.BACKEND_ROLE();
        await (await creditToken.grantRole(BACKEND_ROLE, backendWallet.address)).wait();

        return { creditToken, marketplace, tokenAddress, marketplaceAddress };
    }

    it("deploys CarbonCreditToken and CarbonMarketplace and wires roles matching scripts/deploy.js", async function () {
        const [deployer, backendWallet, seller, buyer] = await ethers.getSigners();
        const { creditToken, marketplace, tokenAddress, marketplaceAddress } =
            await deployEcosystem({ deployer, backendWallet });

        expect(ethers.isAddress(tokenAddress)).to.equal(true);
        expect(ethers.isAddress(marketplaceAddress)).to.equal(true);
        expect(await creditToken.uri(0n)).to.equal(META_URI);

        const DEFAULT_ADMIN_ROLE = await creditToken.DEFAULT_ADMIN_ROLE();
        const MARKETPLACE_ROLE = await creditToken.MARKETPLACE_ROLE();
        const BACKEND_ROLE = await creditToken.BACKEND_ROLE();

        expect(await creditToken.hasRole(DEFAULT_ADMIN_ROLE, deployer.address)).to.equal(true);
        expect(await creditToken.hasRole(MARKETPLACE_ROLE, marketplaceAddress)).to.equal(true);
        expect(await creditToken.hasRole(BACKEND_ROLE, backendWallet.address)).to.equal(true);
        expect(await creditToken.hasRole(BACKEND_ROLE, seller.address)).to.equal(false);

        // Verify wired roles work end-to-end immediately after deployment
        await creditToken.connect(backendWallet).awardCredits(seller.address, 250n, "Deployment smoke test");
        await creditToken.connect(backendWallet).recordDebt(buyer.address, 50n, "Baseline emissions");

        const pricePerCredit = ethers.parseEther("0.005");
        await marketplace.connect(seller).listCredits(100n, pricePerCredit);
        await marketplace.connect(buyer).purchaseListing(0n, { value: 100n * pricePerCredit });

        expect(await creditToken.balanceOf(seller.address, 0n)).to.equal(150n);
        expect(await creditToken.balanceOf(buyer.address, 0n)).to.equal(50n);
        expect(await creditToken.balanceOf(buyer.address, 1n)).to.equal(0n);
        expect(await creditToken.netCredits(buyer.address)).to.equal(50n);
    });

    it("supports scripts/getAddresses.js deployment pattern with deployer as backend wallet", async function () {
        const [deployer] = await ethers.getSigners();
        const { creditToken, tokenAddress, marketplaceAddress } =
            await deployEcosystem({ deployer, backendWallet: deployer });

        const MARKETPLACE_ROLE = await creditToken.MARKETPLACE_ROLE();
        const BACKEND_ROLE = await creditToken.BACKEND_ROLE();

        expect(await creditToken.hasRole(MARKETPLACE_ROLE, marketplaceAddress)).to.equal(true);
        expect(await creditToken.hasRole(BACKEND_ROLE, deployer.address)).to.equal(true);

        const addressesPayload = {
            deployer: deployer.address,
            tokenAddress,
            marketplaceAddress,
        };
        expect(addressesPayload.deployer).to.equal(deployer.address);
        expect(addressesPayload.tokenAddress).to.equal(tokenAddress);
        expect(addressesPayload.marketplaceAddress).to.equal(marketplaceAddress);
    });

    it("scripts/deploy.js and scripts/getAddresses.js use ESM imports without CommonJS require/module.exports", function () {
        for (const relPath of ["scripts/deploy.js", "scripts/getAddresses.js", "hardhat.config.js"]) {
            const source = fs.readFileSync(path.join(rootDir, relPath), "utf8");
            expect(source).to.not.match(/\brequire\s*\(/);
            expect(source).to.not.match(/\bmodule\.exports\b/);
        }
    });
});
