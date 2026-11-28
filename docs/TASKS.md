# CarboCred — Independent Implementation Task Checklist

> Follow milestones sequentially. Every task references its source finding (`AUDIT_REPORT.md`) or roadmap item (`ROADMAP.md`), concrete file paths, acceptance criteria, and verification test command.

---

## Milestone 0: Emergency Security & Repository Hygiene (`P0`)

- [x] **M0.1 — Rotate Leaked Credentials & Clean `start.ps1` / Git Junk** *(Refs: C-02, P0-1)*
  - **Steps:**
    1. Rotate MongoDB Atlas DB user password, `JWT_SECRET`, and `ADMIN_SEED_KEY` externally; update local `backend/.env` only.
    2. Edit `start.ps1` (L92–104): remove hardcoded `MONGO_URI`, `JWT_SECRET`, and `ADMIN_SEED_KEY`; read from existing `backend/.env` or fall back to `mongodb://127.0.0.1:27017/carbocred` + random per-run local `JWT_SECRET`.
    3. Remove tracked error dumps `hardhat_error.txt` and `hh_err.txt` (`git rm hardhat_error.txt hh_err.txt`) and add `*_err*.txt` / `*_error.txt` to `.gitignore`.
  - **Acceptance Criteria:** Zero credentials in `start.ps1` or any Git-tracked file.
  - **Verification:** `git diff` + `git status` + grep for `mongodb+srv://` across tracked files returns 0 hits.

- [x] **M0.2 — Remove Unauthenticated `/award`, `/debt`, `/clear-debt` Endpoints** *(Refs: C-01, P0-2)*
  - **Steps:**
    1. Delete `app.post("/award", ...)`, `app.post("/debt", ...)`, and `app.post("/clear-debt", ...)` from `backend/index.js` (L131–200), plus unused `getNetCredits` destructuring on L34.
    2. Create `scripts/seedLocal.js` to mint initial local dev credits to Hardhat Account #0 via Hardhat signer directly.
    3. Update `start.ps1` (L138–149) to run `npx hardhat run scripts/seedLocal.js --network localhost` instead of calling `POST /award`.
  - **Acceptance Criteria:** `POST /award`, `/debt`, and `/clear-debt` return `404`; local seed script succeeds against Hardhat node.
  - **Verification:** Curl or backend integration test confirms `404` on legacy routes; `npx hardhat run scripts/seedLocal.js --network localhost` succeeds.

- [x] **M0.3 — Fix `carbocred: "file:.."` Infinite Symlink Loop & Remove Dead Files/Deps** *(Refs: B-01, P1-1)*
  - **Steps:**
    1. Remove `"carbocred": "file:.."` from `backend/package.json` (L12) and `frontend/package.json` (L15).
    2. Uninstall unused `@yudiel/react-qr-scanner` from `frontend/package.json` (`npm uninstall @yudiel/react-qr-scanner` inside `frontend/`).
    3. Run `npm install` in `backend/` and `frontend/` to update lockfiles and eliminate recursive `node_modules/carbocred/` symlink.
    4. Delete obsolete `frontend/next-env.d.ts` and update root `package.json` `"test"` script to `"npx hardhat test"`.
    5. Fix `.env.example` (replace `ENTITY_REGISTRY_ADDRESS` with `CARBON_CREDIT_TOKEN_ADDRESS` & `BACKEND_WALLET_ADDRESS`), add `MONGO_URI` & `CORS_ORIGIN` to `backend/.env.example`, and create `frontend/.env.example`.
  - **Acceptance Criteria:** No `node_modules/carbocred` symlink exists; `npm test` at root runs Hardhat tests.
  - **Verification:** `Get-ChildItem -Recurse` succeeds without `DirectoryNotFoundException`; root `npm test` passes.

---

## Milestone 1: Smart Contract & Accounting Integrity (`P0`)

