---
description: how to start the local development environment
---

// turbo-all
1. Ensure MongoDB is running locally on port 27017.
2. Run the master startup script from the root directory:
```powershell
powershell -ExecutionPolicy Bypass -File .\start.ps1
```
3. Once the script completes:
   - Access the Frontend at `http://localhost:3000`
   - Access the Backend API at `http://localhost:4000`
   - The Hardhat node will be running at `http://127.0.0.1:8545`
4. **IMPORTANT**: In MetaMask, clear your account activity (Settings -> Advanced -> Clear activity tab data) to reset nonces for the local node.
