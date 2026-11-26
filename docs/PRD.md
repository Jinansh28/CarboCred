# CarboCred — Product Requirements Document (PRD)

> **Document Status:** Baseline Audit & Target Specification  
> **Repository:** `CarboCred`  
> **Conventions:** Every capability is tagged with its verified implementation status in the current codebase:
> - **`[Implemented]`** — Working end-to-end in existing source files (subject to noted bugs/gaps).
> - **`[Partially Implemented]`** — UI or API exists, but core logic, persistence, or integration is incomplete/broken.
> - **`[Mocked / Simulated]`** — Uses hardcoded defaults or synthetic calculations instead of real data.
> - **`[Not Implemented]`** — Documented or implied, but absent from code.
> - **`[Proposed]`** — Recommended product/engineering enhancement for future milestones.

---

## 1. Project Overview

CarboCred is a full-stack, Ethereum-anchored carbon accounting and peer-to-peer offset marketplace built around an ERC-1155 dual-token model (`CREDIT_TOKEN` ID `0` and soulbound `DEBT_TOKEN` ID `1`), an Express + MongoDB verification/identity backend, and a React + Vite Web3 frontend. Entities report carbon emissions and green reduction activities, undergo administrative audit before on-chain minting, trade surplus credits for ETH on a decentralized orderbook, and expose a read-only public emissions ledger and QR transaction verification flow.

---

## 2. Problem Statement

Small-to-mid-sized enterprises (SMEs) and sustainability-focused organizations face three practical barriers in voluntary carbon accounting and offsetting:

1. **Fragmented accountability:** Carbon reductions and emission liabilities are commonly tracked in siloed spreadsheets without verifiable, tamper-evident settlement between counterparties.
2. **Double-selling & unbacked offsets:** Without protocol-level constraints, an entity holding gross emissions debt could sell green certificates while remaining a net polluter.
3. **Opaque verification:** Third parties (regulators, customers, auditors) lack an accessible way to inspect net emissions positions and verify offset purchase proofs without privileged database access.

CarboCred addresses this by separating tradeable offset credits (`CREDIT_TOKEN`) from non-transferable liabilities (`DEBT_TOKEN`) on-chain, enforcing a net-position gate (`credits - debt`) before listing credits for sale, routing self-reported claims through an admin verification queue, and offering public read-only verification.

---

## 3. Product Vision

Provide a focused, auditable, solo-maintainable carbon ledger and marketplace where:
- Every emission claim and reduction claim is backed by verifiable evidence and atomic administrative approval before on-chain issuance.
- Net-emitter sellers cannot dump credits on the market while carrying unpaid emission debt.
- Buyers carrying debt automatically retire debt against purchased credits using mathematically sound 1:1 offset accounting.
- Public stakeholders and auditors can inspect entity standings and verify individual offset transactions with zero wallet setup or database trust.

---

## 4. Target Audience

- **Primary Users:** Sustainability managers / operators at SMEs, renewable micro-generators, and carbon-emitting facilities participating in a closed or consortium voluntary offset program.
- **Platform Operators / Verifiers:** Government or consortium compliance admins reviewing submitted emission/reduction claims before minting tokens.
- **External Stakeholders:** Supply-chain partners, customers, and public auditors verifying offset receipts and organizational net-zero standing.

---

## 5. User Personas

| Persona | Role | Primary Goal | Key Pain Point Today |
|---|---|---|---|
| **Maya — Solar Micro-Grid Operator** | Net Offset Holder | Convert verified clean energy generation into tradeable credits and sell surplus on the marketplace for ETH. | Needs clear unit standards (kg vs tCO₂e), reliable order creation, and confidence that buyer settlements won't fail silently. |
| **Vikram — Manufacturing Plant Lead** | Net Carbon Emitter | Report industrial emissions accurately, track deficit, purchase offset credits, and retire debt to reach neutral/net-positive status. | Current analytics mix mocked default inputs with live balances (`1000×` unit mismatch) and smart-contract auto-offset over-credits buyer net positions. |
| **Dr. Rao — Compliance Auditor** | `ADMIN` Reviewer | Inspect all network entities and approve or reject pending credit/debt submissions with clear supporting evidence. | Current `AdminDashboard` displays `0` for global stats, inverts red/green net labels, lacks evidence attachments, and lacks request submitter identity. |
| **Elena — External ESG Verifier** | Unauthenticated Public Verifier | Check a supplier's offset receipt QR code or browse the public firm leaderboard without installing MetaMask. | Current QR verifier confirms only that *some* Ethereum tx mined—it does not verify the CarboCred contract, event type, or credit amount. |

