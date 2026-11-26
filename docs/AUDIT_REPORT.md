# CarboCred — Comprehensive Technical Audit Report

> **Audit Classification Standard:**
> - **Confirmed:** Directly verified by inspecting repository source files or executing commands in this workspace.
> - **Potential:** Plausible flaw or risk identified through static inspection that requires live runtime/DB/load validation.
> - **Unverified:** Could not be executed because live external runtime (MongoDB Atlas mutation, MetaMask interactive browser session, Sepolia deployment) was out of scope or unavailable.

---

## 1. Executive Summary

CarboCred implements an ambitious and conceptually cohesive Web3 carbon marketplace combining **Solidity ERC-1155 smart contracts**, a **Node.js/Express/MongoDB/Ethers backend**, and a **React/Vite/wagmi/viem frontend**. The smart-contract foundation (`CarbonCreditToken.sol` + `CarbonMarketplace.sol`) uses sound primitives (OpenZeppelin v5 `AccessControl`, `ReentrancyGuard`, CEI pattern, soulbound `DEBT_TOKEN`, and `lockedCredits`), and all **26 Hardhat tests pass**.

However, rapid iterative feature additions (analytics, QR verification, business profiles, JWT auth, and admin validation queue) left behind **critical security exposures, a smart-contract accounting flaw, severe frontend data/logic bugs, broken tooling hygiene, and zero backend/frontend automated tests**. In its current state, the application is **not production-ready or safe to deploy publicly**, and exposing it on a resume without resolving the critical defects would raise immediate red flags in technical code review.

---

## 2. Repository Understanding & Implementation Status

| Feature / Area | Status | Evidence | Notes |
|---|---|---|---|
| **ERC-1155 Credit & Debt Registry** | **Implemented (Buggy Auto-Offset)** | `contracts/CarbonCreditToken.sol` | Soulbound `DEBT_TOKEN`, roles, and views work; `settleTransferWithAutoOffset` burns debt without burning equivalent credits; `retireCredits` lacks event/UI/route. |
| **P2P Marketplace (`list/buy/cancel`)** | **Fully Implemented** | `contracts/CarbonMarketplace.sol` | `lockedCredits`, purchase-time `netCredits` re-check, and direct ETH forwarding work; lacks partial fills and `getListings` pagination in UI. |
| **JWT User Authentication** | **Implemented (Hardening Gaps)** | `backend/src/routes/auth.routes.js`, `AuthContext.jsx` | Register/login/me work via bcrypt + JWT; `ADMIN_SEED_KEY` leaked in `start.ps1`; no rate limits or wallet binding. |
| **Admin Credit Validation Queue** | **Partially Implemented (Broken Controls)** | `creditRequest.routes.js`, `AdminDashboard.jsx` | Queue CRUD works, but `approve` has a concurrency race condition, legacy `/award`/`/debt`/`/clear-debt` bypass it, and `AdminDashboard` stats/colors are broken. |
| **Business Identity Profiles** | **Partially Implemented (Insecure)** | `entityProfile.controller.js`, `useEntityProfile.js` | `GET`/`POST` profile works, but `POST` has zero auth/wallet proof (anyone can overwrite any firm name). |
| **Live WebSocket Event Feed** | **Partially Implemented** | `backend/listener.js`, `useLiveFeed.js`, `MarketplacePage.jsx` | Streams 7 contract events, but misses `AutoOffsetApplied`, never reconnects on WSS drop, and `FeedItem` misclassifies trades/clears as red emissions. |
| **User Transaction History** | **Broken (Duplicate Records)** | `useUserTransactions.js`, `transactionParser.js` | Double-counts `TransferSingle` + custom events (`CreditsAwarded`, `DebtRecorded`, `DebtCleared`, `BalanceUpdated`) and hardcodes Sepolia Etherscan links. |
| **Business Carbon Analytics** | **Mocked / Simulated** | `useCarbonAnalytics.js`, `CarbonTrendChart.jsx`, `carbonAnalyticsEngine.js` | Uses hardcoded `DEFAULT_INPUTS`, synthetic 6-month noise curve, and mixes `kg CO₂` tokens with `tCO₂e` calculations (`1000×` unit mismatch). |
| **QR Receipt & Public Verification** | **Partially Implemented** | `TransactionQR.jsx`, `QRScanner.jsx`, `VerifyTransaction.jsx`, `useTxVerification.js` | Generates & decodes `{ type: "CARBOCRED_TX", txHash }`, but verifies only *any* mined tx on RPC—does not verify CarboCred contract address or decode event logs. |
| **Public Emissions Dashboard** | **Implemented (Minor Bugs)** | `PublicDashboard.jsx`, `usePublicCarbonData.js`, `blockchainReader.js` | No-wallet public view works; undercounts global totals past 50 events and calls `Date.now()` in render. |
| **Automated Tests & CI** | **Contracts Only (No Backend/FE Tests)** | `test/CarboCred.test.js`, `package.json`, `frontend/` | 26 Hardhat tests pass; 0 backend tests (`npm test` missing); 0 frontend tests; `npm run lint` fails with 29 errors; no CI config. |

