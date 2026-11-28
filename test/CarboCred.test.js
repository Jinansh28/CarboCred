import { expect } from "chai";
import pkg from "hardhat";

const { ethers } = pkg;

/**
 * CarboCred ERC-1155 Test Suite
 *
 * Covers:
 *  - CarbonCreditToken: minting credits, recording debt, net position calculation,
 *    soulbound debt enforcement, access control
 *  - CarbonMarketplace: listing, cancellation, purchase, edge cases
 */
describe("CarboCred Ecosystem (ERC-1155)", function () {

    let admin, backend, seller, buyer, attacker;
    let creditToken, marketplace;

    const BACKEND_ROLE = ethers.keccak256(ethers.toUtf8Bytes("BACKEND_ROLE"));
    const MARKETPLACE_ROLE = ethers.keccak256(ethers.toUtf8Bytes("MARKETPLACE_ROLE"));

    const CREDIT_TOKEN = 0n;
    const DEBT_TOKEN = 1n;

    beforeEach(async function () {
        [admin, backend, seller, buyer, attacker] = await ethers.getSigners();

        // Deploy CarbonCreditToken (ERC-1155)
        const CarbonCreditToken = await ethers.getContractFactory("CarbonCreditToken");
        creditToken = await CarbonCreditToken.deploy(
            admin.address,
            "https://carbocred.io/meta/{id}.json"
        );
        await creditToken.waitForDeployment();

        // Deploy CarbonMarketplace
        const CarbonMarketplace = await ethers.getContractFactory("CarbonMarketplace");
        marketplace = await CarbonMarketplace.deploy(
            await creditToken.getAddress()
        );
        await marketplace.waitForDeployment();

        // Grant roles
        await creditToken.connect(admin).grantRole(BACKEND_ROLE, backend.address);
        await creditToken.connect(admin).grantRole(MARKETPLACE_ROLE, await marketplace.getAddress());
    });

    // ══════════════════════════════════════════════════════════════════════════
    //  CarbonCreditToken
    // ══════════════════════════════════════════════════════════════════════════

    describe("CarbonCreditToken", function () {

        // ── Access control ────────────────────────────────────────────────────────

        it("should NOT allow non-BACKEND_ROLE to award credits", async function () {
            await expect(
                creditToken.connect(attacker).awardCredits(seller.address, 100n, "hack")
            ).to.be.reverted;
        });

        it("should NOT allow non-BACKEND_ROLE to record debt", async function () {
            await expect(
                creditToken.connect(attacker).recordDebt(seller.address, 100n, "hack")
            ).to.be.reverted;
        });

        it("should NOT allow non-MARKETPLACE_ROLE to call settleTransfer", async function () {
            await creditToken.connect(backend).awardCredits(seller.address, 100n, "test");
            await expect(
                creditToken.connect(attacker).settleTransfer(seller.address, buyer.address, 50n)
            ).to.be.reverted;
        });

        // ── Positive credits (green energy) ──────────────────────────────────────

        it("BACKEND can award positive CREDIT_TOKEN to a green energy entity", async function () {
            await expect(
                creditToken.connect(backend).awardCredits(seller.address, 500n, "Solar Q1 2025")
            )
                .to.emit(creditToken, "CreditsAwarded")
                .withArgs(seller.address, 500n, "Solar Q1 2025");

            expect(await creditToken.balanceOf(seller.address, CREDIT_TOKEN)).to.equal(500n);
        });

        // ── Negative position (emission debt) ────────────────────────────────────

        it("BACKEND can record DEBT_TOKEN for a carbon emitter", async function () {
            await expect(
                creditToken.connect(backend).recordDebt(seller.address, 200n, "Factory Jan 2025")
            )
                .to.emit(creditToken, "DebtRecorded")
                .withArgs(seller.address, 200n, "Factory Jan 2025");

            expect(await creditToken.balanceOf(seller.address, DEBT_TOKEN)).to.equal(200n);
        });

        it("netCredits returns negative for a pure emitter", async function () {
            await creditToken.connect(backend).recordDebt(seller.address, 300n, "emissions");
            expect(await creditToken.netCredits(seller.address)).to.equal(-300n);
        });

        it("netCredits returns positive for a pure green generator", async function () {
            await creditToken.connect(backend).awardCredits(seller.address, 400n, "wind");
            expect(await creditToken.netCredits(seller.address)).to.equal(400n);
        });

        it("netCredits reflects partial offset correctly", async function () {
            // Entity has 100 credits, 150 debt → net = -50
            await creditToken.connect(backend).awardCredits(seller.address, 100n, "solar");
            await creditToken.connect(backend).recordDebt(seller.address, 150n, "factory");
            expect(await creditToken.netCredits(seller.address)).to.equal(-50n);
        });

        it("getPosition returns both balances", async function () {
            await creditToken.connect(backend).awardCredits(seller.address, 200n, "wind");
            await creditToken.connect(backend).recordDebt(seller.address, 80n, "coal");
            const [credits, debt] = await creditToken.getPosition(seller.address);
            expect(credits).to.equal(200n);
            expect(debt).to.equal(80n);
        });

        // ── Debt clearing ─────────────────────────────────────────────────────────

        it("BACKEND can clear debt after entity purchases and retires credits", async function () {
            await creditToken.connect(backend).recordDebt(seller.address, 100n, "emissions");
            await expect(creditToken.connect(backend).clearDebt(seller.address, 100n))
                .to.emit(creditToken, "DebtCleared")
                .withArgs(seller.address, 100n);
            expect(await creditToken.balanceOf(seller.address, DEBT_TOKEN)).to.equal(0n);
        });

        // ── Soulbound DEBT_TOKEN ──────────────────────────────────────────────────

        it("DEBT_TOKEN should be soulbound — direct transfer must revert", async function () {
            await creditToken.connect(backend).recordDebt(seller.address, 100n, "emissions");

            // seller tries to transfer DEBT_TOKEN to buyer directly
            await expect(
                creditToken
                    .connect(seller)
                    .safeTransferFrom(seller.address, buyer.address, DEBT_TOKEN, 50n, "0x")
            ).to.be.revertedWith("CCT: DEBT_TOKEN is soulbound and non-transferable");
        });

        it("CREDIT_TOKEN should be freely transferable between wallets", async function () {
            await creditToken.connect(backend).awardCredits(seller.address, 200n, "solar");
            // Direct ERC-1155 transfer (outside marketplace) should work
            await creditToken
                .connect(seller)
                .safeTransferFrom(seller.address, buyer.address, CREDIT_TOKEN, 50n, "0x");
            expect(await creditToken.balanceOf(buyer.address, CREDIT_TOKEN)).to.equal(50n);
        });

        // ── Self-retirement (retireOwnCredits) ────────────────────────────────────

        it("retireOwnCredits burns credits and automatically clears debt up to amount", async function () {
            await creditToken.connect(backend).awardCredits(seller.address, 100n, "solar");
            await creditToken.connect(backend).recordDebt(seller.address, 30n, "emissions");

            await expect(creditToken.connect(seller).retireOwnCredits(50n))
                .to.emit(creditToken, "DebtCleared")
                .withArgs(seller.address, 30n)
                .and.to.emit(creditToken, "CreditsRetired")
                .withArgs(seller.address, 50n);

            expect(await creditToken.balanceOf(seller.address, CREDIT_TOKEN)).to.equal(50n);
            expect(await creditToken.balanceOf(seller.address, DEBT_TOKEN)).to.equal(0n);
            expect(await creditToken.netCredits(seller.address)).to.equal(50n);
        });

        it("retireOwnCredits works when entity has no debt (emits CreditsRetired only)", async function () {
            await creditToken.connect(backend).awardCredits(seller.address, 100n, "solar");

            await expect(creditToken.connect(seller).retireOwnCredits(40n))
                .to.emit(creditToken, "CreditsRetired")
                .withArgs(seller.address, 40n)
                .and.to.not.emit(creditToken, "DebtCleared");

            expect(await creditToken.balanceOf(seller.address, CREDIT_TOKEN)).to.equal(60n);
            expect(await creditToken.balanceOf(seller.address, DEBT_TOKEN)).to.equal(0n);
            expect(await creditToken.netCredits(seller.address)).to.equal(60n);
        });

        it("retireOwnCredits reverts on zero amount", async function () {
            await expect(
                creditToken.connect(seller).retireOwnCredits(0n)
            ).to.be.revertedWith("CCT: zero amount");
        });

        it("retireOwnCredits reverts on insufficient credits", async function () {
            await creditToken.connect(backend).awardCredits(seller.address, 20n, "solar");
            await expect(
                creditToken.connect(seller).retireOwnCredits(50n)
            ).to.be.revertedWith("CCT: insufficient credits");
        });
    });

    // ══════════════════════════════════════════════════════════════════════════
    //  CarbonMarketplace
    // ══════════════════════════════════════════════════════════════════════════

    describe("CarbonMarketplace", function () {
        const CREDIT_AMOUNT = 100n;
        const PRICE_PER_CREDIT = ethers.parseEther("0.01");

        beforeEach(async function () {
            // Give seller 200 CREDIT_TOKEN
            await creditToken.connect(backend).awardCredits(seller.address, 200n, "wind farm");
        });

        // ── listCredits ───────────────────────────────────────────────────────────

        it("seller with sufficient CREDIT_TOKEN can create a listing", async function () {
            await expect(
                marketplace.connect(seller).listCredits(CREDIT_AMOUNT, PRICE_PER_CREDIT)
            )
                .to.emit(marketplace, "ListingCreated")
                .withArgs(0n, seller.address, CREDIT_AMOUNT, PRICE_PER_CREDIT);

            const listing = await marketplace.getListing(0n);
            expect(listing.seller).to.equal(seller.address);
            expect(listing.amount).to.equal(CREDIT_AMOUNT);
            expect(listing.status).to.equal(0n); // Open
        });

        it("should revert listing when net position < amount", async function () {
            await expect(
                marketplace.connect(seller).listCredits(500n, PRICE_PER_CREDIT)
            ).to.be.revertedWith("Marketplace: insufficient available net credits (check locked listings)");
        });

        it("entity with only DEBT_TOKEN (net emitter) cannot list credits", async function () {
            // attacker has no credits, only debt → net = -50
            await creditToken.connect(backend).recordDebt(attacker.address, 50n, "emissions");
            await expect(
                marketplace.connect(attacker).listCredits(10n, PRICE_PER_CREDIT)
            ).to.be.revertedWith("Marketplace: insufficient available net credits (check locked listings)");
        });

        it("entity with credits but larger debt (net negative) cannot list", async function () {
            // seller has 200 credits but 300 debt → net = -100
            await creditToken.connect(backend).recordDebt(seller.address, 300n, "factory");
            await expect(
                marketplace.connect(seller).listCredits(10n, PRICE_PER_CREDIT)
            ).to.be.revertedWith("Marketplace: insufficient available net credits (check locked listings)");
        });

        it("should revert listing with zero amount", async function () {
            await expect(
                marketplace.connect(seller).listCredits(0n, PRICE_PER_CREDIT)
            ).to.be.revertedWith("Marketplace: zero amount");
        });

        it("should revert listing with zero price", async function () {
            await expect(
                marketplace.connect(seller).listCredits(CREDIT_AMOUNT, 0n)
            ).to.be.revertedWith("Marketplace: zero price");
        });

        it("should revert listing when amount * pricePerCredit overflows", async function () {
            const hugePrice = ethers.MaxUint256 / 10n;
            await expect(
                marketplace.connect(seller).listCredits(CREDIT_AMOUNT, hugePrice)
            ).to.be.revertedWith("Marketplace: total price overflow");
        });

        // ── cancelListing ─────────────────────────────────────────────────────────

        it("seller can cancel their own listing", async function () {
            await marketplace.connect(seller).listCredits(CREDIT_AMOUNT, PRICE_PER_CREDIT);
            await expect(marketplace.connect(seller).cancelListing(0n))
                .to.emit(marketplace, "ListingCancelled")
                .withArgs(0n, seller.address);
            expect((await marketplace.getListing(0n)).status).to.equal(2n); // Cancelled
        });

        it("cannot cancel an already cancelled listing (double-cancel reverts)", async function () {
            await marketplace.connect(seller).listCredits(CREDIT_AMOUNT, PRICE_PER_CREDIT);
            await marketplace.connect(seller).cancelListing(0n);
            await expect(
                marketplace.connect(seller).cancelListing(0n)
            ).to.be.revertedWith("Marketplace: listing not open");
        });

        it("non-seller cannot cancel a listing", async function () {
            await marketplace.connect(seller).listCredits(CREDIT_AMOUNT, PRICE_PER_CREDIT);
            await expect(
                marketplace.connect(attacker).cancelListing(0n)
            ).to.be.revertedWith("Marketplace: not the seller");
        });

        // ── purchaseListing ───────────────────────────────────────────────────────

        it("full happy path: buyer purchases, ETH sent to seller, credits moved", async function () {
            await marketplace.connect(seller).listCredits(CREDIT_AMOUNT, PRICE_PER_CREDIT);
            const totalPrice = CREDIT_AMOUNT * PRICE_PER_CREDIT;

            await expect(
                marketplace.connect(buyer).purchaseListing(0n, { value: totalPrice })
            )
                .to.emit(marketplace, "TradeExecuted")
                .withArgs(0n, seller.address, buyer.address, CREDIT_AMOUNT, totalPrice);

            // ERC-1155 balances updated
            expect(await creditToken.balanceOf(seller.address, CREDIT_TOKEN)).to.equal(100n); // 200-100
            expect(await creditToken.balanceOf(buyer.address, CREDIT_TOKEN)).to.equal(100n); // 0+100

            // Listing marked Fulfilled
            expect((await marketplace.getListing(0n)).status).to.equal(1n);
        });

        it("buyer auto-offsets debt without double-counting when buyer had debt", async function () {
            // Buyer is a net emitter with 50 debt
            await creditToken.connect(backend).recordDebt(buyer.address, 50n, "factory");
            expect(await creditToken.netCredits(buyer.address)).to.equal(-50n);

            await marketplace.connect(seller).listCredits(CREDIT_AMOUNT, PRICE_PER_CREDIT);
            const totalPrice = CREDIT_AMOUNT * PRICE_PER_CREDIT;

            await expect(marketplace.connect(buyer).purchaseListing(0n, { value: totalPrice }))
                .to.emit(creditToken, "CreditsRetired")
                .withArgs(buyer.address, 50n)
                .and.to.emit(creditToken, "DebtCleared")
                .withArgs(buyer.address, 50n)
                .and.to.emit(creditToken, "BalanceUpdated")
                .withArgs(seller.address, buyer.address, 100n, 100n, 50n)
                .and.to.emit(marketplace, "AutoOffsetApplied")
                .withArgs(buyer.address, 50n);

            // Auto-offset: buyer had 50 DEBT, purchased 100 CREDIT.
            // 50 CREDIT retired against 50 DEBT; remaining 50 CREDIT transferred to buyer.
            // Seller loses all 100 CREDIT (200 -> 100); buyer ends with 50 CREDIT, 0 DEBT -> netCredits = +50.
            expect(await creditToken.balanceOf(seller.address, CREDIT_TOKEN)).to.equal(100n);
            expect(await creditToken.balanceOf(buyer.address, CREDIT_TOKEN)).to.equal(50n);
            expect(await creditToken.balanceOf(buyer.address, DEBT_TOKEN)).to.equal(0n);
            expect(await creditToken.netCredits(buyer.address)).to.equal(50n);
        });

        it("buyer with debt larger than purchase retires all purchased credits and reduces remaining debt", async function () {
            // Buyer has 150 debt, buys 100 credits -> 0 credits, 50 debt, netCredits = -50
            await creditToken.connect(backend).recordDebt(buyer.address, 150n, "heavy factory");
            expect(await creditToken.netCredits(buyer.address)).to.equal(-150n);

            await marketplace.connect(seller).listCredits(CREDIT_AMOUNT, PRICE_PER_CREDIT);
            const totalPrice = CREDIT_AMOUNT * PRICE_PER_CREDIT;

            await expect(marketplace.connect(buyer).purchaseListing(0n, { value: totalPrice }))
                .to.emit(creditToken, "CreditsRetired")
                .withArgs(buyer.address, 100n)
                .and.to.emit(creditToken, "DebtCleared")
                .withArgs(buyer.address, 100n)
                .and.to.emit(creditToken, "BalanceUpdated")
                .withArgs(seller.address, buyer.address, 100n, 100n, 0n);

            expect(await creditToken.balanceOf(seller.address, CREDIT_TOKEN)).to.equal(100n);
            expect(await creditToken.balanceOf(buyer.address, CREDIT_TOKEN)).to.equal(0n);
            expect(await creditToken.balanceOf(buyer.address, DEBT_TOKEN)).to.equal(50n);
            expect(await creditToken.netCredits(buyer.address)).to.equal(-50n);
        });

        it("post-listing debt gain by seller prevents purchaseListing", async function () {
            await marketplace.connect(seller).listCredits(CREDIT_AMOUNT, PRICE_PER_CREDIT);
            const totalPrice = CREDIT_AMOUNT * PRICE_PER_CREDIT;

            // Seller had 200 credits and 100 locked; gaining 150 debt drops net to 50 < 100 locked
            await creditToken.connect(backend).recordDebt(seller.address, 150n, "post-listing emission");

            await expect(
                marketplace.connect(buyer).purchaseListing(0n, { value: totalPrice })
            ).to.be.revertedWith("Marketplace: seller net position degraded since listing (debt gained)");
        });

        it("should revert purchase with incorrect ETH", async function () {
            await marketplace.connect(seller).listCredits(CREDIT_AMOUNT, PRICE_PER_CREDIT);
            await expect(
                marketplace.connect(buyer).purchaseListing(0n, { value: ethers.parseEther("0.5") })
            ).to.be.revertedWith("Marketplace: incorrect ETH amount");
        });

        it("seller cannot buy their own listing", async function () {
            await marketplace.connect(seller).listCredits(CREDIT_AMOUNT, PRICE_PER_CREDIT);
            const totalPrice = CREDIT_AMOUNT * PRICE_PER_CREDIT;
            await expect(
                marketplace.connect(seller).purchaseListing(0n, { value: totalPrice })
            ).to.be.revertedWith("Marketplace: seller cannot be buyer");
        });

        it("cannot purchase a fulfilled listing twice", async function () {
            await marketplace.connect(seller).listCredits(CREDIT_AMOUNT, PRICE_PER_CREDIT);
            const totalPrice = CREDIT_AMOUNT * PRICE_PER_CREDIT;
            await marketplace.connect(buyer).purchaseListing(0n, { value: totalPrice });
            await expect(
                marketplace.connect(buyer).purchaseListing(0n, { value: totalPrice })
            ).to.be.revertedWith("Marketplace: listing not open");
        });

        it("ETH is transferred to seller, not left in marketplace", async function () {
            await marketplace.connect(seller).listCredits(CREDIT_AMOUNT, PRICE_PER_CREDIT);
            const totalPrice = CREDIT_AMOUNT * PRICE_PER_CREDIT;

            const sellerBefore = await ethers.provider.getBalance(seller.address);
            await marketplace.connect(buyer).purchaseListing(0n, { value: totalPrice });
            const sellerAfter = await ethers.provider.getBalance(seller.address);

            expect(sellerAfter - sellerBefore).to.equal(totalPrice);
            // Marketplace holds no ETH
            expect(
                await ethers.provider.getBalance(await marketplace.getAddress())
            ).to.equal(0n);
        });

        it("getListings returns correct paginated range", async function () {
            await marketplace.connect(seller).listCredits(10n, PRICE_PER_CREDIT);
            await marketplace.connect(seller).listCredits(20n, PRICE_PER_CREDIT);
            await marketplace.connect(seller).listCredits(30n, PRICE_PER_CREDIT);
            const result = await marketplace.getListings(0n, 3n);
            expect(result.length).to.equal(3);
            expect(result[1].amount).to.equal(20n);
        });
    });
});
