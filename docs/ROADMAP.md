# CarboCred — Prioritized Project Improvement Roadmap

> **Ordering Rule:** Tasks are ordered strictly by priority tier (`P0` -> `P4`) and dependency chain. No arbitrary calendar dates are assigned.  
> **Scope Principle:** Recommendations prioritize security, correctness, backend/DB engineering depth, and solo-developer maintainability—explicitly rejecting resume-driven overengineering.

---

## Priority Overview

| Tier | Focus | Summary of Impact |
|---|---|---|
| **P0** | Critical Security & Accounting Integrity | Eliminates live credential leaks, unauthenticated mint backdoors, race-condition double-mints, and smart-contract credit inflation. |
| **P1** | Functional Correctness & Code Hygiene | Fixes broken admin stats/colors, duplicate transaction history, unit mismatches, fake trend charts, shallow QR verification, symlink loop, and 29 ESLint errors. |
| **P2** | Engineering Depth, Testing & Scalability | Adds backend/frontend tests, CI, structured logging, validation/rate-limiting, WSS reconnection, and a MongoDB incremental blockchain event indexer. |
| **P3** | Differentiating Product & System Features | Adds cryptographic wallet linking (EIP-191), self-service credit retirement, partial listing fills, public unauthenticated verification route, and Docker Compose. |
| **P4** | Optional Future Polish | Adds CSV compliance exports, ERC-1155 token metadata JSON, and Sepolia live demonstration deployment. |

---

## P0 — Critical Bugs, Data Loss Risks & Security Issues

### `P0-1`: Rotate Leaked Secrets & Sanitize `start.ps1` + Git Hygiene
- **Reason:** Live MongoDB Atlas credentials, `JWT_SECRET`, and `ADMIN_SEED_KEY` are committed in plaintext in `start.ps1` L98–102; `hardhat_error.txt` and `hh_err.txt` are tracked in Git.
- **Complexity:** `S`
- **Dependencies:** None (immediate first action)
- **Relevant Files:** `start.ps1`, `.gitignore`, `.env.example`, `backend/.env.example`, `hardhat_error.txt`, `hh_err.txt`
- **Acceptance Criteria:**
  - MongoDB Atlas user password, `JWT_SECRET`, and `ADMIN_SEED_KEY` rotated externally.
  - `start.ps1` reads secrets from environment / local `.env` templates or defaults `MONGO_URI` to `mongodb://127.0.0.1:27017/carbocred` with ephemeral random local-only `JWT_SECRET`.
  - Tracked error files (`hardhat_error.txt`, `hh_err.txt`) removed from Git tracking.
- **Testing Requirement:** Run `git grep` / secret pattern check across repo confirming zero credential strings remain; verify fresh local startup with local/configured MongoDB.

### `P0-2`: Remove Unauthenticated Legacy Endpoints (`/award`, `/debt`, `/clear-debt`)
- **Reason:** Anyone can mint infinite credits, grief wallets with soulbound debt, or wipe debt without admin review (`backend/index.js` L139–200).
- **Complexity:** `S`
- **Dependencies:** `P0-1`
- **Relevant Files:** `backend/index.js`, `start.ps1`, `scripts/` (new `scripts/seedLocal.js`)
- **Acceptance Criteria:**
  - `POST /award`, `POST /debt`, and `POST /clear-debt` removed from Express HTTP API (404).
  - Local test credit seeding in `start.ps1` executes `npx hardhat run scripts/seedLocal.js --network localhost` (using Hardhat signer directly on local dev chain) instead of calling an open HTTP route.
- **Testing Requirement:** Automated backend integration test asserting `POST /award`, `POST /debt`, `POST /clear-debt` return `404`.

### `P0-3`: Fix Smart Contract 1:1 Auto-Offset Accounting & Self-Retirement
- **Reason:** `settleTransferWithAutoOffset` (`CarbonCreditToken.sol` L214–250) burns `DEBT_TOKEN` without burning equivalent `CREDIT_TOKEN`, creating phantom net credits; `retireCredits` lacks self-service & custom event.
- **Complexity:** `M`
- **Dependencies:** None (can run parallel with `P0-1`/`P0-2`, redeploy contracts locally afterward)
- **Relevant Files:** `contracts/CarbonCreditToken.sol`, `contracts/CarbonMarketplace.sol`, `test/CarboCred.test.js`
- **Acceptance Criteria:**
  - `settleTransferWithAutoOffset` transfers `amount` `CREDIT_TOKEN` to buyer, computes `debtBurned = min(buyerDebt, amount)`, burns `debtBurned` of BOTH `DEBT_TOKEN` AND `CREDIT_TOKEN` before external/callback edge risk (note `_safeTransferFrom` callback ordering), and emits `DebtCleared` + `CreditsRetired`.
  - Add `retireOwnCredits(uint256 amount)` (callable by any token holder) burning `CREDIT_TOKEN` (and optionally offsetting matching `DEBT_TOKEN`), emitting `CreditsRetired`.
  - Remove unused `Ownable` inheritance from `CarbonMarketplace.sol` (or justify explicitly) and unused `settleTransfer` if superseded.