---

## 3. Critical & High Findings (Confirmed)

### C-01: Unauthenticated `/award`, `/debt`, and `/clear-debt` Endpoints Bypass Admin Queue
- **Classification:** Confirmed | **Severity:** Critical
- **Location:** `backend/index.js` (`app.post("/award")` L139–161, `app.post("/debt")` L169–181, `app.post("/clear-debt")` L188–200)
- **Problem:** Even though `c1992e9` introduced `requireAuth`, `requireAdmin`, and `POST /api/requests`, the legacy direct-minting endpoints remain mounted with **no authentication or authorization**. In `/award`, signature verification runs only `if (signature)` (L147), so omitting `signature` completely bypasses verification—and even with a valid self-signature, a user can mint arbitrary credits directly via `BACKEND_ROLE`.
- **Impact:** Any unauthenticated attacker can mint unlimited `CREDIT_TOKEN`s, grief any address with soulbound `DEBT_TOKEN`s (blocking them from selling on the marketplace), or erase any address's `DEBT_TOKEN`s for free.
- **Reproduction:** `curl -X POST http://localhost:4000/award -H "Content-Type: application/json" -d '{"entity":"0x...","amount":1000000,"reason":"exploit"}'` succeeds without any JWT or admin approval.
- **Recommended Solution:** Remove `/award`, `/debt`, and `/clear-debt` from `backend/index.js`; move startup test seeding in `start.ps1` to a Hardhat script (`scripts/seedLocal.js`) that invokes `awardCredits` directly only on local chain `31337`.

### C-02: Live MongoDB Atlas Credentials, `JWT_SECRET`, and `ADMIN_SEED_KEY` Committed in Tracked `start.ps1`
- **Classification:** Confirmed | **Severity:** Critical
- **Location:** `start.ps1` (L98 `MONGO_URI`, L101 `JWT_SECRET`, L102 `ADMIN_SEED_KEY`)
- **Problem:** `start.ps1` is tracked in Git (`git ls-files`) across multiple commits and contains plaintext MongoDB Atlas credentials, the JWT signing key, and the admin registration seed key, writing them into `backend/.env` on every startup.
- **Impact:** Anyone cloning or reading the repository gains full read/write access to the Atlas MongoDB cluster, can forge arbitrary `ADMIN` JWT tokens offline, and can register new `ADMIN` accounts via `/auth/register`.
- **Recommended Solution:** Immediately rotate the MongoDB Atlas user password, `JWT_SECRET`, and `ADMIN_SEED_KEY`; strip hardcoded secrets from `start.ps1` (read from `.env` or use local-only MongoDB/ephemeral generated secrets for local dev); rewrite/purge secret history (`git filter-repo`) if the repository is or will be public.

### C-03: Smart Contract Auto-Offset Double-Counts Purchased Credits (Phantom Credit Inflation)
- **Classification:** Confirmed | **Severity:** Critical
- **Location:** `contracts/CarbonCreditToken.sol` (`settleTransferWithAutoOffset`, L214–250) and codified in `test/CarboCred.test.js` (L249–264)
- **Problem:** When a buyer holding `50 DEBT_TOKEN` purchases `100 CREDIT_TOKEN`:
  1. Line 228 transfers `100 CREDIT_TOKEN` to the buyer.
  2. Lines 241–247 burn `50 DEBT_TOKEN` from the buyer **without burning `50 CREDIT_TOKEN`**!
  3. Consequently, the buyer starts at `netCredits = -50`, pays for `100` credits, and ends up with `100 CREDIT_TOKEN` and `0 DEBT_TOKEN` (`netCredits = +100`—a `+150` jump!).
- **Impact:** Any emitter with `D` debt who buys `C >= D` credits gets `D` debt erased for free AND keeps all `C` credits to resell on the marketplace, breaking carbon conservation and enabling infinite debt-laundering loops between two wallets.
- **Recommended Solution:** Inside `settleTransferWithAutoOffset`, after transferring `amount` credits to `buyer`, burn BOTH `_burn(buyer, DEBT_TOKEN, debtBurned)` AND `_burn(buyer, CREDIT_TOKEN, debtBurned)`, and emit `CreditsRetired(buyer, debtBurned)`. Update `test/CarboCred.test.js` L261–263 so `buyer` holds `50 CREDIT_TOKEN`, `0 DEBT_TOKEN`, `netCredits == 50n`.