- [x] **M1.1 — Fix `settleTransferWithAutoOffset` Double-Counting Bug** *(Refs: C-03, P-03, P0-3)*
  - **Steps:**
    1. In `contracts/CarbonCreditToken.sol` (L214–250):
       - Compute `debtBurned = buyerDebt < amount ? buyerDebt : amount`.
       - Before or after transferring `amount - debtBurned` to `buyer`: if `debtBurned > 0`, burn `debtBurned` of `CREDIT_TOKEN` (from `seller` directly or transfer then burn *before* `onERC1155Received` callback—best: transfer `amount - debtBurned` from `seller` to `buyer` if `> 0`, burn `debtBurned` from `seller`'s `CREDIT_TOKEN`, and burn `debtBurned` from `buyer`'s `DEBT_TOKEN`! Verify `BalanceUpdated` & `CreditsRetired` events reflect net outcome cleanly).
       - Add `event CreditsRetired(address indexed entity, uint256 amount);`.
    2. Add `function retireOwnCredits(uint256 amount) external nonReentrant` allowing any entity to burn `CREDIT_TOKEN` (and automatically burn `min(debt, amount)` of `DEBT_TOKEN`), emitting `CreditsRetired` and `DebtCleared`.
    3. Remove unused `Ownable` inheritance from `contracts/CarbonMarketplace.sol` (L4, L43, L113) and validate `amount * pricePerCredit` at `listCredits` time (implicitly checked by Solidity 0.8 overflow check if computed).
  - **Acceptance Criteria:** Buyer with `50` debt purchasing `100` credits ends with `50` credits, `0` debt, `netCredits == +50`.
  - **Verification:** Update `test/CarboCred.test.js` L249–264 and add tests for `retireOwnCredits`, zero-price listing revert, double-cancel revert, and post-listing debt gain preventing purchase -> `npx hardhat test` passes 100%.

---

## Milestone 2: Backend Hardening, Atomic Approvals & API Hygiene (`P0`/`P2`)

- [x] **M2.1 — Atomic `CreditRequest` Approval & Signer Nonce Serialization** *(Refs: C-04, P-02, P0-4)*
  - **Steps:**
    1. Update `backend/src/models/CreditRequest.js`: add `'PROCESSING'` to `status` enum, add `submittedBy`, `reviewedBy`, `reviewedAt`, `rejectionReason`, and index `{ entityAddress: 1, createdAt: -1 }`.
    2. In `backend/src/routes/creditRequest.routes.js`:
       - Validate `mongoose.isValidObjectId(req.params.id)` (return `400` if invalid).
       - Validate `amount` with `Number.isSafeInteger(parsed) && parsed >= 1` (reject `NaN`/`Infinity`/floats with `400`).
       - Replace read-then-save in `/:id/approve` with atomic `findOneAndUpdate({ _id, status: 'PENDING' }, { $set: { status: 'PROCESSING', reviewedBy: req.user._id } }, { new: true })`. If null, check existence (`404`) vs status (`409`).
       - Save `txHash` cleanly upon completion (`APPROVED`); on tx submission error before broadcast, reset to `PENDING` (or mark `FAILED` if broadcast error uncertain, avoiding blind retry).
       - Add `GET /api/requests/mine` (`requireAuth`) returning the logged-in user's submitted requests paginated.
    3. Wrap `awardCredits`/`recordDebt`/`clearDebt` in `backend/signer.js` with a sequential async queue/mutex so concurrent approvals serialize EOA nonces.
  - **Acceptance Criteria:** Concurrent `approve` calls for the same ID execute at most 1 on-chain tx (`200` + `409`).
  - **Verification:** Write automated integration test mocking `signer.js` with artificial `50ms` delay and calling `Promise.all([approve, approve])` -> assert `awardCredits` called exactly once.