- **Testing Requirement:** Update and expand `test/CarboCred.test.js` verifying `buyer` with `50` debt buying `100` credits ends with `50` credits, `0` debt, and `netCredits == +50`; verify reentrancy & callback safety during `onERC1155Received`.

### `P0-4`: Make `CreditRequest` Approval Atomic & Fix Input/Cast Validation
- **Reason:** Non-atomic read-then-mint in `POST /api/requests/:id/approve` enables race-condition double-minting and inconsistent DB state if DB save fails post-tx (`creditRequest.routes.js` L74–101); `NaN` & malformed ObjectIds cause 500s.
- **Complexity:** `M`
- **Dependencies:** `P0-2`
- **Relevant Files:** `backend/src/models/CreditRequest.js`, `backend/src/routes/creditRequest.routes.js`, `backend/signer.js`
- **Acceptance Criteria:**
  - `CreditRequest.status` includes `'PROCESSING'`.
  - `approve` atomically locks via `findOneAndUpdate({ _id, status: 'PENDING' }, { $set: { status: 'PROCESSING', reviewedBy } })`; concurrent calls receive `409 Conflict`.
  - `signer.js` serializes transactions via an in-memory promise/nonce mutex so parallel approvals of *different* requests do not collide on EOA nonces.
  - Invalid `:id` returns `400`; non-integer/non-finite `amount` returns `400`.
- **Testing Requirement:** Integration test firing two concurrent `POST /api/requests/:id/approve` requests verifying exactly 1 signer invocation (`200`) and 1 `409 Conflict`.

### `P0-5`: Protect `POST /entity/profile` & Remove Insecure Self-Service Admin Elevation
- **Reason:** Anyone can overwrite any business profile via `POST /entity/profile`; `ADMIN_SEED_KEY` on public signup exposes admin escalation risk.
- **Complexity:** `M`
- **Dependencies:** `P0-1`
- **Relevant Files:** `backend/src/routes/entityProfile.routes.js`, `backend/src/controllers/entityProfile.controller.js`, `backend/src/routes/auth.routes.js`, `frontend/src/hooks/useEntityProfile.js`, `frontend/src/pages/SignupPage.jsx`
- **Acceptance Criteria:**
  - `POST /entity/profile` requires `requireAuth` AND EIP-191 signature from the wallet (`verifyMessage`) matching `sha256(signer.toLowerCase()) === accountId` (or verified bound `User.walletAddress`).
  - Public `/auth/register` always creates `USER` role; `ADMIN` users are provisioned via a server-side CLI script (`backend/scripts/createAdmin.js`) instead of passing a secret in browser signup.
- **Testing Requirement:** Integration tests verifying unauthenticated/wrong-wallet `POST /entity/profile` returns `401`/`403`, and `/auth/register` ignores `role`/`adminSeedKey` elevation attempts.

---

## P1 — Essential Functionality & Major Quality Problems

### `P1-1`: Remove Broken `"carbocred": "file:.."`, Unused Dependencies & Obsolete Next.js Files
- **Reason:** `"carbocred": "file:.."` creates an infinite recursive symlink loop; `@yudiel/react-qr-scanner`, `frontend/next-env.d.ts`, and `backend/src/utils/hashAccountId.js` (unless reused) are dead code; `backend/index.js` imports undefined `getNetCredits`.
- **Complexity:** `S`
- **Dependencies:** None
- **Relevant Files:** `backend/package.json`, `frontend/package.json`, `frontend/next-env.d.ts`, `backend/index.js`, `package.json`, `.env.example`, `backend/.env.example`, `frontend/.env.example` (new)
- **Acceptance Criteria:**
  - Remove `"carbocred": "file:.."` and regenerate clean `package-lock.json` in backend & frontend.
  - Uninstall `@yudiel/react-qr-scanner`; delete `frontend/next-env.d.ts`.
  - Fix root `package.json` `"test"` script to `"npx hardhat test"`.
  - Fix `.env.example`, `backend/.env.example`, and create `frontend/.env.example`.