---

## 6. User Needs & Pain Points

1. **Trustworthy Onboarding & Identity:** Businesses need wallet-linked identity profiles that cannot be overwritten by unrelated third parties (`POST /entity/profile` is currently unauthenticated).
2. **Consistent Units & Accurate Analytics:** Users need one canonical unit across calculator, smart contract, and analytics (currently `carbonCalculator.js` uses kg while `carbonAnalyticsEngine.js` assumes tonnes).
3. **Verifiable Claims:** Admins need submitted claims tied to the authenticated submitter, supporting notes/documents, and reliable one-click minting without race conditions.
4. **Honest Transaction History:** Users need an accurate ledger of mints, debts, trades, and retirements without duplicated rows from overlapping ERC-1155 and custom events.
5. **Working Public Verification:** Verifiers scanning a QR code need decoded proof of *who* bought *how many* credits from *which* CarboCred contract.

---

## 7. Product Goals

| Goal ID | Goal | Measurable Outcome |
|---|---|---|
| **G1** | Eliminate unauthorized token minting & identity tampering | 100% of mint/debt/clear actions require authenticated admin approval or verified wallet signatures; legacy open endpoints removed. |
| **G2** | Ensure mathematically sound carbon accounting | Auto-offset burns equal `CREDIT_TOKEN` and `DEBT_TOKEN` (1:1); units consistent across calculator, chain, and analytics. |
| **G3** | Deliver complete, bug-free core user workflows | Auth, onboarding, claim submission, admin review, marketplace trade, history, analytics, and QR verification all work accurately without console/lint errors. |
| **G4** | Replace simulated/broken views with real indexed data | Remove mocked 6-month chart noise and arbitrary 50-event stat caps; serve accurate historical trends and global totals. |
| **G5** | Establish production-grade engineering hygiene | Automated test suites across contracts, backend, and frontend; CI checks; clean container/deployment configs with zero committed secrets. |

---

## 8. Non-Goals

To keep scope focused and solo-maintainable, CarboCred explicitly excludes:
- **Multi-chain bridging / L2 cross-chain messaging:** Single EVM network deployment (Hardhat local / Sepolia testnet) is sufficient.
- **Full KYC/AML legal compliance engine or fiat payment gateways (Stripe/bank settlement):** Settlement remains native ETH on EVM.
- **IoT hardware telemetry ingestion or satellite MRV pipelines:** Evidence attachment / structured claim metadata is sufficient; automated physical sensor validation is out of scope.
- **AMM / DEX liquidity pools or fractionalized order matching:** Fixed-price discrete P2P listings (`CarbonMarketplace`) fit carbon batch trading better and avoid unnecessary DeFi complexity.
- **Microservices, Kubernetes, Kafka, or Redis:** A modular monolith Express backend + MongoDB + EVM RPC meets all scalability requirements.

---

## 9. Core User Journeys

### Journey 1: Account Registration, Wallet Connection & Business Onboarding
- **Current Flow (`[Implemented]` with gaps):** User signs up (`POST /auth/register`) or logs in (`POST /auth/login`) -> connects MetaMask (`App.jsx`) -> `useEntityProfile` hashes wallet address and queries `GET /entity/profile/:accountId` -> if missing, `BusinessOnboardingModal` prompts for `businessName` and calls `POST /entity/profile` (currently unauthenticated).
- **Target Flow (`[Proposed]`):** User links and verifies wallet ownership via EIP-191 personal signature (`POST /entity/profile` requires JWT + wallet signature; `User` record binds `walletAddress`).

