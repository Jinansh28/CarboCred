---
description: how to deploy contracts to the Sepolia testnet
---

1. Configure your root `.env` file with your `DEPLOYER_PRIVATE_KEY` and `SEPOLIA_RPC_URL`.
2. Deploy the contracts:
```bash
npx hardhat run scripts/deploy.js --network sepolia
```
3. Copy the `CarbonCreditToken` and `CarbonMarketplace` addresses from the console output.
4. Update `backend/.env` with the new addresses and the Sepolia WebSocket RPC URL.
5. Update `frontend/.env` with the new addresses and set `VITE_CHAIN_ID=11155111`.
6. Use the Hardhat console or a script to grant the `BACKEND_ROLE` to your backend wallet address if it differs from the deployer.
7. Restart the backend and rebuild the frontend.
