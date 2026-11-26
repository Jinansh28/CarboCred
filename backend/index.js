/**
 * index.js — CarboCred Backend Server
 *
 * Architecture:
 *   ┌─────────────────────────────────────────────────┐
 *   │  Ethereum RPC (Alchemy/Infura WSS)              │
 *   │         ↓  contract events                      │
 *   │  listener.js  ──→  broadcast()                  │
 *   │                        ↓                        │
 *   │  WebSocket Server  (ws://:4000)                 │
 *   │    → all connected frontend clients             │
 *   │                                                 │
 *   │  HTTP REST API  (http://:4000)                  │
 *   │    POST /auth/register    → create account      │
 *   │    POST /auth/login       → returns JWT         │
 *   │    GET  /auth/me          → current user        │
 *   │    GET  /position/:address → on-chain read      │
 *   │    POST /api/requests      → queue (auth)       │
 *   │    GET  /api/requests/pending → admin only      │
 *   │    POST /api/requests/:id/approve → admin only  │
 *   └─────────────────────────────────────────────────┘
 *
 * No mutable state is stored locally for balances.
 * All reads go directly to the blockchain.
 */

import dotenv from "dotenv";
import express from "express";
import fs from "fs";
import http from "http";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { WebSocketServer } from "ws";
import { ethers } from "ethers";
import mongoose from "mongoose";
import { startListeners, stopListeners } from "./listener.js";
import { getProvider } from "./signer.js";
import authRoutes from "./src/routes/auth.routes.js";
import entityProfileRoutes from "./src/routes/entityProfile.routes.js";
import creditRequestRoutes from "./src/routes/creditRequest.routes.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, ".env") });

const PORT = process.env.PORT || 4000;

// ── Express HTTP server ───────────────────────────────────────────────────
export const app = express();
export const server = http.createServer(app);

// ── Database ──────────────────────────────────────────────────────────────
export async function connectDatabase(uri = process.env.MONGO_URI) {
    if (!uri) {
        console.warn("[DB] MONGO_URI not set; skipping MongoDB connection");
        return null;
    }
    try {
        const conn = await mongoose.connect(uri);
        console.log("[DB] Connected to MongoDB");
        return conn;
    } catch (err) {
        console.error("[DB] Connection error:", err.message);
        return null;
    }
}

app.use(express.json());

// CORS — allow all origins (dev mode)
app.use((req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    if (req.method === "OPTIONS") return res.sendStatus(204);
    next();
});

// ── WebSocket server ──────────────────────────────────────────────────────
export const wss = new WebSocketServer({ server });
const clients = new Set();

wss.on("connection", (ws, req) => {
    clients.add(ws);
    console.log(`[WS] Client connected. Total: ${clients.size}`);

    ws.send(JSON.stringify({ type: "connected", message: "CarboCred live feed active" }));

    ws.on("close", () => {
        clients.delete(ws);
        console.log(`[WS] Client disconnected. Total: ${clients.size}`);
    });
});

/**
 * Broadcast a parsed blockchain event to all connected WebSocket clients.
 * @param {object} eventData  Structured event object from listener.js.
 */
export function broadcast(eventData) {
    const payload = JSON.stringify(eventData);
    for (const client of clients) {
        if (client.readyState === 1 /* OPEN */) {
            client.send(payload);
        }
    }
}

// ── REST API ──────────────────────────────────────────────────────────────

/**
 * GET /position/:address
 * Read the on-chain credit/debt position of an entity.
 * Returns: { credits, debt, netCredits }
 * No local database — reads directly from CarbonCreditToken.
 */
app.get("/position/:address", async (req, res) => {
    try {
        const { address } = req.params;
        if (!ethers.isAddress(address)) {
            return res.status(400).json({ error: "Invalid Ethereum address" });
        }

        const CREDIT_TOKEN_ABI = [
            "function getPosition(address) view returns (uint256 credits, uint256 debt)",
            "function netCredits(address) view returns (int256)",
        ];
        const provider = getProvider();
        const contract = new ethers.Contract(
            process.env.CARBON_CREDIT_TOKEN_ADDRESS,
            CREDIT_TOKEN_ABI,
            provider
        );

        const [credits, debt] = await contract.getPosition(address);
        const net = await contract.netCredits(address);

        res.json({
            address,
            credits: credits.toString(),
            debt: debt.toString(),
            netCredits: net.toString(),
        });
    } catch (err) {
        console.error("[API] /position error:", err.message);
        res.status(500).json({ error: err.message });
    }
});

// ── Auth Routes ───────────────────────────────────────────────────────────
app.use("/auth", authRoutes);

// ── Identity Routes ───────────────────────────────────────────────────────
app.use("/entity", entityProfileRoutes);

// ── Credit Request Routes (Admin Validation Workflow) ─────────────────────
app.use("/api/requests", creditRequestRoutes);

// ── Health check ──────────────────────────────────────────────────────────
app.get("/health", (_req, res) => res.json({ status: "ok" }));

// ── Start ─────────────────────────────────────────────────────────────────
export function startServer(port = PORT) {
    server.listen(port, () => {
        console.log(`\n🌿 CarboCred backend running`);
        console.log(`   HTTP  → http://localhost:${port}`);
        console.log(`   WS    → ws://localhost:${port}\n`);
        startListeners(broadcast);
    });

    process.on("SIGTERM", async () => {
        console.log("[Server] Shutting down...");
        await stopListeners();
        server.close();
    });

    return server;
}

const isMain = (() => {
    if (!process.argv[1]) return false;
    try {
        return import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href;
    } catch {
        return import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
    }
})();

if (isMain) {
    connectDatabase();
    startServer();
}