- [ ] **M2.2 — Harden Auth, Profile Ownership & Remove Public Admin Seed Escalation** *(Refs: C-05, C-06, P0-5)*
  - **Steps:**
    1. Remove `adminSeedKey` elevation from `POST /auth/register` (`backend/src/routes/auth.routes.js` L44–50) and remove admin seed toggle from `frontend/src/pages/SignupPage.jsx`. Create `backend/scripts/seedAdmin.js` CLI utility.
    2. Protect `POST /entity/profile` with `requireAuth` and require `{ accountId, businessName, walletAddress, signature }` verified via `ethers.verifyMessage` + `hashAccountId(walletAddress) === accountId` (reuse `backend/src/utils/hashAccountId.js`!).
    3. Add optional/required `walletAddress` linking on `User` (`GET /auth/nonce`, `POST /auth/link-wallet`) and check `entityAddress.toLowerCase() === req.user.walletAddress` in `POST /api/requests` (or record `submittedBy: req.user._id`).
  - **Acceptance Criteria:** Unauthenticated or forged-address profile updates return `401`/`403`; public signup always creates `USER`.
  - **Verification:** Integration test suite verifying 401/403 on unauthorized mutations and valid EIP-191 signature flow.

- [ ] **M2.3 — Patch Vulnerable Backend Dependencies & Add Security/Observability Middleware** *(Refs: P-05, P2-1)*
  - **Steps:**
    1. Inside `backend/`: upgrade `mongoose` (`^9.13.1`), `express` (`^4.22.3`), `ws` (`^8.23.0`); install `helmet`, `cors`, `express-rate-limit`, `zod`, `pino`.
    2. Create `backend/src/config/env.js` validating all required env vars at boot; await `mongoose.connect(env.MONGO_URI)` before `server.listen()`.
    3. Lift read-only `Contract` instance out of `GET /position/:address` handler into module scope.
    4. Add `helmet()`, `cors({ origin: env.CORS_ORIGIN })`, rate limiters on `/auth/*` & `/api/requests`, unified error middleware masking internal errors on 500, `/ready` check (`DB + RPC`), and graceful `SIGINT`/`SIGTERM` shutdown.
  - **Acceptance Criteria:** `npm audit --omit=dev` in `backend/` reports 0 critical/high vulnerabilities; invalid env vars exit cleanly on startup.
  - **Verification:** `cd backend && npm audit --omit=dev` + unit tests for error middleware, rate limiting, and `/ready`.

---

## Milestone 3: Frontend Bug Fixes, ESLint & Core UX Coherence (`P1`)

- [ ] **M3.1 — Fix `AdminDashboard` Stats, Inverted Net Signs & Render Side Effects** *(Refs: C-07, B-08, P1-2)*
  - **Steps:**
    1. In `frontend/src/pages/AdminDashboard.jsx`:
       - Fix L90–93 to read `globalStats.firmCount`, `globalStats.activeCredits`, `globalStats.activeDebt`, and `globalStats.activeCredits - globalStats.activeDebt`.
       - Fix L149 & L173–179: `const isPositive = net >= 0n`; color `net > 0n` green (`🟢 Net-Positive`), `net === 0n` neutral, `net < 0n` red (`🔴 Net-Emitter`).
       - Move `fetchPending()` at L235 into `useEffect(..., [fetchPending])`.
    2. In `frontend/src/pages/MarketplacePage.jsx` L188 & L232: fix color condition to `netCredits >= 0n ? 'var(--obs-green)' : 'var(--obs-red)'`.
    3. In `frontend/src/utils/blockchainReader.js` & `usePublicCarbonData.js`: compute `totalCreditsIssued`, `totalDebtIssued`, and `totalEvents` over ALL fetched logs, not the 50-item `recentEvents` slice.
  - **Acceptance Criteria:** Admin dashboard cards show live totals; positive net entities render green everywhere.
  - **Verification:** Component test asserting `+100` net renders green badge and non-zero stat cards.

- [ ] **M3.2 — Fix `UserTransactions` Event Duplication & Explorer Links** *(Refs: C-08, P1-3)*
  - **Steps:**
    1. In `frontend/src/hooks/useUserTransactions.js` & `frontend/src/utils/transactionParser.js`:
       - Stop double-counting overlapping `TransferSingle` + custom events in the same transaction (`CreditsAwarded`, `DebtRecorded`, `DebtCleared`, `CreditsRetired`, `BalanceUpdated`).
       - Filter `TransferSingle` only to direct wallet-to-wallet transfers (`from !== 0x0 && to !== 0x0 && operator.toLowerCase() !== MARKETPLACE_ADDR.toLowerCase()`).
       - Update summary reducer to classify `DEBT`, `MINT`, `RETIRE`, `BUY`, `SELL`, `TRANSFER` accurately.
    2. Update `UserTransactionTable.jsx` L133 to use dynamic explorer URL based on `VITE_CHAIN_ID` (plain copyable hash with no broken Etherscan link on chain `31337`).
  - **Acceptance Criteria:** 1 transaction produces 1 history row; summary metrics reconcile with wallet events.
  - **Verification:** Vitest unit test suite on `transactionParser.js` with multi-log tx fixtures.