### Journey 2: Activity Calculation, Claim Submission & Admin Minting
- **Current Flow (`[Partially Implemented]`):** User enters emissions/reductions in `MarketplacePage` -> `useCarbonAward` submits `POST /api/requests` (`CREDIT` and/or `DEBT`) -> Admin logs into `AdminDashboard` -> clicks `Approve & Mint` -> `POST /api/requests/:id/approve` mints on-chain via `signer.js` -> `listener.js` relays event via WebSocket to `useLiveFeed`. *(Gap: unauthenticated `/award`, `/debt`, `/clear-debt` bypass this flow completely; non-atomic approve allows double-minting; `App.jsx` polls balance after 3s immediately upon queue submission).*
- **Target Flow (`[Proposed]`):** Legacy direct routes removed; `POST /api/requests` binds authenticated user + optional supporting reference/evidence URL; atomic state transition (`PENDING` -> `PROCESSING` -> `APPROVED`) guarantees at-most-once minting; user sees a `"My Requests"` status tracker (`PENDING` / `APPROVED` / `REJECTED` + tx link).

### Journey 3: Marketplace Listing, Purchase & Auto-Offset
- **Current Flow (`[Implemented]` with critical accounting bug):** Seller with positive `availableNetCredits` lists `CREDIT_TOKEN` at `pricePerCredit` ETH -> Buyer purchases listing -> `CarbonMarketplace.purchaseListing` forwards ETH to seller and calls `settleTransferWithAutoOffset` -> *(Bug: buyer keeps all `CREDIT_TOKEN`s AND gets `DEBT_TOKEN`s burned without burning equivalent `CREDIT_TOKEN`s; `MarketplacePage` colors positive net red).*
- **Target Flow (`[Proposed]`):** `settleTransferWithAutoOffset` transfers `amount` credits, computes `offsetAmount = min(buyerDebt, amount)`, burns `offsetAmount` of BOTH `DEBT_TOKEN` and `CREDIT_TOKEN`, and emits accurate events. Frontend disables invalid listings using `availableNetCredits` and awaits tx confirmation before clearing forms.

### Journey 4: Receipt QR Generation & Public Verification
- **Current Flow (`[Partially Implemented]`):** After purchase, `PurchaseSuccess` renders `TransactionQR` (`{ type: "CARBOCRED_TX", txHash }`). Verifier navigates to `VerifyTransaction`, uploads QR image (`QRScanner` via `jsqr`) or pastes hash -> `useTxVerification` checks receipt existence and `receipt.from`. *(Gap: does not verify contract address or decode events; `receipt.from` is ignored for marketplace/mint semantics).*
- **Target Flow (`[Proposed]`):** `VerifyTransaction` verifies `receipt.to` matches `CarbonMarketplace` or `CarbonCreditToken`, decodes `TradeExecuted`, `CreditsAwarded`, `DebtRecorded`, and `DebtCleared` logs, and displays exact token quantities, seller, buyer, and timestamp—publicly accessible even without logging in.

### Journey 5: Public Transparency & Business Analytics
- **Current Flow (`[Partially Implemented]` / `[Mocked]`):** `PublicDashboard` (`/public-dashboard.html`) scans all chain logs via `viem` and joins hashed profiles (`usePublicCarbonData`). `BusinessAnalytics` renders `CarbonImpactDashboard` using hardcoded `DEFAULT_INPUTS` and a synthetic 6-month noise curve in `CarbonTrendChart`.
- **Target Flow (`[Proposed]`):** Public dashboard and analytics fetch pre-indexed historical metrics and block-synced summaries from backend API (with optional client-side RPC cross-verification), separating real historical on-chain balances from an explicitly labeled *"What-If Simulator"* mode.

---

## 10. Functional Requirements