### C-04: Race Condition & Partial-Failure Double-Minting in `POST /api/requests/:id/approve`
- **Classification:** Confirmed | **Severity:** High
- **Location:** `backend/src/routes/creditRequest.routes.js` (L74–101)
- **Problem:** Check-then-act is non-atomic: line 76 reads the `CreditRequest` document, line 78 checks `status !== 'PENDING'` in memory, lines 85–89 await the slow blockchain transaction, and line 93 saves `status = 'APPROVED'`. Additionally, if `tx.wait()` succeeds and `request.save()` fails (DB outage), `status` remains `PENDING`.
- **Impact:** Concurrent clicks or parallel HTTP requests trigger two on-chain mints for a single request.
- **Reproduction:** Send two simultaneous `POST /api/requests/<id>/approve` requests with `Promise.all` before the block confirms; both invoke `awardCredits()`.
- **Recommended Solution:** Add `'PROCESSING'` to `CreditRequest.status` enum; atomically transition `await CreditRequest.findOneAndUpdate({ _id: req.params.id, status: 'PENDING' }, { $set: { status: 'PROCESSING', reviewedBy: req.user._id } }, { new: true })`. Persist `txHash` immediately upon `tx` creation and reconcile/revert safely on failure.

### C-05: Unauthenticated `POST /entity/profile` Allows Impersonation / Overwriting Any Business Name
- **Classification:** Confirmed | **Severity:** High
- **Location:** `backend/src/routes/entityProfile.routes.js` (L15) & `backend/src/controllers/entityProfile.controller.js` (L37–60)
- **Problem:** `POST /entity/profile` has no `requireAuth` middleware and does not check that the caller controls the wallet whose SHA-256 hash is `accountId`. Because `accountId = sha256(address.toLowerCase())` is deterministic and public addresses are visible on-chain, anyone can overwrite any firm's `businessName`.
- **Recommended Solution:** Require `requireAuth` and verify an EIP-191 signature from the wallet address (or verify `hashAccountId(req.user.walletAddress) === accountId`).

### C-06: Missing User-to-Wallet Ownership Binding on `POST /api/requests`
- **Classification:** Confirmed | **Severity:** High
- **Location:** `backend/src/routes/creditRequest.routes.js` (L21–55) & `backend/src/models/CreditRequest.js` (L11–46)
- **Problem:** Any authenticated `USER` can submit `CREDIT` or `DEBT` requests for *any* `entityAddress`, and `CreditRequest` does not record `submittedBy: req.user._id`.
- **Recommended Solution:** Link a signature-verified `walletAddress` to `User`, enforce `entityAddress.toLowerCase() === req.user.walletAddress` (unless `ADMIN`), and store `submittedBy`.

### C-07: `AdminDashboard` Global Stats Always Render `0` & Net Position Colors/Labels Are Inverted
- **Classification:** Confirmed | **Severity:** High
- **Location:**
  - `frontend/src/pages/AdminDashboard.jsx` (L90–93, L149, L173–179)
  - `frontend/src/pages/MarketplacePage.jsx` (L188, L232)
  - `frontend/src/utils/blockchainReader.js` (L182–191)
- **Problems:**
  1. `AdminDashboard.jsx` reads `globalStats.totalFirms`, `globalStats.totalCredits`, `globalStats.totalDebt`, `globalStats.netPosition`, whereas `computeGlobalStats()` returns `{ firmCount, activeCredits, activeDebt, totalCreditsIssued, totalDebtIssued, netPositive, netNegative, totalEvents }`. Three of the four cards always display `0`.
  2. `CarbonCreditToken.sol` defines `netCredits = credits - debt` (positive = offset holder, negative = emitter). Yet `AdminDashboard.jsx` L149 computes `const isNetNeg = net <= 0n` and renders `🟢 Net-Negative` in green when `net <= 0n` and `🔴 Net-Emitter` in red when `net > 0n`! Similarly, `MarketplacePage.jsx` L188 & L232 colors `netCredits <= 0n` green (`#10b981`) and positive `netCredits > 0n` red (`#f87171`).
- **Impact:** Net offset holders appear flagged in red as `"Net-Emitter"`, while debtors (`-500`) appear green!

