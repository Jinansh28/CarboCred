# CarboCred — Final Comprehensive Repository Audit, Architecture & Resume-Readiness Analysis

> **Primary Deliverable** | **Companion Docs:** [PRD](./docs/PRD.md) · [TRD](./docs/TRD.md) · [Architecture](./ARCHITECTURE.md) · [Audit Report](./docs/AUDIT_REPORT.md) · [Roadmap](./docs/ROADMAP.md) · [Tasks](./docs/TASKS.md)  
> **Audit Policy:** Every claim below is grounded strictly in inspected source files and observed tool execution outputs (`npx hardhat test`, `npx hardhat compile`, `npm run lint`, `npm run build`, `npm audit`, `npm outdated`, `node --check`). Unexecuted live runtime/DB/browser flows are explicitly marked **Unverified**.

---

## 1. Executive Summary

### What the project does
CarboCred is a full-stack decentralized carbon accounting and peer-to-peer offset marketplace. Organizations submit carbon emission and reduction activities through a web calculator; claims enter a MongoDB validation queue (`CreditRequest`) for administrative approval; an Express backend holding an on-chain `BACKEND_ROLE` key mints tradeable ERC-1155 offset credits (`CREDIT_TOKEN`, ID `0`) or soulbound emission liabilities (`DEBT_TOKEN`, ID `1`); and entities with positive net balances (`credits - debt`) can list and trade surplus credits for native ETH on `CarbonMarketplace.sol`. A separate read-only public dashboard and QR transaction verification flow provide external transparency.

### Present maturity
**Early-stage prototype / hackathon MVP with uneven layer maturity.**
- The **Solidity contracts** (`CarbonCreditToken.sol`, `CarbonMarketplace.sol`) show thoughtful domain design (`lockedCredits`, CEI settlement, soulbound `_update`, purchase-time net re-check) and have **26 passing Hardhat tests**, yet contain a critical accounting bug in `settleTransferWithAutoOffset`.
- The **backend and frontend** were evolved iteratively across distinct commits (`e355811` -> `9fe6b42` -> `fc18370` -> `c1992e9`), introducing MongoDB profiles, analytics, QR codes, JWT auth, and an Admin Dashboard—but without automated tests, code review discipline, or removing superseded legacy endpoints.

### Biggest strengths
1. **Clean core domain abstraction:** Using ERC-1155 ID `0` (tradeable credit) + ID `1` (soulbound debt) with an on-chain `netCredits` gate prevents net-emitter sellers from dumping unbacked credits while retaining one unified registry contract.
2. **Defense-in-depth marketplace primitives:** `CarbonMarketplace` avoids ERC-1155 `setApprovalForAll` risk via `MARKETPLACE_ROLE`, prevents double-listing via `lockedCredits`, re-validates seller net balance at purchase time, and forwards ETH immediately via CEI + `ReentrancyGuard`.
3. **Clear public transparency concept:** Separating an unauthenticated, read-only public emissions ledger (`public-dashboard.html`) from the wallet/account marketplace cleanly separates public accountability from trading operations.

### Biggest weaknesses
1. **Severe security & integrity defects:** Live MongoDB Atlas credentials, `JWT_SECRET`, and `ADMIN_SEED_KEY` are committed inside `start.ps1`; unauthenticated direct-mint routes (`/award`, `/debt`, `/clear-debt`) bypass the admin queue; `POST /entity/profile` is unauthenticated; and `POST /api/requests/:id/approve` has a double-mint concurrency race condition.
2. **Broken core business math & UI bugs:** `settleTransferWithAutoOffset` burns buyer `DEBT_TOKEN`s without burning equivalent `CREDIT_TOKEN`s (creating phantom credits); `AdminDashboard` displays `0` on three global stat cards and inverts positive/negative net colors (`+1000` shows red `"Net-Emitter"`); `UserTransactions` double-counts every mint/debt/retirement; `BusinessAnalytics` mixes `kg` tokens with `tCO₂e` (`1000×` mismatch) and plots fabricated trend data.
3. **Zero backend/frontend tests & failing lint:** Backend `npm test` does not exist (`Missing script: "test"`), frontend has `0` tests and **29 ESLint errors**, and `"carbocred": "file:.."` creates an infinite recursive symlink loop inside `node_modules`.

### Is it currently resume-ready?
**No — not in its current state.** While the domain idea and contract concepts are strong, any senior engineer inspecting the repository or running `npm run lint`, `npm test`, or checking `backend/index.js` and `start.ps1` would immediately uncover committed secrets, open mint backdoors, broken accounting math, and zero backend/frontend test coverage.

### What would make it significantly stronger
Closing the **P0 security/accounting flaws**, fixing the **P1 broken data flows** (admin stats, transaction deduplication, contract-aware QR verification, unit alignment), adding **automated backend + frontend tests with CI**, and replacing browser-side genesis `eth_getLogs` polling with an **idempotent MongoDB blockchain event indexer** would elevate CarboCred into a genuine backend + Web3 systems-engineering showcase.

---

## 2. Repository Overview

### Project structure
```text
CarboCred/
├── contracts/                  # CarbonCreditToken.sol (310L), CarbonMarketplace.sol (307L)
├── scripts/                    # deploy.js, getAddresses.js
├── test/                       # CarboCred.test.js (26 Hardhat tests)
├── backend/
│   ├── index.js                # Express REST + WebSocket server (:4000)
│   ├── listener.js             # ethers WebSocketProvider event relay
│   ├── signer.js               # BACKEND_ROLE tx signer
│   └── src/
│       ├── controllers/        # entityProfile.controller.js
│       ├── middleware/         # requireAuth.js, requireAdmin.js
│       ├── models/             # User.js, CreditRequest.js, EntityProfile.js
│       ├── routes/             # auth.routes.js, creditRequest.routes.js, entityProfile.routes.js
│       └── utils/              # hashAccountId.js (unused on backend)
├── frontend/
│   ├── index.html              # SPA entry (loads Tailwind CDN)
│   ├── public-dashboard.html   # Read-only public MPA entry
│   ├── vite.config.js          # Dual-entry Vite 7 build
│   ├── eslint.config.js        # ESLint 9 flat config
│   └── src/
│       ├── App.jsx             # Auth gate + view-state switcher
│       ├── context/            # AuthContext.jsx
│       ├── lib/                # contracts.js, wagmiConfig.js, carbonCalculator.js
│       ├── hooks/              # 9 custom hooks (wagmi/viem/fetch/ws)
│       ├── pages/              # 9 pages (Marketplace, Admin, Analytics, History, Verify, Public, Auth)
│       ├── components/         # 12 UI components (charts, tables, QR, onboarding, theme)
│       ├── styles/             # analytics.css, dashboard.css, transactions.css
│       └── utils/              # blockchainReader.js, transactionParser.js, carbonAnalyticsEngine.js, qrGenerator.js, hashAccountId.js
├── docs/                       # Audit & engineering documentation added in this review
├── start.ps1                   # Windows local dev launcher (contains leaked secrets)
├── ARCHITECTURE.md             # System architecture doc (updated in this review)
├── README.md & DEPLOYMENT.md   # Outdated docs referencing Next.js 15
└── hardhat.config.js           # Solidity 0.8.24 config (local + Sepolia)
```