| Req ID | Requirement | Status | Source / Target Location |
|---|---|---|---|
| **FR-01** | Dual ERC-1155 tokens: transferable `CREDIT_TOKEN` (ID 0) and soulbound `DEBT_TOKEN` (ID 1) blocking non-mint/burn transfers | `[Implemented]` | `contracts/CarbonCreditToken.sol` |
| **FR-02** | Net position calculation `credits - debt` and `getPosition()` view | `[Implemented]` | `contracts/CarbonCreditToken.sol` |
| **FR-03** | Double-listing lock (`lockedCredits`) and purchase-time net re-check | `[Implemented]` | `contracts/CarbonMarketplace.sol` |
| **FR-04** | Auto-offset on purchase burning `DEBT_TOKEN` AND equivalent `CREDIT_TOKEN` | `[Broken]` (burns debt only) | `contracts/CarbonCreditToken.sol#L214-L250` |
| **FR-05** | Direct self-retirement of `CREDIT_TOKEN` by holder (and matching event) | `[Not Implemented]` (backend-only `retireCredits`, no event/route) | `contracts/CarbonCreditToken.sol#L151-L157` |
| **FR-06** | Email/password registration & login issuing 7d JWT + `/auth/me` hydration | `[Implemented]` | `backend/src/routes/auth.routes.js`, `AuthContext.jsx` |
| **FR-07** | Secure admin provisioning (remove static leaked `ADMIN_SEED_KEY`, bind single bootstrap or CLI seed) | `[Partially Implemented]` (insecure leaked seed key) | `backend/src/routes/auth.routes.js`, `start.ps1` |
| **FR-08** | Wallet-ownership proof (EIP-191 signature) before binding wallet or modifying `EntityProfile` | `[Not Implemented]` | `backend/src/controllers/entityProfile.controller.js` |
| **FR-09** | Pending `CreditRequest` submission, admin queue listing, approve & reject endpoints | `[Implemented]` (non-atomic approve race condition) | `backend/src/routes/creditRequest.routes.js` |
| **FR-10** | User request history & status view (`PENDING` / `APPROVED` / `REJECTED` + `txHash`) | `[Not Implemented]` | `frontend/src/pages/` |
| **FR-11** | Removal/lockdown of unauthenticated `/award`, `/debt`, `/clear-debt` backdoors | `[Broken]` (open unauthenticated routes) | `backend/index.js#L139-L200` |
| **FR-12** | Real-time WebSocket event broadcast (`listener.js` -> `ws` -> `useLiveFeed`) | `[Implemented]` (no reconnect, missing `AutoOffsetApplied`, broken UI formatting) | `backend/listener.js`, `frontend/src/hooks/useLiveFeed.js` |
| **FR-13** | Carbon calculator for emissions & reductions with consistent canonical units | `[Partially Implemented]` (kg vs tCO₂e mismatch across modules) | `carbonCalculator.js`, `carbonAnalyticsEngine.js` |
| **FR-14** | Marketplace browse, list, buy, cancel flows with proper async tx receipt handling | `[Partially Implemented]` (no receipt await before clearing form, ignores `lockedCredits`) | `MarketplacePage.jsx`, `App.jsx`, `useMarketplace.js` |
| **FR-15** | User transaction history deduplicating overlapping ERC-1155 & custom logs | `[Broken]` (duplicates every mint/debt/clear/trade) | `useUserTransactions.js`, `transactionParser.js` |
| **FR-16** | Business analytics charts backed by real historical on-chain events | `[Mocked / Simulated]` (`DEFAULT_INPUTS` + synthetic 6-month noise) | `useCarbonAnalytics.js`, `CarbonTrendChart.jsx` |
| **FR-17** | QR generation on purchase & contract-aware QR/hash verification | `[Partially Implemented]` (verifies tx existence only, not contract/events; hidden behind login) | `PurchaseSuccess.jsx`, `VerifyTransaction.jsx`, `useTxVerification.js` |
| **FR-18** | Admin dashboard network overview + pending validation queue | `[Broken]` (4 global stat keys undefined -> always 0; inverted net colors/labels) | `frontend/src/pages/AdminDashboard.jsx` |
| **FR-19** | Public read-only emissions dashboard without login or wallet | `[Implemented]` (undercounts global totals past 50 events; `Date.now()` render bug) | `PublicDashboard.jsx`, `usePublicCarbonData.js`, `blockchainReader.js` |
| **FR-20** | Partial listing fills & listing price/amount validation | `[Proposed]` | `contracts/CarbonMarketplace.sol` |

---

## 11. Non-Functional Requirements