### C-08: `UserTransactions` Double-Counts Mints, Debts, Retirements, and Trades
- **Classification:** Confirmed | **Severity:** High
- **Location:** `frontend/src/hooks/useUserTransactions.js` (L87–160) & `frontend/src/utils/transactionParser.js` (L42–160)
- **Problem:** `useUserTransactions` queries BOTH ERC-1155 `TransferSingle` AND custom contract events (`CreditsAwarded`, `DebtRecorded`, `DebtCleared`, `BalanceUpdated`), deduplicating by `${txHash}-${logIndex}`. Because a single transaction emits both `TransferSingle` and the custom event with different `logIndex` values:
  - Every `awardCredits` generates two `MINT` rows and doubles `totalMinted`.
  - Every `clearDebt` generates two `RETIRE` rows and doubles `totalRetired`.
  - Every `recordDebt` generates a `MINT` row (from `TransferSingle`) AND a `RECEIVED` row (from `DebtRecorded`).
  - `summary` calculation (`L152–158`) skips `TRADE` completely, relying on duplicate `TransferSingle` entries, and `UserTransactionTable.jsx` L133 hardcodes Sepolia Etherscan links even on Hardhat `31337`.
- **Recommended Solution:** Parse custom semantic events (`CreditsAwarded`, `DebtRecorded`, `DebtCleared`, `BalanceUpdated` / `TradeExecuted`) as primary records, using `TransferSingle` only for direct peer-to-peer transfers where `operator !== MARKETPLACE_ADDRESS` and `from/to !== 0x0`.

---

## 4. Additional Confirmed Bugs & Logical Errors

| ID | File & Location | Classification | Severity | Issue & Impact |
|---|---|---|---|---|
| **B-01** | `backend/package.json` L12 & `frontend/package.json` L15 | Confirmed | High | `"carbocred": "file:.."` creates an **infinite recursive directory symlink loop** (`node_modules/carbocred/backend/node_modules/carbocred/...`), breaking recursive filesystem scans with Windows `MAX_PATH` `DirectoryNotFoundException`. Neither backend nor frontend imports `"carbocred"`. |
| **B-02** | `frontend/src/hooks/useTxVerification.js` & `VerifyTransaction.jsx` | Confirmed | High | `useTxVerification` only calls `getTransactionReceipt` / `getTransaction` and never checks `receipt.to` against `CONTRACT_ADDRESSES` or decodes contract event logs. Any random Ethereum transaction passes as `"✅ Verified Successful"`; `receipt.from` displays the backend relayer address for minted credits rather than the recipient entity. |
| **B-03** | `frontend/src/utils/blockchainReader.js` L165–173 & `usePublicCarbonData.js` L75 | Confirmed | Medium | `computeGlobalStats` sums `totalCreditsIssued`, `totalDebtIssued`, and `totalEvents` from `recentEvents` (sliced to `50` in `getRecentTransfers`), underreporting totals once total events exceed `50`. |
| **B-04** | `frontend/src/lib/carbonCalculator.js` vs `utils/carbonAnalyticsEngine.js` & `CarbonTrendChart.jsx` | Confirmed | Medium | `carbonCalculator.js` outputs `kg CO₂` (mints integer kg as tokens), while `carbonAnalyticsEngine.js` divides local kWh/KL by `1000` (tonnes) and adds them to `onChainEmissions` assuming `1 token = 1 tCO₂e` (a `1000×` mismatch). `CarbonTrendChart` fabricates 6 months of fake trend history (`1 + i * 0.05`). |
| **B-05** | `backend/src/routes/creditRequest.routes.js` L38–41 & `backend/index.js` L155,175,194 | Confirmed | Medium | `Math.floor(Number("abc"))` yields `NaN`; `NaN < 1` is `false`, passing validation into Mongoose and failing with 500. `BigInt(amount)` in `/award`/`/debt`/`/clear-debt` throws uncaught `SyntaxError` -> 500 on decimals/non-numeric strings. Invalid `:id` on `/approve` & `/reject` causes `CastError` -> 500 instead of 400. |
| **B-06** | `frontend/src/App.jsx` L106–146 & `MarketplacePage.jsx` L354 | Confirmed | Medium | `handleList` uses `netCredits < amountBig` without deducting `lockedCredits` (users with open listings can submit doomed MetaMask txs that revert on-chain), clears form inputs immediately before wallet signing/confirmation, and uses hardcoded `setTimeout(..., 3000)` instead of `waitForTransactionReceipt`. `handleAwardSubmit` also triggers `setTimeout(refetchPos, 3000)` even though submitting only creates a `PENDING` DB request. |
| **B-07** | `frontend/src/App.jsx` L56,97,208; `usePublicCarbonData.js` L29; `useUserTransactions.js` L23 | Confirmed | Medium | `hardhat.id` (`31337`) and `hardhat` chain config are hardcoded regardless of `VITE_CHAIN_ID`, breaking Sepolia testnet switching and reads. |
| **B-08** | `frontend/src/pages/AdminDashboard.jsx` L235 | Confirmed | Medium | `if (!fetched && !loading) fetchPending()` executes state updates and network fetches synchronously during render instead of inside `useEffect`. |
| **B-09** | `frontend/src/pages/MarketplacePage.jsx` L125–142 | Confirmed | Low | `FeedItem` looks for `ev.entity`, `ev.blockNumber`, and `'Purchase'`/`'List'`; `listener.js` never sets `blockNumber`, and `TradeExecuted`/`BalanceUpdated` carry `seller`/`buyer` instead of `entity`, miscoloring `TradeExecuted`, `DebtCleared`, and `BalanceUpdated` as red `🏭` with blank entity details. |
| **B-10** | `backend/index.js` L34 | Confirmed | Low | Destructures `getNetCredits` from `./signer`, which does not export `getNetCredits` (`undefined`). |
| **B-11** | `frontend/src/pages/PublicDashboard.jsx` L22 | Confirmed | Low | Calls `Date.now()` directly during render (`react-hooks/purity` ESLint error); countdown text never ticks live. |