- **Testing Requirement:** Recursive filesystem scan completes with zero symlink errors; `npm install` + `npx hardhat test` + `frontend npm run build` pass.

### `P1-2`: Fix `AdminDashboard` Global Stats Keys, Net Position Signs & Render Side Effects
- **Reason:** `AdminDashboard.jsx` reads undefined `globalStats` keys (`0` on 3 cards), inverts positive/negative net colors/labels (`AdminDashboard.jsx` L149, `MarketplacePage.jsx` L188/232), and triggers `fetchPending()` during render (`AdminDashboard.jsx` L235).
- **Complexity:** `S`
- **Dependencies:** None
- **Relevant Files:** `frontend/src/pages/AdminDashboard.jsx`, `frontend/src/pages/MarketplacePage.jsx`, `frontend/src/utils/blockchainReader.js`, `frontend/src/hooks/usePublicCarbonData.js`
- **Acceptance Criteria:**
  - `AdminDashboard` displays `globalStats.firmCount`, `activeCredits`, `activeDebt`, and `activeCredits - activeDebt` (net).
  - Canonical sign convention enforced everywhere: `net > 0` = green (`Net-Positive / Offset Holder`), `net < 0` = red (`Net-Emitter`).
  - `fetchPending()` moved into `useEffect`; `computeGlobalStats` counts all historical events rather than the 50-item `recentEvents` slice.
- **Testing Requirement:** Component tests verifying `AdminDashboard` renders non-zero stats and correct green/red badges for `+100` vs `-50`.

### `P1-3`: Fix `UserTransactions` Event Duplication & Summary Totals
- **Reason:** Querying both `TransferSingle` and custom events duplicates every mint/debt/retirement row and corrupts summary cards (`useUserTransactions.js`, `transactionParser.js`).
- **Complexity:** `M`
- **Dependencies:** `P0-3`
- **Relevant Files:** `frontend/src/hooks/useUserTransactions.js`, `frontend/src/utils/transactionParser.js`, `frontend/src/components/UserTransactionTable.jsx`
- **Acceptance Criteria:**
  - Each on-chain tx yields 1 logical record (`CreditsAwarded`, `DebtRecorded`, `DebtCleared`, `CreditsRetired`, `BalanceUpdated`, or direct P2P `TransferSingle` where `operator !== marketplace && from !== 0 && to !== 0`).
  - Summary cards compute accurate `totalMinted`, `totalDebt`, `totalRetired`, `totalBought`, `totalSold` matching on-chain balances.
  - Explorer links dynamically match `VITE_CHAIN_ID` (hide or disable Etherscan URL on Hardhat `31337`; use `sepolia.etherscan.io` on `11155111`).
- **Testing Requirement:** Unit tests for `transactionParser.js` using realistic multi-log transaction fixtures (award, debt, auto-offset purchase, P2P transfer) asserting zero duplicates.

### `P1-4`: Unify Carbon Units (`kg CO₂e` vs `tCO₂e`) & Eliminate Fabricated Trend Data
- **Reason:** `carbonCalculator.js` mints integer kg while `carbonAnalyticsEngine.js` assumes `1 token = 1 tCO₂e`; `CarbonTrendChart.jsx` displays fake noise `1 + i*0.05`.
- **Complexity:** `M`
- **Dependencies:** `P1-3`
- **Relevant Files:** `frontend/src/lib/carbonCalculator.js`, `frontend/src/utils/carbonAnalyticsEngine.js`, `frontend/src/hooks/useCarbonAnalytics.js`, `frontend/src/components/CarbonTrendChart.jsx`, `frontend/src/components/CarbonImpactDashboard.jsx`, `frontend/src/pages/BusinessAnalytics.jsx`
- **Acceptance Criteria:**
  - Standardize one canonical unit across calculator, contracts, and analytics (recommended: `1 token = 1 kg CO₂e` so integer ERC-1155 granularity works without decimals, or convert consistently everywhere).
  - `CarbonTrendChart` renders real time-bucketed cumulative credits/debt/net series from on-chain events.
  - Infrastructure editor in `CarbonImpactDashboard` starts empty/user-configured and is explicitly badged **"What-If Scenario Simulator"** rather than presenting hardcoded defaults as actual emissions.