| Category | Current State | Target Requirement |
|---|---|---|
| **Security** | Open `/award`, `/debt`, `/clear-debt` endpoints; secrets committed in `start.ps1`; unauthenticated profile overwrites; wildcard CORS; no rate limiting; `npm audit` critical CVEs in `mongoose` & `proxy-addr`. | Zero committed secrets; all privileged mutations authenticated, authorized, rate-limited, and signature/ownership-bound; Helmet headers + strict CORS allowlist; zero high/critical production CVEs. |
| **Data Integrity & Concurrency** | Non-atomic check-then-act in `POST /api/requests/:id/approve`; double-crediting bug in `settleTransferWithAutoOffset`. | Atomic `PENDING -> PROCESSING -> APPROVED` DB transitions with idempotency keys; exact 1:1 credit+debt retirement math verified by invariant unit tests. |
| **Performance** | `getListings(0, nextId)` & `getLogs(0..latest)` scan linearly O(N); Vite main bundle `747.81 kB` (>500 kB warning) + external Tailwind CDN script. | Indexed DB event mirror / block-checkpointed sync; cursor pagination; route-level `React.lazy()` splitting keeping initial JS chunk < 250 kB gzipped; remove Tailwind CDN. |
| **Reliability** | `listener.js` drops permanently on WSS disconnect; `mongoose.connect` failure is swallowed silently; `App.jsx` uses arbitrary `setTimeout(..., 3000)`. | Fail-fast env & DB startup validation; exponential-backoff WSS reconnect + missed-block catch-up; UI waits for `waitForTransactionReceipt`. |
| **Maintainability & Code Quality** | 0 backend tests; 0 frontend tests; 29 ESLint errors; infinite `carbocred: "file:.."` symlink loop; stale Next.js docs/files. | Passing ESLint & Vitest/Node tests in CI; >80% line coverage on critical backend/contract/utility logic; accurate documentation. |
| **Usability & Accessibility** | Mixed Tailwind CDN + inline CSS styles + custom CSS; light/dark theme incomplete on Tailwind/inline-styled pages; network links hardcoded to Sepolia Etherscan. | Consistent CSS design system, chain-aware explorer links, explicit loading/empty/error states, clear feedback after claim submission. |

---

## 12. Feature Specifications (Core Modules)

### 12.1 Smart Contract Registry & Marketplace (`contracts/`)
- **Current:** ERC-1155 `CarbonCreditToken` + `CarbonMarketplace` enforcing soulbound debt, `lockedCredits`, purchase-time net re-check, and CEI ETH forwarding.
- **Required Fix:** Fix `settleTransferWithAutoOffset` to burn `debtBurned` of `CREDIT_TOKEN` alongside `DEBT_TOKEN`; add public `retireCredits(uint256 amount)` (with `CreditsRetired` event) so holders can self-retire surplus credits against debt; remove unused `Ownable` inheritance on `CarbonMarketplace` (or add pause/emergency guard if justified).

### 12.2 Authentication & Identity (`backend/src/routes/auth.routes.js`, `entityProfile.routes.js`)
- **Current:** Email + bcrypt password + 7-day HS256 JWT; separate hashed wallet `EntityProfile`.
- **Required Fix:** Bind optional/primary `walletAddress` to `User` via EIP-191 signature challenge (`nonce`); require `requireAuth` + wallet ownership verification on `POST /entity/profile`; replace `ADMIN_SEED_KEY` runtime registration in public signup with a server-side admin seed CLI script.

### 12.3 Claim Verification & Minting Pipeline (`backend/src/routes/creditRequest.routes.js`)
- **Current:** `POST /api/requests` creates `PENDING` `CreditRequest`; admin calls `/approve` or `/reject`.
- **Required Fix:** Add `submittedBy`, `reviewedBy`, `reviewedAt`, `rejectionReason`, `evidenceNote` fields; enforce `status: 'PENDING' -> 'PROCESSING'` atomic lock via `findOneAndUpdate`; add `GET /api/requests/mine` so users track request status; delete unauthenticated `/award`, `/debt`, `/clear-debt`.

### 12.4 Public Verification & Transparency (`VerifyTransaction.jsx`, `PublicDashboard.jsx`)
- **Current:** `PublicDashboard` works unauthenticated; `VerifyTransaction` sits behind `App.jsx` login gate (`if (!user) return <LoginPage />`).
- **Target:** Allow unauthenticated access to `/verify` (via URL route or link from `PublicDashboard`) and decode actual CarboCred contract logs (`CreditsAwarded`, `TradeExecuted`, `DebtCleared`) rather than accepting any random EVM transaction hash.

---

## 13. User Stories