---

## 5. Potential Issues Requiring Runtime Validation

| ID | File & Location | Classification | Severity | Potential Issue |
|---|---|---|---|---|
| **P-01** | `backend/listener.js` L30–150 | Potential | High | `WebSocketProvider` has no heartbeat or reconnect handler. If the Hardhat node restarts or Alchemy/Infura drops an idle WSS connection, `silenceRawWsError` absorbs the error and live events stop permanently until server restart. |
| **P-02** | `backend/signer.js` L27–43 | Potential | Medium | Concurrent admin approvals of different requests (`reqA` and `reqB`) call `creditToken.awardCredits(...)` concurrently with the same wallet without explicit nonce locking; under ethers v6 `JsonRpcProvider`, parallel transactions from one EOA can race on `eth_getTransactionCount("latest")` depending on RPC node behavior. |
| **P-03** | `contracts/CarbonCreditToken.sol` L214–250 & `CarbonMarketplace.sol` L207–258 | Potential | Medium | Inside `settleTransferWithAutoOffset`, `_safeTransferFrom` triggers `onERC1155Received` on `buyer` *before* Step 2 burns `DEBT_TOKEN`. Once fixed to also burn `CREDIT_TOKEN` (`debtBurned`), a malicious buyer contract could transfer away its newly received `CREDIT_TOKEN` inside `onERC1155Received`, causing Step 2's `_burn` to revert! Reordering or guarding against callback transfer before burn prevents griefing/confusion. |
| **P-04** | `contracts/CarbonMarketplace.sol` L248 | Potential | Medium | Push-ETH transfer `(bool sent, ) = payable(seller).call{value: totalPrice}("")` will permanently block fulfillment if `seller` is a smart contract without `receive()`/`fallback()`. |
| **P-05** | `backend/index.js` L45–47 | Potential | Medium | `mongoose.connect(process.env.MONGO_URI)` is unawaited; if Atlas DNS/auth fails or takes longer than the first HTTP request, requests fail unpredictably instead of failing fast on startup. |

---

## 6. Dependency, Deprecation & Vulnerability Audit

Verified via `npm outdated` and `npm audit --json` in this workspace plus online version checks (`search_web`).

