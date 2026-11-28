import { describe, it, before, after, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import User from "../src/models/User.js";
import { createCreditRequestRouter } from "../src/routes/creditRequest.routes.js";

function createInMemoryCreditRequestModel(initialDocs = []) {
    const store = new Map();
    for (const doc of initialDocs) {
        store.set(String(doc._id), { ...doc });
    }

    function matchesFilter(doc, filter = {}) {
        for (const [key, val] of Object.entries(filter)) {
            if (String(doc[key]) !== String(val)) return false;
        }
        return true;
    }

    return {
        store,
        async create(doc) {
            const _id = new mongoose.Types.ObjectId().toString();
            const record = {
                _id,
                status: "PENDING",
                txHash: null,
                reviewedBy: null,
                reviewedAt: null,
                rejectionReason: null,
                createdAt: new Date(),
                ...doc,
            };
            store.set(_id, record);
            return record;
        },
        async findById(id) {
            const found = store.get(String(id));
            return found ? { ...found } : null;
        },
        async findOneAndUpdate(filter, update, options = {}) {
            for (const [id, doc] of store.entries()) {
                if (matchesFilter(doc, filter)) {
                    const next = { ...doc, ...(update.$set ?? {}) };
                    store.set(id, next);
                    return options.new ? { ...next } : { ...doc };
                }
            }
            return null;
        },
        find(filter = {}) {
            let results = [...store.values()].filter((d) => matchesFilter(d, filter));
            const chain = {
                sort(sortSpec) {
                    if (sortSpec?.createdAt === -1) {
                        results.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
                    }
                    return chain;
                },
                skip(n) {
                    results = results.slice(n);
                    return chain;
                },
                limit(n) {
                    results = results.slice(0, n);
                    return chain;
                },
                async lean() {
                    return results.map((d) => ({ ...d }));
                },
            };
            return chain;
        },
        async countDocuments(filter = {}) {
            return [...store.values()].filter((d) => matchesFilter(d, filter)).length;
        },
    };
}

describe("M2.1 CreditRequest atomic approvals, validation, and /mine", () => {
    const savedSecret = process.env.JWT_SECRET;
    let model;
    let awardCalls;
    let recordDebtCalls;
    let awardBehavior;
    let server;
    let baseUrl;
    let userToken;
    let otherUserToken;
    let adminToken;

    const USER_ID = new mongoose.Types.ObjectId().toString();
    const OTHER_USER_ID = new mongoose.Types.ObjectId().toString();
    const ADMIN_ID = new mongoose.Types.ObjectId().toString();
    const VALID_ADDR = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";

    before(async () => {
        process.env.JWT_SECRET = "m21-route-test-secret";
        userToken = jwt.sign({ id: USER_ID }, process.env.JWT_SECRET);
        otherUserToken = jwt.sign({ id: OTHER_USER_ID }, process.env.JWT_SECRET);
        adminToken = jwt.sign({ id: ADMIN_ID }, process.env.JWT_SECRET);

        const app = express();
        app.use(express.json());
        app.use(
            "/api/requests",
            createCreditRequestRouter({
                CreditRequestModel: {
                    create: (...args) => model.create(...args),
                    findById: (...args) => model.findById(...args),
                    findOneAndUpdate: (...args) => model.findOneAndUpdate(...args),
                    find: (...args) => model.find(...args),
                    countDocuments: (...args) => model.countDocuments(...args),
                },
                awardCreditsFn: async (...args) => {
                    awardCalls.push(args);
                    return awardBehavior(...args);
                },
                recordDebtFn: async (...args) => {
                    recordDebtCalls.push(args);
                    return { hash: "0xdebt0001" };
                },
            })
        );

        server = http.createServer(app);
        await new Promise((resolve) => {
            server.listen(0, "127.0.0.1", () => {
                const { port } = server.address();
                baseUrl = `http://127.0.0.1:${port}`;
                resolve();
            });
        });
    });

    beforeEach(() => {
        model = createInMemoryCreditRequestModel();
        awardCalls = [];
        recordDebtCalls = [];
        awardBehavior = async () => ({ hash: "0xaward0001" });

        mock.method(User, "findById", async (id) => {
            if (id === USER_ID) return { _id: USER_ID, email: "user@example.com", role: "USER" };
            if (id === OTHER_USER_ID) return { _id: OTHER_USER_ID, email: "other@example.com", role: "USER" };
            if (id === ADMIN_ID) return { _id: ADMIN_ID, email: "admin@example.com", role: "ADMIN" };
            return null;
        });
    });

    afterEach(() => {
        mock.restoreAll();
    });

    after(async () => {
        if (savedSecret === undefined) delete process.env.JWT_SECRET;
        else process.env.JWT_SECRET = savedSecret;
        if (server?.listening) {
            await new Promise((resolve) => server.close(() => resolve()));
        }
    });

    it("prevents double-minting on concurrent approvals (one 200, one 409, awardCredits called once)", async () => {
        const reqId = new mongoose.Types.ObjectId().toString();
        model = createInMemoryCreditRequestModel([
            {
                _id: reqId,
                entityAddress: VALID_ADDR.toLowerCase(),
                type: "CREDIT",
                amount: 100,
                reason: "Solar batch",
                status: "PENDING",
                submittedBy: USER_ID,
                createdAt: new Date(),
            },
        ]);

        awardBehavior = async () => {
            await new Promise((r) => setTimeout(r, 50));
            return { hash: "0xdeadbeef1234" };
        };

        const [res1, res2] = await Promise.all([
            fetch(`${baseUrl}/api/requests/${reqId}/approve`, {
                method: "POST",
                headers: { Authorization: `Bearer ${adminToken}` },
            }),
            fetch(`${baseUrl}/api/requests/${reqId}/approve`, {
                method: "POST",
                headers: { Authorization: `Bearer ${adminToken}` },
            }),
        ]);

        const statuses = [res1.status, res2.status].sort((a, b) => a - b);
        assert.deepEqual(statuses, [200, 409]);
        assert.equal(awardCalls.length, 1);

        const stored = model.store.get(reqId);
        assert.equal(stored.status, "APPROVED");
        assert.equal(stored.txHash, "0xdeadbeef1234");
        assert.equal(stored.reviewedBy, ADMIN_ID);
    });

    it("returns 400 on invalid ObjectId for /:id/approve and /:id/reject, and 404 when missing", async () => {
        for (const action of ["approve", "reject"]) {
            const badRes = await fetch(`${baseUrl}/api/requests/not-an-object-id/${action}`, {
                method: "POST",
                headers: { Authorization: `Bearer ${adminToken}` },
            });
            assert.equal(badRes.status, 400);

            const missingId = new mongoose.Types.ObjectId().toString();
            const missingRes = await fetch(`${baseUrl}/api/requests/${missingId}/${action}`, {
                method: "POST",
                headers: { Authorization: `Bearer ${adminToken}` },
            });
            assert.equal(missingRes.status, 404);
        }
    });

    it("POST /api/requests strictly rejects invalid amounts and records submittedBy", async () => {
        const invalidAmounts = ["abc", "NaN", "Infinity", 0, -5, 1.5, "", true, null];
        for (const badAmount of invalidAmounts) {
            const res = await fetch(`${baseUrl}/api/requests`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${userToken}`,
                },
                body: JSON.stringify({
                    entityAddress: VALID_ADDR,
                    type: "CREDIT",
                    amount: badAmount,
                    reason: "Solar",
                }),
            });
            assert.equal(res.status, 400, `Expected 400 for amount=${String(badAmount)}`);
        }

        // Also verify literal NaN / Infinity after Number coercion path (via string & number)
        const okRes = await fetch(`${baseUrl}/api/requests`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${userToken}`,
            },
            body: JSON.stringify({
                entityAddress: VALID_ADDR,
                type: "CREDIT",
                amount: 42,
                reason: "  Rooftop Solar  ",
            }),
        });
        assert.equal(okRes.status, 201);
        const okBody = await okRes.json();
        const created = model.store.get(okBody.requestId);
        assert.equal(created.submittedBy, USER_ID);
        assert.equal(created.amount, 42);
        assert.equal(created.reason, "Rooftop Solar");
    });

    it("GET /api/requests/mine requires auth and returns paginated requests for the caller only", async () => {
        const unauth = await fetch(`${baseUrl}/api/requests/mine`);
        assert.equal(unauth.status, 401);

        const t1 = new Date("2026-01-01T00:00:00Z");
        const t2 = new Date("2026-01-02T00:00:00Z");
        const t3 = new Date("2026-01-03T00:00:00Z");
        model = createInMemoryCreditRequestModel([
            { _id: new mongoose.Types.ObjectId().toString(), submittedBy: USER_ID, amount: 10, createdAt: t1 },
            { _id: new mongoose.Types.ObjectId().toString(), submittedBy: OTHER_USER_ID, amount: 99, createdAt: t2 },
            { _id: new mongoose.Types.ObjectId().toString(), submittedBy: USER_ID, amount: 20, createdAt: t2 },
            { _id: new mongoose.Types.ObjectId().toString(), submittedBy: USER_ID, amount: 30, createdAt: t3 },
        ]);

        const page1Res = await fetch(`${baseUrl}/api/requests/mine?page=1&limit=2`, {
            headers: { Authorization: `Bearer ${userToken}` },
        });
        assert.equal(page1Res.status, 200);
        const page1 = await page1Res.json();
        assert.equal(page1.success, true);
        assert.equal(page1.page, 1);
        assert.equal(page1.limit, 2);
        assert.equal(page1.total, 3);
        assert.deepEqual(page1.requests.map((r) => r.amount), [30, 20]);

        const page2Res = await fetch(`${baseUrl}/api/requests/mine?page=2&limit=2`, {
            headers: { Authorization: `Bearer ${userToken}` },
        });
        const page2 = await page2Res.json();
        assert.deepEqual(page2.requests.map((r) => r.amount), [10]);
    });

    it("resets to PENDING on pre-broadcast error and marks FAILED on uncertain post-broadcast error", async () => {
        const preId = new mongoose.Types.ObjectId().toString();
        const postId = new mongoose.Types.ObjectId().toString();
        model = createInMemoryCreditRequestModel([
            {
                _id: preId,
                entityAddress: VALID_ADDR.toLowerCase(),
                type: "CREDIT",
                amount: 50,
                reason: "Pre-fail",
                status: "PENDING",
                createdAt: new Date(),
            },
            {
                _id: postId,
                entityAddress: VALID_ADDR.toLowerCase(),
                type: "CREDIT",
                amount: 50,
                reason: "Post-fail",
                status: "PENDING",
                createdAt: new Date(),
            },
        ]);

        awardBehavior = async () => {
            throw new Error("BACKEND_PRIVATE_KEY environment variable is required");
        };
        const preRes = await fetch(`${baseUrl}/api/requests/${preId}/approve`, {
            method: "POST",
            headers: { Authorization: `Bearer ${adminToken}` },
        });
        assert.equal(preRes.status, 500);
        assert.equal(model.store.get(preId).status, "PENDING");
        assert.equal(model.store.get(preId).reviewedBy, null);

        awardBehavior = async () => {
            const err = new Error("RPC dropped during tx.wait");
            err.transactionHash = "0xmaybe_broadcast";
            throw err;
        };
        const postRes = await fetch(`${baseUrl}/api/requests/${postId}/approve`, {
            method: "POST",
            headers: { Authorization: `Bearer ${adminToken}` },
        });
        assert.equal(postRes.status, 500);
        assert.equal(model.store.get(postId).status, "FAILED");

        // Retrying a FAILED request is blocked with 409
        const retryRes = await fetch(`${baseUrl}/api/requests/${postId}/approve`, {
            method: "POST",
            headers: { Authorization: `Bearer ${adminToken}` },
        });
        assert.equal(retryRes.status, 409);
    });

    it("rejects atomically with reason and returns 409 on duplicate reject", async () => {
        const reqId = new mongoose.Types.ObjectId().toString();
        model = createInMemoryCreditRequestModel([
            {
                _id: reqId,
                entityAddress: VALID_ADDR.toLowerCase(),
                type: "DEBT",
                amount: 25,
                reason: "Audit",
                status: "PENDING",
                createdAt: new Date(),
            },
        ]);

        const res1 = await fetch(`${baseUrl}/api/requests/${reqId}/reject`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${adminToken}`,
            },
            body: JSON.stringify({ reason: "  Missing meter evidence  " }),
        });
        assert.equal(res1.status, 200);
        const stored = model.store.get(reqId);
        assert.equal(stored.status, "REJECTED");
        assert.equal(stored.rejectionReason, "Missing meter evidence");
        assert.equal(stored.reviewedBy, ADMIN_ID);

        const res2 = await fetch(`${baseUrl}/api/requests/${reqId}/reject`, {
            method: "POST",
            headers: { Authorization: `Bearer ${adminToken}` },
        });
        assert.equal(res2.status, 409);
    });
});