### Technology stack (locked versions)
- **Blockchain:** Solidity `0.8.24`, OpenZeppelin Contracts `5.4.0`, Hardhat `2.28.6`, `@nomicfoundation/hardhat-toolbox` `5.0.0`, `dotenv` `17.3.1`.
- **Backend:** Node.js `22.13.0`, Express `4.22.1`, Mongoose `9.2.1` (MongoDB), `ethers` `6.16.0`, `ws` `8.19.0`, `jsonwebtoken` `9.0.3`, `bcryptjs` `3.0.3`, `dotenv` `16.6.1`, `nodemon` `3.1.13`.
- **Frontend:** React `19.2.4`, Vite `7.3.1`, `wagmi` `3.5.0`, `viem` `2.46.2`, `@tanstack/react-query` `5.90.21`, `recharts` `3.7.0`, `framer-motion` `12.34.3`, `qrcode` `1.5.4`, `jsqr` `1.4.0` (plus unused `@yudiel/react-qr-scanner` `2.5.1`).

### Main workflows & Architecture overview
1. **Auth & Onboarding:** User registers/logs in via JWT (`/auth/*`), connects MetaMask (`wagmi`), and registers a pseudonymized SHA-256 `businessName` (`/entity/profile`).
2. **Claim & Audit:** User calculates emissions/reductions -> `useCarbonAward` queues `CREDIT`/`DEBT` claims via `POST /api/requests` -> `ADMIN` approves via `AdminDashboard` -> `signer.js` mints on-chain -> `listener.js` relays event over `ws://:4000`.
3. **Marketplace Trading:** Seller lists `CREDIT_TOKEN` (`listCredits` checks `netCredits - lockedCredits`); buyer pays exact ETH (`purchaseListing`), triggering `settleTransferWithAutoOffset` and generating a receipt QR code (`PurchaseSuccess`).
4. **Public Inspection & History:** `PublicDashboard` and `UserTransactions` query chain event logs directly from browser RPC via `viem`; `VerifyTransaction` parses QR image uploads (`jsqr`) and checks RPC transaction receipt.

---

## 3. Current Implementation Status

| Capability | Status | Evidence & Reality Check |
|---|---|---|
| ERC-1155 Credit/Debt Tokens & Soulbound Guard | **Implemented** | Verified in `CarbonCreditToken.sol` & `test/CarboCred.test.js`. |
| Marketplace Listing, Lock & Purchase Settlement | **Implemented** | Verified in `CarbonMarketplace.sol` & `test/CarboCred.test.js`. |
| Auto-Offset Debt Retirement on Purchase | **Broken** | `CarbonCreditToken.sol#L241-L247` burns `DEBT_TOKEN` without burning buyer's `CREDIT_TOKEN`. |
| Credit Self-Retirement by Holder | **Not Implemented** | `retireCredits` is `BACKEND_ROLE`-only, emits no custom event, has no backend route or UI. |
| JWT Registration / Login / `/auth/me` | **Implemented** | Verified in `auth.routes.js` & `AuthContext.jsx` (insecure `ADMIN_SEED_KEY` in `start.ps1`). |
| Admin Validation Queue (`CreditRequest`) | **Partially Implemented** | Works sequentially; fails concurrency safety (`approve` race) and bypassed by `/award`, `/debt`, `/clear-debt`. |
| Business Identity Profiles (`EntityProfile`) | **Partially Implemented** | `GET` & `POST` exist; `POST` lacks authentication or wallet ownership signature. |
| Real-time WebSocket Event Feed | **Partially Implemented** | Broadcasts 7 events; lacks WSS reconnect, ignores `AutoOffsetApplied`, and `FeedItem` misrenders trades/clears. |
| User Transaction History | **Broken** | `useUserTransactions.js` + `transactionParser.js` double-count overlapping `TransferSingle` + custom events. |
| Business Carbon Analytics & Trend Chart | **Mocked / Simulated** | `useCarbonAnalytics.js` uses hardcoded `DEFAULT_INPUTS`; `CarbonTrendChart.jsx` fabricates 6-month noise (`1 + i*0.05`). |
| QR Receipt Generation & Transaction Verification | **Partially Implemented** | QR creation works; `useTxVerification.js` validates *any* mined tx on RPC without checking CarboCred contracts or events. |
| Public Emissions Dashboard | **Implemented (Minor Bugs)** | Works without wallet; `computeGlobalStats` caps event sums to 50 recent events; `PublicDashboard` calls `Date.now()` in render. |
| Admin Dashboard Network Overview | **Broken** | `AdminDashboard.jsx` reads undefined `globalStats` keys (`0` rendered) and inverts positive/negative net labels & colors. |
| Backend & Frontend Automated Testing | **Not Implemented** | `0` backend tests, `0` frontend tests, `0` CI workflows. |

---

## 4. Critical Findings