| Package / API | Workspace | Current / Locked | Status | Evidence | Impact | Recommendation | Target Version | Migration Risk |
|---|---|---|---|---|---|---|---|---|
| `carbocred` (`file:..`) | backend & frontend | Self-symlink | **Broken / Redundant** | `backend/package.json#L12`, `frontend/package.json#L15` | Infinite `node_modules` symlink loop crashing recursive scanners on Windows. | **Remove** | N/A | Low |
| `@yudiel/react-qr-scanner` | frontend | `^2.5.1` (`2.5.1`) | Unused / Outdated | `frontend/package.json#L14` (0 imports) | Bloats install and `package-lock.json` (`QRScanner.jsx` uses `jsqr`). | **Remove** | N/A | Low |
| `mongoose` | backend | `^9.2.1` (`9.2.1`) | **Vulnerable (Critical)** | `npm audit` (6 advisories incl. prototype pollution & `sanitizeFilter` bypasses) | Potential NoSQL/prototype manipulation if untrusted query objects ever reach Mongoose. | **Upgrade** | `9.13.1` | Low |
| `express` (incl. `body-parser`, `path-to-regexp`, `proxy-addr`) | backend | `^4.19.2` (`4.22.1`) | **Vulnerable (Critical/High)** & Maintenance | `backend/package.json#L15`, `npm audit` (`proxy-addr` Critical, `body-parser` & `path-to-regexp` High) | ReDoS / DoS / IPv4-mapped IPv6 spoofing if proxy trust is enabled; Express 4 is in maintenance mode while Express 5 is stable. | **Upgrade** (patch 4.x or plan 5.x) | `4.22.3` (or `5.3.0`) | Low (4.22.3) / Medium (5.x) |
| `ws` | backend & transitive | `^8.18.0` (`8.19.0`) | **Vulnerable (High)** | `backend/package.json#L18`, `npm audit` (memory disclosure & DoS) | Malformed WebSocket frames from untrusted clients can exhaust memory. | **Upgrade** | `8.23.0` | Low |
| `ethers` | backend | `^6.13.4` (`6.16.0`) | Slightly Outdated | `backend/package.json#L14` | Minor bug fixes behind latest v6 (`6.17.0`). | **Upgrade** | `6.17.0` | Low |
| `dotenv` | root (`17.3.1`) / backend (`16.6.1`) | `17.3.1` / `16.6.1` | Outdated / Duplicate major versions | `package.json#L23`, `backend/package.json#L13` | Two different major versions in repo (`16.x` and `17.x`; latest `18.0.10`). | **Align / Keep** | `16.6.1` or `17.4.2` | Low |
| `@openzeppelin/contracts` | root | `^5.4.0` (`5.4.0`) | Outdated patch/minor | `package.json#L22` | Latest 5.x is `5.6.1`. | **Keep or Upgrade** | `5.6.1` | Low |
| `hardhat` & `@nomicfoundation/hardhat-toolbox` | root | `2.28.6` / `5.0.0` | Outdated & **Vulnerable dev deps** | `package.json#L21,24`, `npm audit` (1 Critical `handlebars`, 20 High in dev toolchain) | Dev-only exposure (`handlebars`, `adm-zip`, `axios`, `lodash`, `undici`); Hardhat 3 is a complete ESM rewrite. | **Update lockfile / Upgrade toolbox carefully** | `hardhat 2.30.0` / `toolbox 6.x` (avoid rushed HH3 rewrite) | Medium |
| `vite` & `@vitejs/plugin-react` | frontend | `7.3.1` / `5.1.4` | **Vulnerable dev server (High)** | `frontend/package.json#L29,34`, `npm audit` (Windows `server.fs.deny` bypasses, path traversal) | Dev-server vulnerability when exposed beyond localhost. | **Upgrade** | `vite 7.3.8` (minor patch first; `8.4.0` is major) | Low |
| `react` / `react-dom` / `wagmi` / `viem` / `recharts` / `framer-motion` | frontend | `19.2.4` / `3.5.0` / `2.46.2` / `3.7.0` / `12.34.3` | Slightly Outdated | `frontend/package.json` | Latest minors available (`react 19.3.1`, `wagmi 3.7.11`, `viem 2.58.7`, `recharts 3.11.1`). | **Upgrade minors** | `19.3.1` / `3.7.11` / `2.58.7` | Low |
| `Tailwind CDN <script>` | `frontend/index.html` L8 | CDN latest | **Deprecated Prod Pattern** | `frontend/index.html#L8` | Render-blocking external runtime script compiler in production; inconsistent with custom CSS. | **Remove** (unify on CSS tokens or Vite plugin) | N/A | Medium |
| `Next.js` remnants (`next-env.d.ts`) | `frontend/next-env.d.ts` | Leftover | **Obsolete** | `frontend/next-env.d.ts`, `.gitignore#L20`, `README.md`, `DEPLOYMENT.md` | Misleads readers and tooling into thinking frontend is Next.js 15. | **Remove** | N/A | Low |

**`npm audit` Summary (Executed 2026-11-27):**
- **Root (`.`):** `54` total (`1` critical `handlebars`, `20` high, `14` moderate, `19` low) — devDependencies only.
- **Backend (`backend/`):** `10` total (`2` critical `mongoose`, `proxy-addr`; `6` high `body-parser`, `brace-expansion`, `minimatch`, `path-to-regexp`, `picomatch`, `ws`; `2` moderate) — **runtime production exposure**.
- **Frontend (`frontend/`):** `18` total (`0` critical, `13` high incl. `vite`, `rollup`, `postcss`, `ws`, `zod`, `nanoid`, `browserslist`; `3` moderate, `2` low) — mostly build/dev tooling plus `ws`/`zod` transitive via `viem`/`wagmi`.

