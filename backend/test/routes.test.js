import { describe, it, before, after, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import jwt from "jsonwebtoken";
import { WebSocket } from "ws";
import { app, server, wss, broadcast } from "../index.js";
import User from "../src/models/User.js";
import CreditRequest from "../src/models/CreditRequest.js";
import EntityProfile from "../src/models/EntityProfile.js";

let baseUrl;
let port;

const savedEnv = {
    JWT_SECRET: process.env.JWT_SECRET,
    ADMIN_SEED_KEY: process.env.ADMIN_SEED_KEY,
};

before(async () => {
    process.env.JWT_SECRET = "route-test-jwt-secret";
    process.env.ADMIN_SEED_KEY = "route-test-admin-seed";

    await new Promise((resolve) => {
        server.listen(0, "127.0.0.1", () => {
            ({ port } = server.address());
            baseUrl = `http://127.0.0.1:${port}`;
            resolve();
        });
    });
});

afterEach(() => {
    mock.restoreAll();
});

after(async () => {
    if (savedEnv.JWT_SECRET === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = savedEnv.JWT_SECRET;

    if (savedEnv.ADMIN_SEED_KEY === undefined) delete process.env.ADMIN_SEED_KEY;
    else process.env.ADMIN_SEED_KEY = savedEnv.ADMIN_SEED_KEY;

    for (const client of wss.clients) {
        client.terminate();
    }
    await new Promise((resolve) => wss.close(() => resolve()));
    if (server.listening) {
        await new Promise((resolve) => server.close(() => resolve()));
    }
});

describe("Core Express endpoints and WebSocket", () => {
    it("GET /health returns 200 ok and CORS headers", async () => {
        const res = await fetch(`${baseUrl}/health`);
        assert.equal(res.status, 200);
        assert.equal(res.headers.get("access-control-allow-origin"), "*");
        const body = await res.json();
        assert.deepEqual(body, { status: "ok" });
    });

    it("OPTIONS preflight returns 204", async () => {
        const res = await fetch(`${baseUrl}/health`, { method: "OPTIONS" });
        assert.equal(res.status, 204);
    });

    it("GET /position/:address rejects invalid Ethereum addresses with 400", async () => {
        const res = await fetch(`${baseUrl}/position/not-an-address`);
        assert.equal(res.status, 400);
        const body = await res.json();
        assert.equal(body.error, "Invalid Ethereum address");
    });

    it("POST /award, /debt, and /clear-debt validate required fields and signature", async () => {
        const awardMissing = await fetch(`${baseUrl}/award`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ entity: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266" }),
        });
        assert.equal(awardMissing.status, 400);

        const debtMissing = await fetch(`${baseUrl}/debt`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({}),
        });
        assert.equal(debtMissing.status, 400);

        const clearMissing = await fetch(`${baseUrl}/clear-debt`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ entity: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266" }),
        });
        assert.equal(clearMissing.status, 400);
    });

    it("WebSocket clients receive welcome message and broadcast events", async () => {
        const ws = new WebSocket(`ws://127.0.0.1:${port}`);
        const messages = [];

        await new Promise((resolve, reject) => {
            ws.on("error", reject);
            ws.on("message", (raw) => {
                messages.push(JSON.parse(raw.toString()));
                if (messages.length === 1) {
                    broadcast({ type: "CreditsAwarded", amount: "42" });
                } else if (messages.length === 2) {
                    resolve();
                }
            });
        });

        assert.equal(messages[0].type, "connected");
        assert.deepEqual(messages[1], { type: "CreditsAwarded", amount: "42" });
        ws.close();
    });
});

describe("/auth routes", () => {
    it("POST /auth/register validates input and adminSeedKey", async () => {
        const resMissing = await fetch(`${baseUrl}/auth/register`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email: "user@example.com" }),
        });
        assert.equal(resMissing.status, 400);

        const resShort = await fetch(`${baseUrl}/auth/register`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email: "user@example.com", password: "123" }),
        });
        assert.equal(resShort.status, 400);

        mock.method(User, "findOne", async () => null);
        const resBadSeed = await fetch(`${baseUrl}/auth/register`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                email: "admin@example.com",
                password: "password123",
                adminSeedKey: "wrong-key",
            }),
        });
        assert.equal(resBadSeed.status, 403);
    });

    it("POST /auth/register creates user and returns JWT", async () => {
        mock.method(User, "findOne", async () => null);
        mock.method(User, "create", async ({ email, role }) => ({
            _id: "u-1",
            email: email.toLowerCase(),
            role,
        }));

        const res = await fetch(`${baseUrl}/auth/register`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                email: "Green@Example.com",
                password: "password123",
                adminSeedKey: process.env.ADMIN_SEED_KEY,
            }),
        });
        assert.equal(res.status, 201);
        const body = await res.json();
        assert.equal(body.success, true);
        assert.equal(body.user.role, "ADMIN");
        assert.ok(body.token);
    });

    it("POST /auth/login and GET /auth/me authenticate with mocked User", async () => {
        mock.method(User, "findOne", () => ({
            select: async () => ({
                _id: "u-2",
                email: "user@example.com",
                role: "USER",
                comparePassword: async (pw) => pw === "secret123",
            }),
        }));

        const loginRes = await fetch(`${baseUrl}/auth/login`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email: "user@example.com", password: "secret123" }),
        });
        assert.equal(loginRes.status, 200);
        const loginBody = await loginRes.json();
        assert.equal(loginBody.success, true);
        assert.ok(loginBody.token);

        mock.method(User, "findById", async (id) =>
            id === "u-2" ? { _id: "u-2", email: "user@example.com", role: "USER" } : null
        );
        const meRes = await fetch(`${baseUrl}/auth/me`, {
            headers: { Authorization: `Bearer ${loginBody.token}` },
        });
        assert.equal(meRes.status, 200);
        const meBody = await meRes.json();
        assert.deepEqual(meBody.user, { id: "u-2", email: "user@example.com", role: "USER" });
    });
});