- [ ] **M3.3 — Align Carbon Units & Separate Real History from What-If Simulator** *(Refs: B-04, P1-4)*
  - **Steps:**
    1. Standardize canonical unit (`1 token = 1 kg CO₂e`) across `carbonCalculator.js`, `carbonAnalyticsEngine.js`, and explanatory text in `BusinessAnalytics.jsx` (remove `1000×` mismatch and fix `BusinessAnalytics.jsx` L89 sign description).
    2. Build real time-bucketed credit/debt/net aggregation from on-chain events for `CarbonTrendChart.jsx` (removing synthetic `1 + i*0.05` mock loop).
    3. Label the `CarbonImpactDashboard` input editor clearly as an optional **"What-If Scenario Simulator"** defaulting to `0` rather than hardcoded fake corporate usage.
  - **Acceptance Criteria:** Zero fabricated data in `CarbonTrendChart`; calculator and analytics report identical units.
  - **Verification:** Vitest unit tests on `carbonCalculator` & `carbonAnalyticsEngine` verifying `0` defaults and exact arithmetic.

- [ ] **M3.4 — Fix `VerifyTransaction` Contract Validation & Public Access** *(Refs: B-02, P1-5)*
  - **Steps:**
    1. Update `frontend/src/hooks/useTxVerification.js` to validate `receipt.to` matches `CONTRACT_ADDRESSES.carbonCreditToken` or `CONTRACT_ADDRESSES.marketplace` and decode matching contract event logs using `viem` `decodeEventLog`.
    2. Update `VerifyTransaction.jsx` to render decoded action type (`CreditsAwarded`, `TradeExecuted`, `DebtCleared`, etc.), participating addresses/business names, and credit amount—and reject unrelated transactions with a clear message.
    3. Expose `VerifyTransaction` without requiring login (linkable from `PublicDashboard` or route `/verify`).
  - **Acceptance Criteria:** Non-CarboCred Ethereum transactions are rejected; CarboCred transactions show decoded event proof.
  - **Verification:** Unit tests for `useTxVerification` covering valid CarboCred tx, unrelated tx, reverted tx, and missing hash.

- [ ] **M3.5 — Fix Marketplace Flow, Dynamic Chain Config, FeedItem & All 29 ESLint Errors** *(Refs: B-06, B-07, B-09, B-11, P1-6)*
  - **Steps:**
    1. Parameterize chain (`hardhat` vs `sepolia`) from `VITE_CHAIN_ID` in `wagmiConfig.js`, `App.jsx`, `usePublicCarbonData.js`, and `useUserTransactions.js`; share one `src/lib/apiClient.js` and `src/utils/formatters.js` (`shortenAddr`).
    2. In `App.jsx` & `useMarketplace.js`: read `availableNetCredits`, use `writeContractAsync` + `waitForTransactionReceipt` before clearing forms/invalidating queries (removing `setTimeout(..., 3000)`), and add a `"My Requests"` status view showing `GET /api/requests/mine`.
    3. Fix `MarketplacePage.jsx` `FeedItem` to handle `TradeExecuted`, `BalanceUpdated`, `DebtCleared`, `CreditsRetired`.
    4. Fix all 29 ESLint errors & 1 warning across `AuthContext.jsx`, `PublicDashboard.jsx` (move countdown tick into `useEffect` interval), `VerifyTransaction.jsx`, `useTxVerification.js`, `vite.config.js` (`import.meta.dirname` or `fileURLToPath`), `eslint.config.js`, and unused imports.
  - **Acceptance Criteria:** `cd frontend && npm run lint` outputs 0 errors and 0 warnings; Sepolia chain ID env var switches target network cleanly.
  - **Verification:** `cd frontend && npm run lint && npm run build`.