---

## 7. Code Quality, Maintainability & Architecture Weaknesses

1. **Zero ESLint Gate & 29 Lint Errors:** `frontend/eslint.config.js` fails across 14 files (`react-hooks/immutability`, `react-hooks/set-state-in-effect`, `react-hooks/purity`, `react-refresh/only-export-components`, `__dirname` `no-undef` in `vite.config.js`, and genuine unused imports/params like `formatEther`, `shortenAddr`, `accountId`, `useMemo`, `useCallback`, `formatUnits`).
2. **Duplicated Logic Across Modules:**
   - `hashAccountId` is implemented 3 times (`backend/src/utils/hashAccountId.js` [unused], `frontend/src/utils/hashAccountId.js`, and inline in `VerifyTransaction.jsx` L29–35).
   - `shortenAddr` / `truncate` is re-implemented in `App.jsx` (unused), `MarketplacePage.jsx`, `AdminDashboard.jsx`, `FirmTable.jsx`, and `UserTransactionTable.jsx`.
   - `BACKEND_URL` and `fetch` JSON parsing are duplicated in `AuthContext.jsx`, `useCarbonAward.js`, `useEntityProfile.js`, `usePublicCarbonData.js`, `AdminDashboard.jsx`, and `VerifyTransaction.jsx`.
   - Event ABIs are duplicated in `contracts.js`, `listener.js`, `blockchainReader.js`, `useUserTransactions.js`, and `useCarbonAnalytics.js`.
3. **Inconsistent CSS Architecture:** 4 styling mechanisms coexist (`index.css`, `App.css`, 3 files in `styles/`, giant inline `const s = {}` style objects up to 370 lines per file, plus Tailwind CDN in `index.html`). Inline dark-only colors (`#f8fafc`, `#fff`) on `VerifyTransaction.jsx` break `ThemeToggle` light mode (`[data-theme="light"]`).
4. **Unused Smart Contract Code:** `CarbonMarketplace` inherits `Ownable` (`CarbonMarketplace.sol` L43) without a single `onlyOwner` function; `CarbonCreditToken.settleTransfer` (L174) is no longer called by `CarbonMarketplace`; `CarbonCreditToken.retireCredits` (L151) is unreachable from backend/frontend.
5. **Tracked Build/Error Junk & Stale Docs:** `hardhat_error.txt` and `hh_err.txt` are tracked in Git; `README.md` and `DEPLOYMENT.md` describe Next.js 15; `ARCHITECTURE.md` omits auth/admin/credit-requests and overstates analytics/verification capabilities; `.agent/workflows/test.md` references non-existent `cd backend && npm test`.

---

## 8. Performance & Scalability Findings

1. **Confirmed Client RPC Amplification (`usePublicCarbonData.js`, `useUserTransactions.js`, `blockchainReader.js`):**
   - `usePublicCarbonData` runs 7 `getLogs` sweeps from block `0` + `N` `getPosition` RPC calls + `N` `GET /entity/profile/:hash` HTTP calls every 30 seconds.
   - `useUserTransactions` runs 7 filtered `getLogs` sweeps from block `0` + `M` `getBlock` calls (one per unique block!) every 30 seconds.
   - *Expected optimization benefit & measurement:* Moving event aggregation to an incremental MongoDB `ChainEvent` indexer + `START_BLOCK` checkpoint reduces browser-to-RPC calls per refresh from `O(7 * ceil(latestBlock/2000) + M)` to `0` (1 indexed HTTP call), measurable via Chrome DevTools Network tab / RPC request counter and k6/autocannon latency p95.
2. **Confirmed Unbounded `getListings(0, nextId)` (`CarbonMarketplace.sol`, `useMarketplace.js`):**
   - Fetches every historical listing (including cancelled/fulfilled) on every marketplace load.
   - *Optimization & measurement:* Reverse-window pagination (`[max(0, nextId - pageSize), nextId)`) or backend active-listing index; measure calldata response size and RPC `eth_call` latency as listings grow to 1,000+.
3. **Confirmed Oversized Frontend Bundles (`vite build`):**
   - `dist/assets/main-DSXa6eaf.js`: `747.81 kB` (`227.21 kB` gzip) and `usePublicCarbonData-DikIC-t9.js`: `563.66 kB` (`177.58 kB` gzip), triggering Vite's >500 kB warning.
   - *Optimization & measurement:* Route/view `React.lazy()` + `manualChunks` (`recharts`, `viem/wagmi`, `framer-motion`) verified via `vite build` bundle output sizes.
