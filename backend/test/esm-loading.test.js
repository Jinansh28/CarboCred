import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendDir = path.resolve(__dirname, "..");

const BACKEND_MODULES = [
    "index.js",
    "listener.js",
    "signer.js",
    "src/controllers/entityProfile.controller.js",
    "src/middleware/requireAdmin.js",
    "src/middleware/requireAuth.js",
    "src/models/CreditRequest.js",
    "src/models/EntityProfile.js",
    "src/models/User.js",
    "src/routes/auth.routes.js",
    "src/routes/creditRequest.routes.js",
    "src/routes/entityProfile.routes.js",
    "src/utils/hashAccountId.js",
];

describe("Backend ESM module loading", () => {
    for (const relPath of BACKEND_MODULES) {
        it(`imports ${relPath} cleanly as an ES module`, async () => {
            const fullPath = path.join(backendDir, relPath);
            const mod = await import(pathToFileURL(fullPath).href);
            assert.ok(mod, `${relPath} should resolve to a module namespace`);
        });
    }

    it("has no remaining require() or module.exports in backend source files", () => {
        for (const relPath of BACKEND_MODULES) {
            const source = fs.readFileSync(path.join(backendDir, relPath), "utf8");
            assert.equal(/\brequire\s*\(/.test(source), false, `${relPath} must not contain require()`);
            assert.equal(/\bmodule\.exports\b/.test(source), false, `${relPath} must not contain module.exports`);
            assert.equal(/\bexports\./.test(source), false, `${relPath} must not contain exports.`);
        }
    });

    it("does not start HTTP server when index.js is imported as a module", async () => {
        const indexMod = await import(pathToFileURL(path.join(backendDir, "index.js")).href);
        assert.equal(indexMod.server.listening, false);
        assert.equal(typeof indexMod.app, "function");
        assert.equal(typeof indexMod.broadcast, "function");
        assert.equal(typeof indexMod.connectDatabase, "function");
        assert.equal(typeof indexMod.startServer, "function");
    });
});