1. **US-01 (Auth & Wallet):** *As a business user*, I want to link my Ethereum wallet using a cryptographic signature so nobody else can submit claims or rename my business profile under my address.
2. **US-02 (Claim Submission):** *As a green producer*, I want to submit my activity metrics with a short description/evidence note and view whether my request is Pending, Approved (with tx link), or Rejected.
3. **US-03 (Admin Audit):** *As an admin*, I want to review pending requests with submitter info, accurate global metrics, and idempotent approval so a double-click never double-mints tokens.
4. **US-04 (Marketplace Trading):** *As a net emitter*, I want to buy credits from open listings and have my `DEBT_TOKEN` automatically retired 1:1 against the credits I bought, accurately updating my net position.
5. **US-05 (Marketplace Safety):** *As a seller*, I want the UI to show my *available* net credits (`net - lockedCredits`) and wait for transaction confirmation so I don't submit doomed listings.
6. **US-06 (Transaction History):** *As a user*, I want each on-chain action (Mint, Debt, Trade, Retire) to appear once in my transaction history with accurate summary totals.
7. **US-07 (QR Verification):** *As an external auditor*, I want to upload/scan a receipt QR code without creating an account and confirm it represents a genuine CarboCred contract transaction with decoded credit amounts.

---

## 14. Acceptance Criteria (Key Fixes & MVP Baseline)

- **AC-01:** Calling `POST /award`, `POST /debt`, or `POST /clear-debt` without admin auth returns `404` (removed) or `401`/`403`.
- **AC-02:** Sending 2 concurrent `POST /api/requests/:id/approve` requests results in exactly 1 on-chain transaction (`200`) and 1 `409 Conflict`.
- **AC-03:** When a buyer with `50 DEBT_TOKEN` purchases `100 CREDIT_TOKEN`, post-trade balances are `50 CREDIT_TOKEN`, `0 DEBT_TOKEN`, and `netCredits == +50`.
- **AC-04:** `AdminDashboard` displays exact matching `totalCreditsIssued`, `totalDebtIssued`, `activeCredits`, `activeDebt`, and colors `netCredits > 0` green (`Net-Positive / Offset Holder`) and `netCredits < 0` red (`Net-Emitter`).
- **AC-05:** `UserTransactions` renders 1 row per transaction (no `TransferSingle` + `CreditsAwarded` duplicates) and summary totals reconcile with `balanceOf(address, 0)` and `balanceOf(address, 1)`.
- **AC-06:** `VerifyTransaction` rejects a valid ETH transfer tx hash that did not interact with `CONTRACT_ADDRESSES.carbonCreditToken` or `CONTRACT_ADDRESSES.marketplace`.

---

## 15. MVP Scope (Production-Minded v1)

To reach a cohesive, trustworthy, resume-ready v1, the MVP must include:
1. Secure auth + wallet binding + removed `/award`, `/debt`, `/clear-debt` backdoors + zero leaked secrets.
2. Fixed `settleTransferWithAutoOffset` 1:1 offset math + self-retirement function.
3. Atomic `CreditRequest` state machine + "My Requests" user status list + fixed `AdminDashboard` stats/labels.
4. Consistent carbon unit standard (`kg CO₂e` or `tCO₂e` end-to-end) + real event-backed analytics (clearly separated from any optional what-if simulator).
5. Deduplicated `UserTransactions` + contract-aware public `VerifyTransaction`.
6. Comprehensive automated tests (Hardhat + Backend API + Frontend unit/component) + ESLint clean + CI pipeline.

---

## 16. Future Feature Scope

- **Backend Blockchain Event Indexer (MongoDB projection):** Sync contract events incrementally from `lastSyncedBlock` so `PublicDashboard`, `AdminDashboard`, `UserTransactions`, and `BusinessAnalytics` query fast indexed endpoints with pagination instead of scanning all blocks from genesis on every page load.
- **Partial Listing Fills & Credit Escrowing:** Allow buyers to purchase `k <= listing.amount` credits from a single listing, and optionally escrow `CREDIT_TOKEN` in `CarbonMarketplace` so direct ERC-1155 transfers cannot desync open listings.
- **Self-Service Debt Retirement UI:** Allow a user who holds both `CREDIT_TOKEN` and `DEBT_TOKEN` (e.g., after receiving credits via transfer or award) to call `retireAndOffsetDebt(amount)` directly on-chain.
- **CSV / PDF Audit Export:** Export verified transaction history and net-zero summary from backend/frontend for compliance reporting.

---

## 17. Prioritization

