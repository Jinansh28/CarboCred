# ============================================================
# CarboCred Startup Script
# Run this ONE script to start the entire local dev stack.
# ============================================================

$ErrorActionPreference = "Stop"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

function Stop-PortListeners {
    param([int[]]$Ports)
    $pidsToStop = Get-NetTCPConnection -LocalPort $Ports -State Listen -ErrorAction SilentlyContinue |
        Select-Object -ExpandProperty OwningProcess -Unique |
        Where-Object { $_ -gt 4 }

    foreach ($procId in $pidsToStop) {
        Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
        Write-Host "   Stopped PID $procId"
    }
    return [bool]$pidsToStop
}

function Wait-ForPort {
    param(
        [int]$Port,
        [int]$TimeoutSeconds = 30
    )
    for ($i = 1; $i -le $TimeoutSeconds; $i++) {
        Start-Sleep -Seconds 1
        if (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue) {
            return $i
        }
    }
    return $null
}

function New-RandomHex {
    param([int]$ByteLength = 32)
    $bytes = New-Object byte[] $ByteLength
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try {
        $rng.GetBytes($bytes)
    } finally {
        $rng.Dispose()
    }
    return ($bytes | ForEach-Object { $_.ToString("x2") }) -join ""
}

function Read-EnvFile {
    param([string]$Path)
    $values = @{}
    if (-not (Test-Path $Path)) { return $values }

    foreach ($rawLine in Get-Content $Path) {
        $line = $rawLine.Trim()
        if ($line -and -not $line.StartsWith("#") -and $line -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$') {
            $val = $matches[2].Trim()
            if ($val.Length -ge 2 -and (
                ($val.StartsWith('"') -and $val.EndsWith('"')) -or
                ($val.StartsWith("'") -and $val.EndsWith("'"))
            )) {
                $val = $val.Substring(1, $val.Length - 2)
            }
            $values[$matches[1]] = $val
        }
    }
    return $values
}

