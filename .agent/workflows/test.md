---
description: how to run project tests
---

### Smart Contract Tests
1. From the root directory, run:
```bash
npx hardhat test
```

### Backend Tests
1. Navigate to the backend directory:
```bash
cd backend
```
2. Run the test suite:
```bash
npm test
```

### Frontend Verification
1. Start the local dev environment (see `local-dev.md`).
2. Navigate to `http://localhost:3000`.
3. Verify that the "Live Feed" is receiving events and the balance updates after a trade.