| Priority | Theme | Summary |
|---|---|---|
| **P0** | Security & Financial/Accounting Integrity | Rotate exposed credentials, delete `start.ps1` secrets, disable unauthenticated `/award`/`/debt`/`/clear-debt`, fix `settleTransferWithAutoOffset` double-counting, fix `approve` race condition, secure `POST /entity/profile`. |
| **P1** | Correctness, Data Integrity & Core UX | Fix `AdminDashboard` undefined keys & inverted signs, fix `UserTransactions` duplicate events, unify units, separate mocked vs real analytics, make `VerifyTransaction` decode CarboCred contract logs, fix ESLint errors, add `"carbocred": "file:.."` removal, add user request status view. |
| **P2** | Engineering Rigor & Scalability | Add backend & frontend automated test suites, add structured logging/validation/rate limiting, build incremental MongoDB event indexer + pagination, fix WebSocket reconnection, add Vite code splitting & remove Tailwind CDN, set up GitHub Actions CI. |
| **P3** | Differentiating Features | Wallet signature linking (SIWE-style), partial listing fills, self-service credit retirement, public `/verify` route without login, Docker Compose dev/prod setup. |
| **P4** | Optional Polish | CSV audit export, vintage/project metadata JSON (`tokenURI`), Sepolia live demo deployment. |

---

## 18. Success Metrics (Target — Not Yet Measured)

> **Note:** No production telemetry or real-user metrics exist today. The metrics below are **target criteria** to validate after implementing P0–P2.

- **Security:** `0` unauthenticated state-mutating endpoints; `0` secrets in Git history/working tree; `0` critical/high production dependency CVEs.
- **Correctness:** `100%` balance reconciliation between indexed history sums and on-chain `getPosition(addr)`; `100%` test pass rate across contracts, backend, and frontend.
- **Performance (measurable locally/staging):** `PublicDashboard` & `UserTransactions` initial load `< 300 ms` via indexed API (vs multi-chunk RPC scan); main Vite JS bundle `< 250 kB` gzipped.
- **Reliability:** Backend recovers automatically from simulated RPC WebSocket drop within `< 10 s` without missing intermediate events.

---

## 19. Risks & Constraints

- **Solo-Developer Maintenance Budget:** Complex infrastructure (e.g., Kafka, The Graph subgraph nodes, microservices) would create excessive operational overhead; an in-process Node event indexer writing to MongoDB is far more realistic.
- **Free-Tier Hosting Limits:** Free-tier MongoDB Atlas + Render/Fly + Sepolia RPC providers enforce rate limits (e.g., `eth_getLogs` block range caps and connection timeouts), making incremental block-checkpoint indexing essential before any public demo.
- **On-Chain Immutability vs Mutable Off-Chain Claims:** Fixing `settleTransferWithAutoOffset` requires redeploying `CarbonCreditToken` (and `CarbonMarketplace` since `creditToken` is `immutable`) on local/testnet chains.
- **Git Secret History:** Because `start.ps1` has already been committed in multiple commits (`9fe6b42`, `d4ec054`, `fc18370`, `c1992e9`), deleting the line from HEAD is insufficient—the MongoDB password, `JWT_SECRET`, and `ADMIN_SEED_KEY` **must be rotated immediately**.

---

## 20. Assumptions Requiring Validation

1. **Emission Factors:** `carbonCalculator.js` uses `0.82 kg CO₂/kWh` (typical India grid factor) and `0.21 kg CO₂/km`, while `treesPlanted` awards `20` credits (`carbonAnalyticsEngine.js` uses `21 kg/tree/year` and `0.344 kg/KL` water). Confirm with domain assumptions whether `1 token = 1 kg CO₂e` or `1 tonne CO₂e` and align all formulas.
2. **Admin Trust Model:** Assumes a single trusted off-chain authority (`ADMIN` role -> `BACKEND_ROLE` signer) is acceptable for claim verification in a consortium/demo setting.
3. **ETH Pricing:** Assumes test ETH on Hardhat/Sepolia is acceptable for P2P settlement without stablecoin (USDC/DAI) support.
4. **Pseudonymity Model:** Assumes hashing `walletAddress` with unsalted SHA-256 (`hashAccountId`) is only meant for casual separation rather than cryptographic privacy, because public addresses on-chain can be re-hashed and matched by anyone.