function Get-ConfigValue {
    param(
        [hashtable]$Existing,
        [string]$Key,
        [scriptblock]$Fallback
    )
    if (-not [string]::IsNullOrWhiteSpace($Existing[$Key])) {
        return $Existing[$Key]
    }
    return & $Fallback
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "   CarboCred Local Dev Startup" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# ── Step 1: Clear stale processes on stack ports ─────────────────────────────
Write-Host "[1/6] Clearing stale processes on ports 4000, 3000, 8545..." -ForegroundColor Yellow
if (Stop-PortListeners -Ports @(4000, 3000, 8545)) {
    Start-Sleep -Seconds 1
}
Write-Host "   Done." -ForegroundColor Green

# ── Step 2: Start fresh Hardhat node ─────────────────────────────────────────
$addressesPath = Join-Path $scriptDir "addresses.json"
if (Test-Path $addressesPath) {
    Remove-Item $addressesPath -Force
    Write-Host "   Removed stale addresses.json"
}

Write-Host "[2/6] Starting Hardhat node..." -ForegroundColor Yellow
Start-Process powershell -WorkingDirectory $scriptDir -ArgumentList "-NoExit", "-Command", "npx hardhat node" -WindowStyle Normal

Write-Host "   Waiting for Hardhat RPC to be ready..."
$hardhatElapsed = Wait-ForPort -Port 8545 -TimeoutSeconds 30
if (-not $hardhatElapsed) {
    Write-Host "ERROR: Hardhat node did not start within 30 seconds. Aborting." -ForegroundColor Red
    exit 1
}
Write-Host "   Hardhat node is up on :8545 (took ~${hardhatElapsed}s)" -ForegroundColor Green

# ── Step 3: Deploy contracts and capture addresses ───────────────────────────
Write-Host "[3/6] Deploying contracts..." -ForegroundColor Yellow
Push-Location $scriptDir
try {
    npx hardhat run scripts/getAddresses.js --network localhost
} finally {
    Pop-Location
}

if (-not (Test-Path $addressesPath)) {
    Write-Host "ERROR: Deployment failed - addresses.json was not created." -ForegroundColor Red
    Write-Host "       Check the Hardhat window for contract errors." -ForegroundColor Red
    exit 1
}

$addresses = Get-Content $addressesPath | ConvertFrom-Json
$token = $addresses.tokenAddress
$market = $addresses.marketplaceAddress

if (-not $token -or -not $market) {
    Write-Host "ERROR: addresses.json is missing tokenAddress or marketplaceAddress." -ForegroundColor Red
    exit 1
}

Write-Host "   Token:       $token" -ForegroundColor Green
Write-Host "   Marketplace: $market" -ForegroundColor Green

# ── Step 4: Sync .env files ──────────────────────────────────────────────────
Write-Host "[4/6] Syncing .env files..." -ForegroundColor Yellow

$backendEnvPath = Join-Path $scriptDir "backend\.env"
$existingBackendEnv = Read-EnvFile -Path $backendEnvPath

$mongoUri = Get-ConfigValue -Existing $existingBackendEnv -Key "MONGO_URI" -Fallback {
    if (-not [string]::IsNullOrWhiteSpace($env:MONGO_URI)) { $env:MONGO_URI } else { "mongodb://127.0.0.1:27017/carbocred" }
}
$jwtSecret = Get-ConfigValue -Existing $existingBackendEnv -Key "JWT_SECRET" -Fallback { New-RandomHex -ByteLength 48 }
$adminSeedKey = Get-ConfigValue -Existing $existingBackendEnv -Key "ADMIN_SEED_KEY" -Fallback { New-RandomHex -ByteLength 24 }

$backendEnv = @"
RPC_URL=ws://127.0.0.1:8545
BACKEND_PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
CARBON_CREDIT_TOKEN_ADDRESS=$token
MARKETPLACE_ADDRESS=$market
PORT=4000
MONGO_URI=$mongoUri

# Auth
JWT_SECRET=$jwtSecret
ADMIN_SEED_KEY=$adminSeedKey
"@
Set-Content -Path $backendEnvPath -Value $backendEnv

$frontendEnv = @"
VITE_CARBON_CREDIT_TOKEN_ADDRESS=$token
VITE_MARKETPLACE_ADDRESS=$market
VITE_BACKEND_WS_URL=ws://localhost:4000
VITE_CHAIN_ID=31337
"@
Set-Content -Path (Join-Path $scriptDir "frontend\.env") -Value $frontendEnv

Write-Host "   backend/.env  updated"
Write-Host "   frontend/.env updated"

# ── Step 5: Start Backend & seed test credits ────────────────────────────────
Write-Host "[5/6] Starting Backend server..." -ForegroundColor Yellow
Start-Process powershell -WorkingDirectory (Join-Path $scriptDir "backend") -ArgumentList "-NoExit", "-Command", "node index.js" -WindowStyle Normal

Write-Host "   Waiting for backend API to be ready..."
$backendElapsed = Wait-ForPort -Port 4000 -TimeoutSeconds 20
if ($backendElapsed) {
    Write-Host "   Backend is up on :4000 (took ~${backendElapsed}s)" -ForegroundColor Green
} else {
    Write-Host "   Warning: Backend not responding yet - continuing anyway." -ForegroundColor DarkYellow
}

Write-Host "   Awarding 1000 test credits to Account #0..." -ForegroundColor Cyan
try {
    Invoke-WebRequest -Uri "http://localhost:4000/award" `
        -Method POST `
        -ContentType "application/json" `
        -Body '{"entity":"0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266","amount":1000,"reason":"Test credits"}' `
        -UseBasicParsing | Out-Null
    Write-Host "   1000 credits awarded to Account #0!" -ForegroundColor Green
} catch {
    Write-Host "   Warning: Could not award credits now. Use the API later." -ForegroundColor DarkYellow
}

# ── Step 6: Start Frontend ───────────────────────────────────────────────────
Write-Host "[6/6] Starting Frontend..." -ForegroundColor Yellow
Start-Process powershell -WorkingDirectory (Join-Path $scriptDir "frontend") -ArgumentList "-NoExit", "-Command", "npm run dev" -WindowStyle Normal

# ── Done ─────────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "   CarboCred is running!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
Write-Host "   Frontend:  http://localhost:3000" -ForegroundColor Cyan
Write-Host "   Backend:   http://localhost:4000" -ForegroundColor Cyan
Write-Host "   Hardhat:   http://127.0.0.1:8545" -ForegroundColor Cyan
Write-Host ""
Write-Host "   Account #0 has 1000 test credits and 10,000 ETH" -ForegroundColor Green
Write-Host "   Private Key: 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" -ForegroundColor DarkGray
Write-Host ""
Write-Host "   IMPORTANT: Always use THIS script to start the app." -ForegroundColor Yellow
Write-Host "   IMPORTANT: Reset MetaMask account after each restart." -ForegroundColor Yellow
Write-Host ""
