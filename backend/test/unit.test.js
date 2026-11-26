import { describe, it, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import jwt from "jsonwebtoken";
import { hashAccountId } from "../src/utils/hashAccountId.js";
import requireAuth from "../src/middleware/requireAuth.js";
import requireAdmin from "../src/middleware/requireAdmin.js";
import User from "../src/models/User.js";
import { getProvider, initSigner, resetSigner } from "../signer.js";
import { startListeners, stopListeners } from "../listener.js";

function createMockRes() {
    const res = {
        statusCode: 200,
        body: null,
        status(code) {
            this.statusCode = code;
            return this;
        },
        json(payload) {
            this.body = payload;
            return this;
        },
    };
    return res;
}

describe("hashAccountId utility", () => {
    it("produces a deterministic lowercase-normalized 64-char SHA-256 hex string", () => {
        const lower = hashAccountId("0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266");
        const mixed = hashAccountId("0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266");
        assert.equal(lower, mixed);
        assert.match(lower, /^[a-f0-9]{64}$/);
    });

    it("throws on missing or non-string addresses", () => {
        assert.throws(() => hashAccountId(""), /Valid wallet address required/);
        assert.throws(() => hashAccountId(null), /Valid wallet address required/);
        assert.throws(() => hashAccountId(12345), /Valid wallet address required/);
    });
});

describe("requireAuth middleware", () => {
    const originalSecret = process.env.JWT_SECRET;

    beforeEach(() => {
        process.env.JWT_SECRET = "unit-test-jwt-secret";
    });

    afterEach(() => {
        process.env.JWT_SECRET = originalSecret;
        mock.restoreAll();
    });

    it("returns 401 when Authorization header is absent or malformed", async () => {
        const res1 = createMockRes();
        let nextCalled = false;
        await requireAuth({ headers: {} }, res1, () => { nextCalled = true; });
        assert.equal(res1.statusCode, 401);
        assert.equal(res1.body.success, false);
        assert.equal(nextCalled, false);

        const res2 = createMockRes();
        await requireAuth({ headers: { authorization: "Basic abc" } }, res2, () => { nextCalled = true; });
        assert.equal(res2.statusCode, 401);
        assert.equal(nextCalled, false);
    });

    it("returns 401 when JWT is invalid", async () => {
        const res = createMockRes();
        let nextCalled = false;
        await requireAuth(
            { headers: { authorization: "Bearer not-a-valid-token" } },
            res,
            () => { nextCalled = true; }
        );
        assert.equal(res.statusCode, 401);
        assert.match(res.body.error, /Invalid or expired token/);
        assert.equal(nextCalled, false);
    });

    it("returns 401 when JWT is valid but user no longer exists", async () => {
        mock.method(User, "findById", async () => null);
        const token = jwt.sign({ id: "user-123" }, process.env.JWT_SECRET);
        const res = createMockRes();
        let nextCalled = false;

        await requireAuth(
            { headers: { authorization: `Bearer ${token}` } },
            res,
            () => { nextCalled = true; }
        );

        assert.equal(res.statusCode, 401);
        assert.match(res.body.error, /User not found/);
        assert.equal(nextCalled, false);
    });

    it("attaches req.user and calls next() for a valid token and existing user", async () => {
        const fakeUser = { _id: "user-123", email: "a@b.com", role: "USER" };
        mock.method(User, "findById", async (id) => (id === "user-123" ? fakeUser : null));
        const token = jwt.sign({ id: "user-123" }, process.env.JWT_SECRET);
        const req = { headers: { authorization: `Bearer ${token}` } };
        const res = createMockRes();
        let nextCalled = false;

        await requireAuth(req, res, () => { nextCalled = true; });

        assert.equal(nextCalled, true);
        assert.deepEqual(req.user, fakeUser);
    });
});

describe("requireAdmin middleware", () => {
    it("returns 403 when user is missing or not ADMIN", () => {
        const res1 = createMockRes();
        let nextCalled = false;
        requireAdmin({}, res1, () => { nextCalled = true; });
        assert.equal(res1.statusCode, 403);
        assert.equal(nextCalled, false);

        const res2 = createMockRes();
        requireAdmin({ user: { role: "USER" } }, res2, () => { nextCalled = true; });
        assert.equal(res2.statusCode, 403);
        assert.equal(nextCalled, false);
    });

    it("calls next() when req.user.role is ADMIN", () => {
        const res = createMockRes();
        let nextCalled = false;
        requireAdmin({ user: { role: "ADMIN" } }, res, () => { nextCalled = true; });
        assert.equal(nextCalled, true);
        assert.equal(res.statusCode, 200);
    });
});

describe("signer and listener guards", () => {
    const savedEnv = {
        RPC_URL: process.env.RPC_URL,
        BACKEND_PRIVATE_KEY: process.env.BACKEND_PRIVATE_KEY,
        CARBON_CREDIT_TOKEN_ADDRESS: process.env.CARBON_CREDIT_TOKEN_ADDRESS,
        MARKETPLACE_ADDRESS: process.env.MARKETPLACE_ADDRESS,
    };

    beforeEach(() => {
        resetSigner();
    });

    afterEach(async () => {
        resetSigner();
        for (const [k, v] of Object.entries(savedEnv)) {
            if (v === undefined) delete process.env[k];
            else process.env[k] = v;
        }
        await stopListeners();
    });

    it("signer throws clear errors when required env vars are absent", () => {
        delete process.env.RPC_URL;
        assert.throws(() => getProvider(), /RPC_URL environment variable is required/);

        process.env.RPC_URL = "ws://127.0.0.1:8545";
        delete process.env.BACKEND_PRIVATE_KEY;
        assert.throws(() => initSigner(), /BACKEND_PRIVATE_KEY environment variable is required/);

        process.env.BACKEND_PRIVATE_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
        delete process.env.CARBON_CREDIT_TOKEN_ADDRESS;
        assert.throws(() => initSigner(), /CARBON_CREDIT_TOKEN_ADDRESS environment variable is required/);
    });

    it("signer initializes JsonRpcProvider, Wallet, and Contract with valid env vars", () => {
        process.env.RPC_URL = "wss://example-rpc.invalid/ws";
        process.env.BACKEND_PRIVATE_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
        process.env.CARBON_CREDIT_TOKEN_ADDRESS = "0x5FbDB2315678afecb367f032d93F642f64180aa3";

        const { provider, wallet, creditToken } = initSigner();
        assert.ok(provider);
        assert.equal(wallet.address, "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266");
        assert.equal(creditToken.target, process.env.CARBON_CREDIT_TOKEN_ADDRESS);
    });

    it("listener throws clear errors when required env vars are absent", () => {
        delete process.env.RPC_URL;
        assert.throws(() => startListeners(() => {}), /RPC_URL environment variable is required/);

        process.env.RPC_URL = "ws://127.0.0.1:8545";
        delete process.env.CARBON_CREDIT_TOKEN_ADDRESS;
        assert.throws(() => startListeners(() => {}), /Contract addresses are required/);
    });
});