---

## Milestone 4: Automated Testing, Indexer & Production Readiness (`P2`/`P3`)

- [ ] **M4.1 — Add Backend & Frontend Automated Test Suites + GitHub Actions CI** *(Refs: P2-2)*
  - **Steps:**
    1. Add `test` script (`node --test tests/*.test.js`) to `backend/package.json` with `supertest` integration tests for auth, requests, concurrency, and profiles.
    2. Add `vitest` + `@testing-library/react` + `jsdom` to `frontend/package.json` with unit/component tests.
    3. Create `.github/workflows/ci.yml` running root `npm test`, backend `npm test`, frontend `npm run lint && npm test && npm run build`.
    4. Update `.agent/workflows/test.md` to match actual working commands.
  - **Acceptance Criteria:** All 3 test suites + lint + build pass in CI.
  - **Verification:** Run full test matrix locally and inspect CI green run.

- [ ] **M4.2 — Build MongoDB Incremental Event Indexer & Auto-Reconnecting Listener** *(Refs: P-01, P2-3)*
  - **Steps:**
    1. Create `ChainEvent` and `SyncState` Mongoose models with unique compound index `{ chainId: 1, txHash: 1, logIndex: 1 }`.
    2. Refactor `backend/listener.js` into `src/services/chainSync.js`: on startup & periodic interval / WSS reconnect, query `getLogs(lastSyncedBlock + 1, latest)` in safe chunks, persist events idempotently, update `SyncState`, and broadcast new events via `ws`.
    3. Add paginated endpoints `GET /api/events/firms`, `GET /api/events/global-stats`, and `GET /api/events/history/:address` and wire `usePublicCarbonData` & `useUserTransactions` to fetch from the indexed API (with optional on-chain balance spot-check).
    4. Add auto-reconnect with exponential backoff to `useLiveFeed.js`.
  - **Acceptance Criteria:** Restarting Hardhat/RPC or dropping WSS recovers missed events without duplicates; dashboard queries load in 1 HTTP call.
  - **Verification:** Integration test replaying overlapping block ranges asserts zero duplicate `ChainEvent` docs and matching stats.

- [ ] **M4.3 — Frontend Bundle Optimization, Remove Tailwind CDN & Update Docs** *(Refs: P2-4)*
  - **Steps:**
    1. Remove `<script src="https://cdn.tailwindcss.com">` from `frontend/index.html` and replace Tailwind classes in `PurchaseSuccess.jsx`, `QRScanner.jsx`, `TransactionQR.jsx`, `UserTransactionTable.jsx` with `--obs-*` CSS classes (fixing light-theme contrast on `VerifyTransaction.jsx`).
    2. Lazy-load `AdminDashboard`, `BusinessAnalytics`, `VerifyTransaction`, `UserTransactions` with `React.lazy` + `Suspense`, and add `manualChunks` in `frontend/vite.config.js`.
    3. Update `README.md` & `DEPLOYMENT.md` to reflect Vite + React 19, MongoDB, JWT auth, and actual setup/test commands.
  - **Acceptance Criteria:** Zero CDN script tags; Vite build emits zero >500 kB chunk warnings; docs match code 100%.
  - **Verification:** `cd frontend && npm run build` inspects chunk sizes; light/dark mode visual check.

- [ ] **M4.4 — Differentiating Upgrades: Partial Listing Fills & Docker Compose (`P3`)**
  - **Steps:**
    1. Add `purchasePartial(listingId, amount)` to `CarbonMarketplace.sol` + Hardhat tests (`P3-2`).
    2. Add `backend/Dockerfile`, `frontend/Dockerfile`, and root `docker-compose.yml` for one-command reproducible local/staging deployment (`P3-3`).
  - **Acceptance Criteria:** Partial buys update `listing.amount` and `lockedCredits` accurately; `docker compose up` boots full stack cleanly.
  - **Verification:** Hardhat tests + `docker compose up` `/ready` health check.