1. **C-01 — Unauthenticated Mint/Debt/Clear Endpoints (`backend/index.js` L139–200) [Confirmed | Critical]:** `POST /award`, `POST /debt`, and `POST /clear-debt` have no JWT or admin guard; omitting `signature` skips all checks in `/award`. Any caller can mint unlimited credits, saddle any victim with soulbound debt, or wipe debt for free.
2. **C-02 — Live Secrets Committed in Tracked `start.ps1` (`start.ps1` L98–102) [Confirmed | Critical]:** Real MongoDB Atlas credentials (`MONGO_URI`), `JWT_SECRET`, and `ADMIN_SEED_KEY` are committed in Git history and overwritten into `backend/.env` on every startup.
3. **C-03 — Smart Contract Auto-Offset Credit Inflation (`contracts/CarbonCreditToken.sol` L214–250; `test/CarboCred.test.js` L249–264) [Confirmed | Critical]:** `settleTransferWithAutoOffset` transfers `100` credits to a buyer with `50` debt and burns `50` debt *without burning `50` credits*, increasing buyer net position by `+150` (`-50` -> `+100`) instead of `+50`.
4. **C-04 — Non-Atomic Approval Race Condition (`backend/src/routes/creditRequest.routes.js` L74–101) [Confirmed | High]:** Reading `status === 'PENDING'` in memory before awaiting an asynchronous blockchain tx lets concurrent `POST /api/requests/:id/approve` calls mint twice.
5. **C-05 — Unauthenticated Business Profile Overwrite (`backend/src/routes/entityProfile.routes.js` L15; `entityProfile.controller.js` L37–60) [Confirmed | High]:** Anyone can compute `sha256(address.toLowerCase())` and overwrite any organization's `businessName`.
6. **C-06 — Broken `AdminDashboard` Stats & Inverted Net Position Badges (`AdminDashboard.jsx` L90–93, L149, L173–179; `MarketplacePage.jsx` L188, L232) [Confirmed | High]:** Three stat cards always show `0` due to mismatched property names; positive net balances (`credits > debt`) are styled red (`🔴 Net-Emitter`) while negative balances (`credits <= debt`) are styled green (`🟢 Net-Negative`).
7. **C-07 — Duplicate Transaction History Rows (`useUserTransactions.js` L87–160; `transactionParser.js` L42–160) [Confirmed | High]:** Fetching both ERC-1155 `TransferSingle` and custom logs from the same tx duplicates every mint, debt, retirement, and trade.
8. **C-08 — Recursive `carbocred: "file:.."` Symlink Loop (`backend/package.json` L12; `frontend/package.json` L15) [Confirmed | High]:** Self-referencing `file:..` creates an infinite nested `node_modules/carbocred/...` path loop that crashes recursive tools on Windows.

---

## 5. Complete Code Quality Findings

- **Bugs & Logical Errors:**
  - `NaN`/`Infinity` passes `Math.floor(Number(amount)) < 1` in `creditRequest.routes.js` L38–39 (`NaN < 1 === false`); malformed `:id` throws Mongoose `CastError` -> 500; `BigInt(amount)` in `index.js` throws 500 on decimals/text.
  - `useTxVerification.js` fails to check `receipt.to` or decode contract logs, accepting unrelated Ethereum transactions.
  - `blockchainReader.js` L165–173 computes global issued totals from the 50-item `recentEvents` slice instead of full logs.
  - `carbonCalculator.js` (kg) vs `carbonAnalyticsEngine.js` (tonnes) causes a `1000×` mismatch; `CarbonTrendChart.jsx` displays synthetic mock noise.
  - `App.jsx` hardcodes `hardhat.id` (`31337`), clears listing forms before tx confirmation, checks `netCredits` instead of `availableNetCredits` (`lockedCredits` ignored), and polls via `setTimeout(..., 3000)`.
  - `AdminDashboard.jsx` L235 calls `fetchPending()` directly during render; `PublicDashboard.jsx` L22 calls `Date.now()` during render.
  - `MarketplacePage.jsx` `FeedItem` L125–142 miscolors `TradeExecuted`/`BalanceUpdated`/`DebtCleared` and reads missing `ev.blockNumber`/`ev.entity`.
- **Dead / Unnecessary Code & Duplication:**
  - Unused `getNetCredits` import in `backend/index.js` L34; unused `backend/src/utils/hashAccountId.js`; unused `Ownable` inheritance on `CarbonMarketplace.sol`; uncalled `settleTransfer` on `CarbonCreditToken.sol`; unused `@yudiel/react-qr-scanner` dependency; obsolete `frontend/next-env.d.ts`; committed `hardhat_error.txt` and `hh_err.txt`.
  - `hashAccountId` duplicated 3× (backend utils, frontend utils, inline in `VerifyTransaction.jsx`); `shortenAddr`/`truncate` duplicated 5×; `BACKEND_URL` + `fetch` boilerplate duplicated 6×; contract ABIs duplicated 5×.
- **Lint & Styling Debt:**
  - `frontend` ESLint reports **29 errors and 1 warning** across 14 files (`react-hooks/immutability`, `set-state-in-effect`, `purity`, `only-export-components`, `__dirname` `no-undef`, unused variables).
  - 4 competing CSS systems (`index.css`, `App.css`, `styles/*.css`, 300-line JS inline style objects, and production `<script src="https://cdn.tailwindcss.com">`); dark-only inline colors break light mode on `VerifyTransaction.jsx`.

---

## 6. Dependency and Deprecation Analysis