- **Testing Requirement:** Unit tests for `carbonCalculator` & `carbonAnalyticsEngine` verifying unit consistency and time-series aggregation.

### `P1-5`: Make `VerifyTransaction` Contract-Aware & Decode CarboCred Events
- **Reason:** `useTxVerification` accepts any random Ethereum tx hash as `"Verified Successful"` and displays backend signer address instead of firm/credit details.
- **Complexity:** `M`
- **Dependencies:** `P1-3`
- **Relevant Files:** `frontend/src/hooks/useTxVerification.js`, `frontend/src/pages/VerifyTransaction.jsx`, `frontend/src/lib/contracts.js`
- **Acceptance Criteria:**
  - Verification fails cleanly if `receipt.to` is neither `CONTRACT_ADDRESSES.carbonCreditToken` nor `CONTRACT_ADDRESSES.marketplace` (or if zero CarboCred logs decoded).
  - Decodes `TradeExecuted`, `CreditsAwarded`, `DebtRecorded`, `DebtCleared`, `CreditsRetired` logs and displays seller/buyer/entity, token amount, and business names.
  - Accessible without logging in (e.g., `/verify` route or tab on `PublicDashboard`).
- **Testing Requirement:** Unit/hook tests mocking `getTransactionReceipt` for valid CarboCred tx, unrelated ETH tx (rejected), reverted tx, and unknown tx hash.

### `P1-6`: Fix Marketplace UX Flows, Chain ID Config & All 29 ESLint Errors
- **Reason:** `App.jsx` hardcodes `hardhat.id`, clears listing forms on reject, omits `lockedCredits` check, `FeedItem` misclassifies events, and `npm run lint` fails with 29 errors.
- **Complexity:** `M`
- **Dependencies:** `P1-1`
- **Relevant Files:** `frontend/src/App.jsx`, `frontend/src/pages/MarketplacePage.jsx`, `frontend/src/pages/PublicDashboard.jsx`, `frontend/src/pages/VerifyTransaction.jsx`, `frontend/src/context/AuthContext.jsx`, `frontend/src/hooks/useMarketplace.js`, `frontend/src/hooks/useTxVerification.js`, `frontend/vite.config.js`, `frontend/eslint.config.js`
- **Acceptance Criteria:**
  - Read `targetChain` dynamically from `VITE_CHAIN_ID` (`31337` -> `hardhat`, `11155111` -> `sepolia`).
  - `MarketplacePage` reads `availableNetCredits(address)`, awaits tx confirmation via `useWaitForTransactionReceipt` / `publicClient`, and refreshes state via React Query invalidation instead of `setTimeout(..., 3000)`.
  - Fix `FeedItem` event formatting (`TradeExecuted`, `DebtCleared`, `BalanceUpdated`) and add `"My Requests"` panel in UI so users track pending/approved/rejected submissions.
  - `cd frontend && npm run lint` passes with **0 errors and 0 warnings**.
- **Testing Requirement:** `npm run lint` exits `0`; `npm run build` succeeds.

---

## P2 — Important Engineering & Product Improvements

### `P2-1`: Backend Validation, Structured Logging, Rate Limiting, Security Headers & Dependency Patches
- **Reason:** Missing `helmet`, wildcard CORS, missing rate limits, inconsistent error shapes, raw `err.message` leaks, unawaited DB connect, missing `SIGINT` shutdown, and `mongoose`/`express`/`ws` CVEs.
- **Complexity:** `M`
- **Dependencies:** `P0-2`, `P0-4`, `P0-5`
- **Relevant Files:** `backend/package.json`, `backend/index.js`, `backend/src/middleware/*`, `backend/src/routes/*`
- **Acceptance Criteria:**
  - Upgrade `mongoose` (`>=9.13.1`), `express` (`4.22.3`), `ws` (`8.23.0`), `vite` (`7.3.8`).
  - Add `helmet`, configurable `CORS_ORIGIN`, `express-rate-limit` on `/auth` and `/api/requests`, `zod` request validation middleware, unified `{ success, data/error }` envelope, `pino` structured JSON logs, startup env/DB fail-fast, `/ready` endpoint, and graceful `SIGINT`/`SIGTERM` cleanup.
- **Testing Requirement:** `npm audit --omit=dev` shows 0 critical/high vulnerabilities in backend; supertest verifies rate-limit 429, CORS headers, and 400 validation envelopes.