describe("/api/requests and /entity routes", () => {
    it("POST /api/requests requires auth and validates fields", async () => {
        const unauthRes = await fetch(`${baseUrl}/api/requests`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({}),
        });
        assert.equal(unauthRes.status, 401);

        mock.method(User, "findById", async () => ({ _id: "u-user", email: "u@e.com", role: "USER" }));
        const userToken = jwt.sign({ id: "u-user" }, process.env.JWT_SECRET);

        const badAddrRes = await fetch(`${baseUrl}/api/requests`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${userToken}`,
            },
            body: JSON.stringify({
                entityAddress: "invalid",
                type: "CREDIT",
                amount: 10,
                reason: "Solar",
            }),
        });
        assert.equal(badAddrRes.status, 400);

        mock.method(CreditRequest, "create", async (doc) => ({ _id: "req-1", ...doc }));
        const okRes = await fetch(`${baseUrl}/api/requests`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${userToken}`,
            },
            body: JSON.stringify({
                entityAddress: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
                type: "CREDIT",
                amount: 100,
                reason: "Solar Q1",
            }),
        });
        assert.equal(okRes.status, 201);
        const okBody = await okRes.json();
        assert.equal(okBody.success, true);
        assert.equal(okBody.requestId, "req-1");
    });

    it("GET /api/requests/pending enforces ADMIN role and returns pending items", async () => {
        mock.method(User, "findById", async (id) =>
            id === "u-admin"
                ? { _id: "u-admin", email: "admin@e.com", role: "ADMIN" }
                : { _id: "u-user", email: "u@e.com", role: "USER" }
        );

        const userToken = jwt.sign({ id: "u-user" }, process.env.JWT_SECRET);
        const forbiddenRes = await fetch(`${baseUrl}/api/requests/pending`, {
            headers: { Authorization: `Bearer ${userToken}` },
        });
        assert.equal(forbiddenRes.status, 403);

        mock.method(CreditRequest, "find", () => ({
            sort: () => ({
                lean: async () => [{ _id: "req-1", status: "PENDING", amount: 50 }],
            }),
        }));
        const adminToken = jwt.sign({ id: "u-admin" }, process.env.JWT_SECRET);
        const adminRes = await fetch(`${baseUrl}/api/requests/pending`, {
            headers: { Authorization: `Bearer ${adminToken}` },
        });
        assert.equal(adminRes.status, 200);
        const adminBody = await adminRes.json();
        assert.equal(adminBody.requests.length, 1);
    });

    it("/entity/profile GET and POST validate accountId and persist via model", async () => {
        const validAccountId = "a".repeat(64);

        mock.method(EntityProfile, "findOne", async ({ accountId }) =>
            accountId === validAccountId ? { businessName: "SolarGrid Inc" } : null
        );

        const foundRes = await fetch(`${baseUrl}/entity/profile/${validAccountId}`);
        assert.equal(foundRes.status, 200);
        assert.deepEqual(await foundRes.json(), { exists: true, businessName: "SolarGrid Inc" });

        const missingRes = await fetch(`${baseUrl}/entity/profile/${"b".repeat(64)}`);
        assert.equal(missingRes.status, 200);
        assert.deepEqual(await missingRes.json(), { exists: false });

        const badHexRes = await fetch(`${baseUrl}/entity/profile`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ accountId: "short", businessName: "SolarGrid" }),
        });
        assert.equal(badHexRes.status, 400);

        mock.method(EntityProfile, "findOneAndUpdate", async ({ accountId }, { businessName }) => ({
            accountId,
            businessName,
        }));
        const upsertRes = await fetch(`${baseUrl}/entity/profile`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ accountId: validAccountId, businessName: "SolarGrid Inc" }),
        });
        assert.equal(upsertRes.status, 200);
        const upsertBody = await upsertRes.json();
        assert.equal(upsertBody.success, true);
        assert.equal(upsertBody.profile.businessName, "SolarGrid Inc");
    });
});