4. **Confirmed Per-Request Contract Instantiation (`backend/index.js` L104–114):**
   - `GET /position/:address` executes `require()` and instantiates `new ethers.Contract(...)` per request. Lift to module scope.

---

## 9. Testing & Functional Verification Results

| Check | Command | Outcome | Details / Logs Summary |
|---|---|---|---|
| **Solidity Tests** | `npx hardhat test` | **PASS (26 passing, 4s)** | `CarbonCreditToken` (12 tests) and `CarbonMarketplace` (14 tests) pass. *(Note: test L261–263 validates the buggy auto-offset math).* |
| **Solidity Compile** | `npx hardhat compile` | **PASS (`Nothing to compile`, exit 0)** | Compiles cleanly with Solidity `0.8.24` (already cached in `artifacts/`). |
| **Backend Syntax** | `node --check` on all 13 `.js` files | **PASS (13/13 OK)** | No syntax errors across `backend/*.js` and `backend/src/**/*.js`. |
| **Backend Tests** | `cd backend && npm test` | **FAIL (`Missing script: "test"`)** | Zero backend tests exist, contradicting `.agent/workflows/test.md`. |
| **Frontend Lint** | `cd frontend && npm run lint` | **FAIL (30 problems: 29 errors, 1 warning)** | Hook immutability/purity/effect errors, `__dirname` `no-undef`, and unused vars across 14 files. |
| **Frontend Build** | `cd frontend && npm run build` | **PASS (built in 30.19s)** | Emits `dist/` with chunk-size >500 kB warnings (`747.81 kB` main, `563.66 kB` public data). |
| **Dependency Audit** | `npm audit --json` across `.`, `backend`, `frontend` | **DONE (Vulnerabilities Present)** | Root: 54 (1 Crit, 20 High); Backend: 10 (2 Crit, 6 High); Frontend: 18 (0 Crit, 13 High). |
| **Env Var Presence** | Key inspection on `.env`, `backend/.env`, `frontend/.env` | **SET (Non-Placeholder)** | Required keys present (values withheld); `frontend/.env` omits `VITE_RPC_URL` & `VITE_BACKEND_URL`, falling back to localhost defaults. |
| **Live E2E / MongoDB / MetaMask** | *Not Executed* | **UNVERIFIED** | Avoided mutating live Atlas MongoDB cluster or launching background server/browser processes during read-only audit. |

### Critical Missing Test Scenarios
1. **Contract tests:** Fixed 1:1 `settleTransferWithAutoOffset` (verifying `CREDIT_TOKEN` burn + `DEBT_TOKEN` burn + `netCredits == -D + C`), `retireCredits` + `CreditsRetired`, `listCredits` `pricePerCredit == 0` revert, `cancelListing` twice revert, post-listing debt gain preventing `purchaseListing`, and double-listing `lockedCredits` invariants.
2. **Backend integration tests:** Auth validation/401/403/409, removal of `/award`/`/debt`/`/clear-debt`, `POST /api/requests` `NaN`/address/wallet-ownership validation, **concurrent `POST /api/requests/:id/approve` race test**, malformed `:id` `400` handling, and authenticated `POST /entity/profile` signature verification.
3. **Frontend unit & component tests:** `carbonCalculator`, `carbonAnalyticsEngine` (post unit-fix), `transactionParser` (no duplicate mint/debt rows), `AdminDashboard` stats & positive/negative badge colors, and `VerifyTransaction` contract-address + event validation.

---

## 10. Product Gaps & Consolidated Recommendations

1. **Security & Trust Boundary Gaps:** Remove `/award`, `/debt`, `/clear-debt`; rotate & purge `start.ps1` secrets; bind wallets via EIP-191 signature; protect `POST /entity/profile`; enforce atomic `CreditRequest` approvals.
2. **Domain & UX Coherence:** Fix auto-offset accounting (`CarbonCreditToken.sol`), unify carbon units (`kg` vs `tCO₂e`), fix `AdminDashboard` stats & red/green net signs, fix `UserTransactions` duplicates, add a *"My Requests"* status tracker, make `VerifyTransaction` decode actual CarboCred events and work publicly without login, and replace simulated `CarbonTrendChart` with real on-chain history (clearly separating any optional "What-If Simulator").
3. **Operational Readiness:** Remove `"carbocred": "file:.."` & `@yudiel/react-qr-scanner`, fix all ESLint errors, add automated backend & frontend tests + CI workflow, add WSS reconnection + MongoDB `ChainEvent` indexer, and bring `README.md` / `DEPLOYMENT.md` / `ARCHITECTURE.md` into alignment with reality.