### `P2-2`: Comprehensive Backend & Frontend Automated Test Suites + GitHub Actions CI
- **Reason:** 0 backend tests and 0 frontend tests exist; `.agent/workflows/test.md` fails on `cd backend && npm test`.
- **Complexity:** `L`
- **Dependencies:** `P0-3`, `P0-4`, `P1-3`, `P1-6`, `P2-1`
- **Relevant Files:** `backend/package.json`, `backend/tests/*` (new), `frontend/package.json`, `frontend/src/**/*.test.*` (new), `.github/workflows/ci.yml` (new), `.agent/workflows/test.md`
- **Acceptance Criteria:**
  - Backend test suite (`node --test` + `supertest`) passes covering auth, RBAC, atomic approval concurrency, validation, and profile security.
  - Frontend test suite (`vitest` + Testing Library) passes covering calculator, analytics engine, tx parser, and critical UI flows.
  - CI pipeline runs contract tests, backend tests, frontend lint, frontend tests, and frontend build on every push.
- **Testing Requirement:** All CI jobs pass cleanly in a fresh environment.

### `P2-3`: WebSocket Resiliency & MongoDB Incremental Blockchain Event Indexer
- **Reason:** Current browser hooks scan genesis `0..latest` every 30s (`O(N)` RPC amplification) and `listener.js` drops permanently on WSS disconnect; `CarbonMarketplace.getListings(0, total)` scans all listings unboundedly.
- **Complexity:** `L`
- **Dependencies:** `P2-1`, `P2-2`
- **Relevant Files:** `backend/listener.js`, `backend/src/models/ChainEvent.js` (new), `backend/src/models/SyncState.js` (new), `backend/src/services/indexer.js` (new), `backend/src/routes/events.routes.js` (new), `frontend/src/hooks/usePublicCarbonData.js`, `frontend/src/hooks/useUserTransactions.js`, `frontend/src/hooks/useLiveFeed.js`
- **Acceptance Criteria:**
  - Backend persists normalized events idempotently keyed by `(chainId, txHash, logIndex)` using `START_BLOCK` and `SyncState.lastSyncedBlock` (with configurable reorg safety window on non-local chains).
  - Auto-reconnects WSS with exponential backoff and runs catch-up `getLogs` on startup/reconnect.
  - `GET /api/events/global-stats`, `GET /api/events/firms`, and `GET /api/events/history/:address` serve paginated, indexed data in `< 100 ms` locally.
  - `useLiveFeed` adds client-side auto-reconnect with backoff.
- **Testing Requirement:** Unit/integration tests simulating missed blocks on restart and duplicate log replay confirming idempotent storage and exact reconciliation with on-chain balances.

### `P2-4`: Frontend Code Splitting, Tailwind CDN Removal & Unified Styling + Accurate Docs
- **Reason:** Main bundle (`747.81 kB`) triggers Vite size warnings; Tailwind CDN script is unsuitable for production; `README.md` & `DEPLOYMENT.md` still claim Next.js 15.
- **Complexity:** `M`
- **Dependencies:** `P1-6`
- **Relevant Files:** `frontend/index.html`, `frontend/vite.config.js`, `frontend/src/App.jsx`, `frontend/src/pages/PurchaseSuccess.jsx`, `frontend/src/components/QRScanner.jsx`, `frontend/src/components/TransactionQR.jsx`, `README.md`, `DEPLOYMENT.md`
- **Acceptance Criteria:**
  - Remove `<script src="https://cdn.tailwindcss.com">` from `index.html`; style remaining components cleanly with `--obs-*` CSS variables (respecting light/dark theme toggle).
  - Lazy-load `BusinessAnalytics`, `AdminDashboard`, `VerifyTransaction`, and `UserTransactions` + configure Rollup `manualChunks`; main initial chunk `< 250 kB` gzipped.
  - Rewrite `README.md` & `DEPLOYMENT.md` to accurately reflect Vite + React 19, MongoDB, JWT auth, and verified setup commands.
- **Testing Requirement:** `npm run build` completes with zero chunk-size warnings; manual light/dark visual check passes.

---

## P3 — Advanced Differentiating Features