*(Full 9-column table in [docs/AUDIT_REPORT.md#6-dependency-deprecation--vulnerability-audit](./docs/AUDIT_REPORT.md#6-dependency-deprecation--vulnerability-audit)).*

- **Immediate Removals (`Low` risk):** `"carbocred": "file:.."` (both `backend/` and `frontend/`), `@yudiel/react-qr-scanner` (`frontend/`), `frontend/next-env.d.ts`, `<script src="https://cdn.tailwindcss.com">`.
- **Critical/High Security Upgrades:**
  - **Backend (`10` advisories: `2` Critical, `6` High):** Upgrade `mongoose` `9.2.1 -> 9.13.1`, `express` `4.22.1 -> 4.22.3` (fixes `proxy-addr` Critical, `body-parser`/`path-to-regexp` High; consider `5.3.0` carefully with async error migration), `ws` `8.19.0 -> 8.23.0`, `ethers` `6.16.0 -> 6.17.0`.
  - **Frontend (`18` advisories: `13` High):** Upgrade `vite` `7.3.1 -> 7.3.8` (dev-server bypasses; avoid rushing `8.4.0` major jump until plugins align), patch transitive `rollup`/`postcss`/`ws`/`zod`/`nanoid` via `npm update`, update React/wagmi/viem/recharts minors (`19.3.1`, `3.7.11`, `2.58.7`, `3.11.1`).
  - **Root (`54` advisories: `1` Critical `handlebars`, `20` High — dev-only):** Keep Hardhat 2.x (`2.30.0`) rather than attempting an invasive ESM rewrite to Hardhat 3 (`3.23.0`); update `@openzeppelin/contracts` `5.4.0 -> 5.6.1`.

---

## 7. Security Analysis

| Attack Scenario | Vulnerable Code | Likelihood & Impact | Mitigation |
|---|---|---|---|
| **Unauthorized Token Mint / Debt Griefing** | `backend/index.js` L139–200 (`/award`, `/debt`, `/clear-debt`) | **Trivial / Critical:** Unauthenticated `POST` mints arbitrary credits or locks victim accounts with soulbound debt. | Delete legacy routes completely; require admin queue + `scripts/seedLocal.js`. |
| **Database Takeover & Admin JWT Forgery** | `start.ps1` L98–102 (`MONGO_URI`, `JWT_SECRET`, `ADMIN_SEED_KEY`) | **Trivial / Critical:** Public Git readers extract Atlas password, forge `ADMIN` JWTs, or register `ADMIN` users. | Rotate all secrets immediately; strip secrets from `start.ps1`; use local DB defaults. |
| **Phantom Credit Creation via Auto-Offset** | `CarbonCreditToken.sol` L214–250 | **Easy / Critical:** Emitter buys credits, gets debt burned for free, and resells 100% of purchased credits. | Burn `debtBurned` of BOTH `DEBT_TOKEN` and `CREDIT_TOKEN` in `settleTransferWithAutoOffset`. |
| **Double-Mint Race Condition** | `creditRequest.routes.js` L74–101 | **Moderate / High:** Concurrent `/approve` requests mint twice before status updates to `APPROVED`. | Atomic `findOneAndUpdate(PENDING -> PROCESSING)` + signer nonce mutex. |
| **Business Profile Spoofing** | `entityProfile.routes.js` L15 | **Easy / High:** Any caller can overwrite any firm's `businessName` using deterministic `sha256(address)`. | Require `requireAuth` + EIP-191 wallet signature verification. |
| **Brute-Force & Header/CORS Abuse** | `backend/index.js` L52–58, `auth.routes.js` | **Moderate / Medium:** Wildcard CORS, no rate limiting on `/auth/login`, no `helmet`, raw `err.message` leaks, `localStorage` JWT XSS target. | Add `helmet`, strict `CORS_ORIGIN`, `express-rate-limit`, centralized safe error responses. |

---

## 8. Performance and Scalability

1. **Confirmed RPC Amplification (`usePublicCarbonData.js`, `useUserTransactions.js`):** Every 30s, the browser scans from block `0` across multiple event signatures in 2000-block chunks, fetches `getBlock` timestamps 1-by-1, and fires `N` individual `/entity/profile/:hash` HTTP calls.
   - *Fix & Benefit:* Record `START_BLOCK` immediately (`P1`), then add an in-process MongoDB `ChainEvent` indexer (`P2`), reducing browser polling from `O(blocks + blocks_M + firms_N)` RPC/HTTP calls to `1` paginated HTTP request (`< 100 ms` local target).
2. **Confirmed Unbounded `getListings(0, nextId)` (`CarbonMarketplace.sol`, `useMarketplace.js`):** O(N) contract call returning every historical fulfilled/cancelled listing forever.
   - *Fix & Benefit:* Reverse-window pagination or backend indexed active listings.
3. **Confirmed Large Vite Bundles (`vite build`):** `main` `747.81 kB` (`227.21 kB` gzip), `usePublicCarbonData` `563.66 kB` (`177.58 kB` gzip).
   - *Fix & Benefit:* Lazy-load `BusinessAnalytics`, `AdminDashboard`, `VerifyTransaction`, `UserTransactions` and configure Rollup `manualChunks` + remove Tailwind CDN.
4. **Confirmed Per-Request Contract Setup (`backend/index.js` L104–115):** Move `new ethers.Contract(...)` out of `GET /position/:address` handler to module scope.

---

## 9. Testing and Reliability

### Executed Checks Summary
- `npx hardhat test` -> **PASS** (`26 passing` in `4s`) — *Note: test L261–263 codifies the buggy auto-offset behavior*.
- `npx hardhat compile` -> **PASS** (`Nothing to compile`, exit 0).
- `node --check` on all 13 backend `.js` files -> **PASS** (`13/13 OK`).
- `cd backend && npm test` -> **FAIL** (`Missing script: "test"`).
- `cd frontend && npm run lint` -> **FAIL** (`30 problems: 29 errors, 1 warning`).
- `cd frontend && npm run build` -> **PASS** (`built in 30.19s`, emitted >500 kB chunk warnings).
- `npm audit --json` across `.`, `backend`, `frontend` -> **COMPLETED** (54 root / 10 backend / 18 frontend vulnerabilities).
- **Unverified:** Live MongoDB Atlas round-trips, interactive MetaMask browser signing, WebSocket event relay under load/disconnect (skipped to preserve read-only audit rules and avoid touching live external DB state).

### Reliability Gaps
- `listener.js` never reconnects if WSS drops; `mongoose.connect` failure is swallowed silently without blocking startup; `backend/index.js` omits `SIGINT` cleanup and DB disconnect; `App.jsx` clears forms before wallet signing and uses `setTimeout(..., 3000)` instead of `waitForTransactionReceipt`.

---

## 10. Product Gap Analysis

1. **Missing "My Requests" User Feedback Loop:** Users submit activity claims into `CreditRequest` (`PENDING`), see a transient message, and have **no page or panel** to check whether their requests are still pending, approved (with `txHash`), or rejected!
2. **Broken Trust Story on Verification & Analytics:** `VerifyTransaction` requires login (`App.jsx` gate) and doesn't verify CarboCred contract logs; `BusinessAnalytics` displays hardcoded fake inputs and fabricated 6-month noise instead of real on-chain history.
3. **Missing Self-Service Retirement & Partial Fills:** Entities holding both credits and debt outside a marketplace purchase cannot retire credits directly from their wallet; buyers must purchase 100% of a listing at once.
4. **Confusing Terminology & Units:** Opposite sign conventions (`credits - debt` on marketplace vs `emissions - mitigation` in analytics) and `kg` vs `tCO₂e` mismatches confuse users.

---

## 11. Personalized Resume-Readiness Assessment

### Criteria Evaluation

| Area | Current Evaluation | Honest Reasoning |
|---|---|---|
| **Problem significance** | **Strong** | Dual-token (`CREDIT` + soulbound `DEBT`) carbon accounting solves a clear real-world market integrity constraint. |
| **Product completeness** | **Weak–Moderate** | Core flows exist, but admin stats, history deduplication, verification, and analytics are broken/mocked; no "My Requests" tracking. |
| **Backend engineering** | **Weak** | Exposed unauthenticated mint routes, race condition in `/approve`, unawaited DB connect, missing validation/rate-limiting, 0 tests. |
| **Database engineering** | **Weak–Moderate** | Mongoose models exist (`User`, `CreditRequest`, `EntityProfile`), but lack ownership relations, atomic state transitions, and event indexing. |
| **System design** | **Moderate** | Good hybrid Web2/Web3 architecture boundary in concept; undermined by client-side `0..latest` RPC polling and non-reconnecting WSS listener. |
| **Security** | **Failing (Critical)** | Leaked Atlas/JWT secrets in `start.ps1`, open `/award`/`/debt`/`/clear-debt`, unauthenticated profile writes, Critical `mongoose`/`proxy-addr` CVEs. |
| **Performance** | **Weak–Moderate** | Client-side O(N) log sweeps and `747 kB` main bundle; easy measurable wins via MongoDB indexer + code splitting. |
| **Reliability** | **Weak** | No WSS reconnect, no tx nonce serialization, `setTimeout(3000)` UI polling, silent DB startup failure. |
| **Testing** | **Weak** | 26 Hardhat tests pass (1 codifying a bug); 0 backend tests; 0 frontend tests; ESLint broken (29 errors). |
| **Deployment** | **Weak** | Windows-only `start.ps1` with hardcoded secrets; outdated Next.js `DEPLOYMENT.md`; no Docker or CI. |
| **Maintainability** | **Weak** | Symlink loop (`carbocred: "file:.."`), 29 lint errors, duplicated helpers, 4 CSS paradigms, stale docs. |
| **Technical depth** | **Moderate -> High Potential** | Strong ERC-1155 + marketplace foundations; becomes genuinely impressive once P0–P2 backend/DB/indexer rigor is implemented. |
| **Demonstrability** | **Not Ready -> High Potential** | Cannot safely demo live today due to broken admin/analytics/history/verification; high demo appeal once fixed. |

### Strongest Technical Identity & Positioning
Position CarboCred as **"A Hybrid EVM (ERC-1155) + Node.js Carbon Registry & Marketplace with Atomic Approval Workflows and an Idempotent Blockchain Event Indexer"** — highlighting systems fundamentals (smart-contract invariants, concurrency control, idempotent event ingestion, and RPC-to-DB caching) rather than generic "Web3 + MERN CRUD".

### Top 5 Improvements with Greatest Resume Impact
1. **Fix `settleTransferWithAutoOffset` 1:1 Accounting + Invariant Tests (`P0-3`):** Shows you understand domain invariants, ERC-1155 callbacks, and financial correctness—not just copy-pasting OpenZeppelin templates.
2. **Atomic `CreditRequest` Approval State Machine + Signer Nonce Queue (`P0-4`):** Directly demonstrates database concurrency control (`PENDING -> PROCESSING -> APPROVED`), idempotency across DB + external blockchain side effects, and crash recovery.
3. **Incremental MongoDB Blockchain Event Indexer + Reconnecting Listener (`P2-3`):** Demonstrates real backend/systems architecture—solving client RPC `eth_getLogs` fan-out via block-checkpointed ingestion (`SyncState`), unique `(chainId, txHash, logIndex)` deduplication, and reorg-safe replay.
4. **End-to-End Security Hardening + EIP-191 Wallet Binding (`P0-1`, `P0-2`, `P0-5`, `P2-1`):** Eliminating backdoors, rotating secrets, binding Web2 JWTs to Web3 wallets via cryptographic signatures, and passing `npm audit` demonstrates production security awareness.
5. **Multi-Layer Automated Test Matrix + GitHub Actions CI + Bundle Optimization (`P2-2`, `P2-4`):** Proves engineering discipline across Solidity, Express API concurrency tests, and React/Vite performance metrics.

### Skills & Concepts to Learn While Implementing
- **Database Concurrency & Idempotency:** Atomic `findOneAndUpdate` state locks vs read-modify-write races; handling two-phase commits/sagas between MongoDB and irreversible blockchain transactions.
- **Blockchain Indexing & Reorg Handling:** Block checkpointing, `eth_getLogs` chunking limits, compound unique indexes for idempotent log ingestion.
- **Smart Contract Security & Tokenomics Invariants:** Conservation laws in `settleTransferWithAutoOffset`, CEI ordering around ERC-1155 `onERC1155Received` hooks, and pull vs push ETH settlement.
- **Web2/Web3 Auth Bridging:** EIP-191 `personal_sign` challenge-response nonces (`ethers.verifyMessage`), rate limiting, CORS/Helmet, and secret management.
- **Testing & Performance Profiling:** `node:test` + `supertest` concurrency tests, Vitest mocking, and Vite/Rollup chunk analysis.

### Demonstration Strategy & Measurable Experiments (To Collect *After* Fixes)
Never invent benchmarks. Once **P0–P2** are implemented, run and record these reproducible local experiments:
1. **Concurrency Test Proof:** Script sending 10 parallel `POST /api/requests/:id/approve` requests -> record exact `1 × 200` + `9 × 409` counts and `1` on-chain tx.
2. **Indexer Latency Benchmark:** Seed 200+ on-chain transactions across Hardhat blocks -> compare browser `PublicDashboard` load time & RPC request count *before* (direct `viem` `getLogs` sweeps) vs *after* (indexed `/api/events/firms` endpoint) using Chrome DevTools / `autocannon`.
3. **Bundle Size Comparison:** Compare `vite build` output before (`747.81 kB` main chunk) and after `React.lazy` + `manualChunks`.
4. **Resilience Demo:** Kill and restart local Hardhat/WSS connection while submitting a tx -> show `ChainSyncService` recovering missed events via `SyncState` checkpointing.

### Sample Resume Description (Verified Current vs Post-Roadmap Target)
- **Honest Description of Current Verified Capabilities (only after fixing P0 blockers before listing!):**
  > Built a full-stack carbon credit registry and P2P marketplace using **Solidity (ERC-1155)**, **Express/MongoDB**, and **React/wagmi**, featuring soulbound emission debt tokens, listing-lock double-sell guards, JWT-authenticated admin approval workflows, and 26 Hardhat unit tests.
- **Target Description (After Completing P0–P2 Roadmap):**
  > Architected **CarboCred**, an ERC-1155 carbon offset registry and marketplace backed by **Node.js/Express**, **MongoDB**, and **React/Vite**; eliminated double-mint race conditions with atomic `PROCESSING` state locks and nonce serialization, enforced 1:1 on-chain debt retirement invariants, and replaced full-chain browser `eth_getLogs` polling with an idempotent block-checkpointed MongoDB event indexer verified by automated contract, API concurrency, and UI test suites in GitHub Actions CI.

---

## 12. Remove, Update, Add, Refactor and Keep

| Category | Item | Current Situation | Recommended Action | Reason | Priority |
|---|---|---|---|---|---|
| **Remove** | Legacy `/award`, `/debt`, `/clear-debt` routes (`backend/index.js`) | Open unauthenticated mint/debt endpoints | Delete all 3 HTTP routes | Bypasses admin approval; critical exploit vector | **P0** |
| **Remove** | Hardcoded Atlas/JWT/Seed secrets (`start.ps1`) | Live credentials committed in Git | Strip secrets & rotate externally | Critical credential exposure | **P0** |
| **Remove** | `"carbocred": "file:.."` (`backend/` & `frontend/package.json`) | Self-symlink causes infinite loop | Uninstall from both packages | Crashes recursive directory scans on Windows | **P1** |
| **Remove** | `@yudiel/react-qr-scanner`, `frontend/next-env.d.ts`, `hardhat_error.txt`, `hh_err.txt` | Unused/obsolete/temp files tracked in Git | Delete files & uninstall package | Dead bloat and misleading Next.js artifact | **P1** |
| **Remove** | `<script src="https://cdn.tailwindcss.com">` (`frontend/index.html`) | Render-blocking external compiler CDN | Remove CDN; unify on `--obs-*` CSS | Production reliability, theme consistency, performance | **P2** |
| **Update** | `mongoose` (`9.2.1`), `express` (`4.22.1`), `ws` (`8.19.0`), `vite` (`7.3.1`) | Critical/High CVEs in `npm audit` | Patch (`9.13.1`, `4.22.3`, `8.23.0`, `7.3.8`) | Eliminates known prototype pollution, ReDoS & DoS CVEs | **P2** |
| **Update** | `CarbonCreditToken.settleTransferWithAutoOffset` | Burns buyer debt without burning buyer credits | Burn `debtBurned` of BOTH `DEBT` and `CREDIT` | Fixes phantom carbon credit inflation bug | **P0** |
| **Update** | `README.md`, `DEPLOYMENT.md`, `.env.example`, `.agent/workflows/test.md` | Outdated Next.js 15 / missing test script docs | Rewrite to match Vite + Express + MongoDB + actual commands | Accurate onboarding and evaluator documentation | **P1/P2** |
| **Add** | Atomic `PROCESSING` lock + nonce mutex (`creditRequest.routes.js`, `signer.js`) | Non-atomic read-then-mint | `findOneAndUpdate(PENDING->PROCESSING)` + tx mutex | Prevents concurrent double-minting & nonce collisions | **P0** |
| **Add** | EIP-191 wallet ownership auth on `POST /entity/profile` & `/api/requests` | Unauthenticated profile overwrites & unlinked wallets | Verify `ethers.verifyMessage` signature / bound wallet | Prevents impersonation and cross-user claim spam | **P0** |
| **Add** | Backend (`node:test` + `supertest`) & Frontend (`vitest`) tests + CI | 0 backend/FE tests; `npm test` fails | Build test suites + `.github/workflows/ci.yml` | Verifies concurrency, auth, parsers, and prevents regressions | **P2** |
| **Add** | MongoDB incremental `ChainEvent` indexer + WSS reconnect (`listener.js`) | Genesis `eth_getLogs` scan every 30s; silent WSS drop | Persist events by `(chainId, txHash, logIndex)` + reconnect | Fixes scalability bottleneck & live-feed reliability | **P2** |
| **Add** | `"My Requests"` user tracking view & public `/verify` access | Users can't see pending/rejected claim status | Add `GET /api/requests/mine` + UI panel + public `/verify` | Completes core user & verifier workflows | **P1** |
| **Refactor** | `AdminDashboard.jsx`, `MarketplacePage.jsx`, `blockchainReader.js` | Undefined stat keys (`0`), inverted net signs, 50-event cap | Align property names, fix `net >= 0` green, sum all logs | Restores factual admin metrics & color semantics | **P1** |
| **Refactor** | `useUserTransactions.js` & `transactionParser.js` | Duplicates `TransferSingle` + custom logs | Deduplicate by tx semantic role; chain-aware explorer link | Accurate transaction ledger and summaries | **P1** |
| **Refactor** | `carbonCalculator.js`, `carbonAnalyticsEngine.js`, `CarbonTrendChart.jsx` | `kg` vs `tCO₂e` mismatch + mocked noise trend | Unify units; plot real event history + label simulator | Eliminates misleading fabricated analytics | **P1** |
| **Refactor** | `useTxVerification.js`, `VerifyTransaction.jsx`, shared `apiClient` & ESLint fixes | Accepts non-CarboCred txs; 29 ESLint errors | Decode CarboCred contract logs; clean ESLint to 0 errors | Real verification + clean maintainable codebase | **P1** |
| **Keep** | ERC-1155 dual-token design, `lockedCredits`, CEI settlement, `ReentrancyGuard` | Sound core smart-contract patterns | Keep architecture (after fixing `settleTransferWithAutoOffset` & removing unused `Ownable`) | Avoids unnecessary rewrite of solid primitives | — |
| **Keep** | Single-process Express + Mongoose + Vite modular monolith | Appropriately sized for solo dev | Keep monolith architecture (reject microservices/K8s/Kafka) | Maximizes maintainability and zero-cost hosting fit | — |

---

## 13. Recommended Feature Roadmap (With Architectural Justification)

1. **Atomic Claim Audit + User Request Tracker (`P0-4` + `P1-6`):**
   - *Problem:* Admins can double-mint on double-click; users have zero visibility after submitting claims.
   - *Changes:* Backend `PROCESSING` lock + `GET /api/requests/mine`; MongoDB `submittedBy`/`reviewedBy`/`rejectionReason`; Frontend status badges in Marketplace tab. *Complexity:* `M`. *Demo:* Show concurrent approval blocked with `409` and user seeing `PENDING -> APPROVED` with live tx link.
2. **Cryptographic Wallet Binding & Authenticated Profiles (`P0-5` + `P3-1`):**
   - *Problem:* Web2 JWT accounts and Web3 wallets are unlinked, leaving `POST /entity/profile` open to spoofing.
   - *Changes:* `GET /auth/nonce`, `POST /auth/link-wallet`, signature check on `POST /entity/profile`; Frontend `useEntityProfile` signs message via `wagmi` `useSignMessage`. *Complexity:* `M`. *Demo:* Show MetaMask personal signature linking wallet to account and blocking unauthorized profile edits.
3. **Contract-Aware Public QR Verification (`P1-5` + `P3-1`):**
   - *Problem:* Current verification confirms *any* random transaction on Ethereum without validating CarboCred contracts or credit amounts, and sits behind login.
   - *Changes:* Frontend `useTxVerification` decodes `TradeExecuted`/`CreditsAwarded`/`DebtCleared` logs against `CONTRACT_ADDRESSES`; move `/verify` outside login gate. *Complexity:* `M`. *Demo:* Scan downloaded PNG QR in incognito window -> show exact verified seller, buyer, credit count, and rejection of an unrelated ETH tx.
4. **Incremental Blockchain Event Indexer (`P2-3`):**
   - *Problem:* Client `eth_getLogs` sweeps from block `0` break on public testnets and overload RPC nodes.
   - *Changes:* Backend `ChainEvent` + `SyncState` models, `chainSync.js` service, paginated `/api/events/*` routes; Frontend hooks consume indexed API. *Complexity:* `L`. *Demo:* Kill backend, mint on Hardhat, restart backend -> show missed block auto-indexed without duplicates.
5. **1:1 Auto-Offset Fix, Self-Service Credit Retirement & Partial Fills (`P0-3` + `P3-2`):**
   - *Problem:* Broken buyer debt math, backend-only `retireCredits`, all-or-nothing listing purchases.
   - *Changes:* Fix `settleTransferWithAutoOffset`, add `retireOwnCredits(amount)` + `purchasePartial(listingId, amount)` in Solidity + tests + UI controls. *Complexity:* `L`. *Demo:* Live Hardhat test/UI walkthrough showing buyer with `-50` debt buying `80` of a `100`-credit listing and ending cleanly at `+30` net.

---

## 14. Engineering Improvement Roadmap

- **Phase A (`P0`):** Security emergency lockdown (rotate secrets, clean `start.ps1`, delete `/award`/`/debt`/`/clear-debt`, fix `settleTransferWithAutoOffset`, lock `approve` race condition, protect `POST /entity/profile`).
- **Phase B (`P1`):** Repo hygiene (remove `carbocred: "file:.."` & dead deps/files) + fix all confirmed UI/domain bugs (`AdminDashboard`, `UserTransactions`, `VerifyTransaction`, `carbonCalculator`/`carbonAnalyticsEngine`, dynamic `VITE_CHAIN_ID`, 29 ESLint errors).
- **Phase C (`P2`):** Hardening & scale (`helmet`, `cors`, `zod`, `express-rate-limit`, `pino`, `/ready`, graceful `SIGINT`/`SIGTERM`, dependency CVE patches, backend + frontend test suites, GitHub Actions CI, MongoDB `ChainEvent` indexer, Vite bundle splitting, Tailwind CDN removal, accurate docs).
- **Phase D (`P3`–`P4`):** Wallet linking, partial fills, self-retirement, Docker Compose, CSV export, Sepolia deployment.

---

## 15. Learning Roadmap (Tied Directly to Repository Changes)

| Concept | Why It Matters Here | Concrete Task in CarboCred |
|---|---|---|
| **Concurrency Control & Idempotency** | Prevents double-spending real on-chain assets during slow external I/O | `P0-4`: Atomic MongoDB `findOneAndUpdate(PENDING -> PROCESSING)` + EOA tx nonce mutex in `signer.js` |
| **Smart Contract Invariants & CEI / Hook Safety** | Prevents accounting inflation & callback exploits | `P0-3`: 1:1 `CREDIT_TOKEN` + `DEBT_TOKEN` burn in `settleTransferWithAutoOffset` & `onERC1155Received` ordering |
| **Event Sourcing / Incremental Indexing** | Replaces naive `O(blocks)` client RPC sweeps with `O(1)` indexed queries | `P2-3`: Block-checkpointed `chainSync.js` with `(chainId, txHash, logIndex)` unique key in MongoDB |
| **Cryptographic Auth Bridging (EIP-191)** | Proves wallet ownership without trusting user-supplied address strings | `P0-5` / `P3-1`: Challenge nonce + `ethers.verifyMessage` binding `User` to `EntityProfile` |
| **API Security & Input Validation** | Closes real OWASP gaps (`Broken Access Control`, `Injection`, `DoS`) | `P0-2`, `P2-1`: Schema validation (`zod`), `helmet`, rate limiting, CVE patching |
| **Multi-Layer Automated Testing & CI** | Replaces manual clicking with verifiable guarantees | `P2-2`: Hardhat invariants + `supertest` concurrent API tests + Vitest unit/UI tests in GitHub Actions |
| **Frontend Performance & Build Tooling** | Diagnoses real `747 kB` chunk bloat via Rollup bundle inspection | `P2-4`: `React.lazy`, `manualChunks`, removing external Tailwind CDN |

---

## 16. Interview Preparation

### Important Architectural Decisions to Explain
1. **Why ERC-1155 (`CREDIT` ID `0` + soulbound `DEBT` ID `1`) instead of two ERC-20s or an off-chain DB ledger?** Single contract atomic `getPosition`, `netCredits` marketplace gate, native `_update` hook soulbound enforcement, and clean extensibility to vintage token IDs (`2`, `3`, ...) without deploying new contracts.
2. **Why `MARKETPLACE_ROLE` + `lockedCredits` instead of `setApprovalForAll`?** Minimizes approval phishing surface; trade-off is potential desync if seller transfers `CREDIT_TOKEN` out-of-band directly (mitigable via lock-aware `_update` check or escrow).
3. **Why a modular monolith + MongoDB indexer instead of The Graph or Kafka microservices?** Solo-developer maintainability, zero paid infrastructure beyond free-tier MongoDB Atlas + Node host, while still solving RPC `eth_getLogs` fan-out cleanly.

### Potential Technical Interview Questions
- *"Walk me through what happens if two admins click Approve at the exact same millisecond, or if the backend crashes right after sending the Ethereum transaction."* -> Explain `PENDING -> PROCESSING` atomic transition, persisting `txHash` immediately upon broadcast, and startup reconciliation against on-chain logs/receipts.
- *"How do you guarantee a net-emitter cannot dump credits while owing debt?"* -> Explain `lockedCredits` + `netCredits` check at `listCredits()` time *and* live re-validation at `purchaseListing()` time, plus why auto-offset must burn both `DEBT_TOKEN` and `CREDIT_TOKEN`.
- *"Why did your React public dashboard struggle on a real testnet, and how did you fix it?"* -> Explain `eth_getLogs` block-range chunk limits, N+1 `getBlock`/`profile` requests, and moving to a backend block-checkpointed `ChainEvent` projection.
- *"How do you keep business names off-chain while linking them securely to public Ethereum addresses?"* -> Explain deterministic SHA-256 pseudonymization limitations (linkable via public addresses) and EIP-191 challenge-response signatures preventing unauthorized profile overwrites.

---

## 17. Final Implementation Order

Execute strictly in this order (`docs/TASKS.md` tracks exact checkboxes):
1. **Rotate Atlas password, `JWT_SECRET`, `ADMIN_SEED_KEY` externally** -> sanitize `start.ps1` + remove tracked `.txt` error dumps (`M0.1`).
2. **Delete `/award`, `/debt`, `/clear-debt`** + add `scripts/seedLocal.js` (`M0.2`).
3. **Remove `"carbocred": "file:.."`** + `@yudiel/react-qr-scanner` + `next-env.d.ts` + fix `.env.example` files (`M0.3`).
4. **Fix `settleTransferWithAutoOffset` 1:1 burn + `retireOwnCredits` + update `CarboCred.test.js`** (`M1.1`).
5. **Make `CreditRequest` approval atomic + nonce mutex + input validation** (`M2.1`).
6. **Protect `POST /entity/profile` + remove `ADMIN_SEED_KEY` public elevation** (`M2.2`).
7. **Fix `AdminDashboard` stats/signs/effect + `UserTransactions` deduplication + `VerifyTransaction` decoding + carbon unit alignment + ESLint 0 errors** (`M3.1`–`M3.5`).
8. **Patch CVEs (`mongoose`, `express`, `ws`, `vite`) + add `helmet`/rate-limit/`pino`/`/ready`** (`M2.3`).
9. **Add Backend & Frontend test suites + GitHub Actions CI** (`M4.1`).
10. **Build MongoDB `ChainEvent` indexer + WSS auto-reconnect** (`M4.2`).
11. **Remove Tailwind CDN, add code splitting, rewrite `README.md` & `DEPLOYMENT.md`** (`M4.3`).
12. **Add partial fills & Docker Compose (`P3`) + collect real benchmarks for resume** (`M4.4`).

---

## 18. Final Verdict

1. **What is the project's current engineering quality?**
   **Low-to-Moderate prototype quality.** The Solidity contracts show genuine domain thought (`lockedCredits`, CEI, soulbound debt), yet the overall codebase suffers from critical security leaks, broken financial/UI math, duplicated code, a self-referential symlink bug, 29 ESLint errors, and zero backend/frontend tests.
2. **What are its biggest weaknesses?**
   Leaked Atlas/JWT secrets in `start.ps1`, open `/award`/`/debt`/`/clear-debt` endpoints, phantom credit inflation in `settleTransferWithAutoOffset`, non-atomic approval double-minting, broken `AdminDashboard`/`UserTransactions`/`BusinessAnalytics`/`VerifyTransaction` accuracy, and lack of automated tests outside Hardhat.
3. **What are the most valuable changes?**
   Completing **P0** (secret rotation, removing backdoors, fixing auto-offset math, atomic approvals, authenticated profiles), **P1** (fixing admin/history/analytics/verification bugs and ESLint), and **P2** (tests + CI + MongoDB incremental blockchain indexer).
4. **Which features should NOT be added?**
   Do **not** add microservices, Kubernetes, Kafka, Redis, The Graph nodes, multi-chain bridges, fiat/Stripe billing, or AI chatbots—every one of those adds operational bloat without solving CarboCred's actual bottlenecks.
5. **What is the minimum work necessary to make it resume-ready?**
   Complete **Milestones 0, 1, 2, 3, plus `M4.1` (tests + CI) and `M4.3` (accurate docs + clean build)**—meaning zero leaked secrets, working end-to-end flows with real math, clean lint, and passing tests across all 3 layers.
6. **What would make it stand out as a technically strong project?**
   Shipping **`M4.2` (the idempotent MongoDB blockchain event indexer + WSS reconnect)** alongside **atomic `CreditRequest` concurrency guarantees**, **1:1 contract invariant tests**, and **real measured before/after RPC & bundle benchmarks**—giving you concrete systems engineering depth to defend in any backend or full-stack interview.