### `P3-1`: Cryptographic Wallet Linking (EIP-191 Challenge-Response) & Public Verification Route
- **Reason:** Connects Web2 email identity (`User`) cleanly to Web3 MetaMask wallet (`walletAddress`) and lets external auditors open `/verify/:txHash` directly from QR codes without logging in.
- **Complexity:** `M`
- **Dependencies:** `P0-5`, `P1-5`
- **Relevant Files:** `backend/src/models/User.js`, `backend/src/routes/auth.routes.js`, `frontend/src/App.jsx`, `frontend/src/utils/qrGenerator.js`
- **Acceptance Criteria:**
  - `GET /auth/nonce` + `POST /auth/link-wallet` binds verified `walletAddress` to `User`.
  - QR code can encode verification URL or JSON payload, and unauthenticated visitors can open `/verify` directly.
- **Testing Requirement:** Integration tests for valid/expired/replayed nonces and invalid signatures.

### `P3-2`: Partial Listing Fills & Self-Service Credit Retirement UI
- **Reason:** Currently buyers must buy 100% of a listing at once, and users holding both credits & debt cannot self-retire credits on-chain without admin intervention.
- **Complexity:** `L`
- **Dependencies:** `P0-3`, `P2-3`
- **Relevant Files:** `contracts/CarbonMarketplace.sol`, `contracts/CarbonCreditToken.sol`, `test/CarboCred.test.js`, `frontend/src/pages/MarketplacePage.jsx`
- **Acceptance Criteria:**
  - `purchasePartial(listingId, buyAmount)` decrements `listing.amount` and `lockedCredits[seller]` until remaining amount hits `0` (`Fulfilled`).
  - UI "Retire Credits / Offset Debt" action invokes `retireOwnCredits` directly from user's wallet.
- **Testing Requirement:** Hardhat tests covering partial purchases, final fill transition, overpayment/overbuy reverts, and direct self-retirement.

### `P3-3`: Reproducible Containerized Dev/Prod Setup (`Dockerfile` + `docker-compose.yml`)
- **Reason:** Replaces Windows-only `start.ps1` dependency with OS-agnostic reproducible setup for evaluators and deployment.
- **Complexity:** `M`
- **Dependencies:** `P2-1`
- **Relevant Files:** `backend/Dockerfile` (new), `frontend/Dockerfile` (new), `docker-compose.yml` (new)
- **Acceptance Criteria:** `docker compose up` starts MongoDB, Hardhat node (optional profile), backend API, and frontend cleanly from `.env.example` defaults.
- **Testing Requirement:** Fresh `docker compose build && docker compose up` smoke test verifying `/health` and `/ready`.

---

## P4 — Optional Future Ideas

- **`P4-1`: CSV Audit Trail Export (`S`):** Allow firms and admins to download filtered, verified transaction ledgers as CSV from indexed backend data (`GET /api/events/export`).
- **`P4-2`: ERC-1155 Vintage / Project Metadata Endpoint (`S`):** Serve valid ERC-1155 metadata JSON at `/meta/{id}.json` matching `CarbonCreditToken`'s `metaURI` constructor argument (`https://carbocred.io/meta/{id}.json`).
- **`P4-3`: Public Sepolia Demo Deployment (`M`):** Deploy fixed contracts to Sepolia testnet (`START_BLOCK` configured), deploy backend to Render/Fly free tier + frontend to Vercel, and publish verification tx links in `README.md`.

---

## Explicitly Rejected / Out-of-Scope Recommendations

| Technology / Feature | Why Rejected for CarboCred |
|---|---|
| **Microservices / Split Auth & Indexer Services** | Unnecessary distributed complexity, deployment cost, and network overhead for a solo-maintained project with <10k RPS; a clean modular monolith handles everything reliably. |
| **Kubernetes / Helm** | Massive operational burden with zero benefit over Docker Compose locally and PaaS/container deployment in staging. |
| **Kafka / RabbitMQ / Redis** | Event throughput (Ethereum block times + SME claim rate) is well within MongoDB + in-process `ChainSyncService` limits; adding Redis or Kafka creates pointless moving parts and free-tier costs. |
| **The Graph Subgraph Node** | Hosting custom Graph nodes is heavy; a 150-line Ethers `getLogs` + MongoDB incremental indexer demonstrates deeper systems engineering fundamentals in interviews. |
| **AI / LLM "Carbon Advisor Chatbot"** | Pure resume buzzword with zero verifiable domain accuracy benefit compared to deterministic calculation and contract auditability. |
| **TypeScript Full Rewrite Now** | Rewriting 40+ JS/JSX files immediately would stall critical security/bug fixes; consider gradual JSDoc/TS migration only *after* P0–P2 ship. |
