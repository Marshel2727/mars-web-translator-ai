const test = require("node:test");
const assert = require("node:assert/strict");

const worker = require("../src/background/service_worker.js");

const TOKEN = "abcdefghijklmnopqrstuvwxyz-0123456789-token";

function installChrome({ token = TOKEN, baseUrl = "http://127.0.0.1:8000" } = {}) {
    global.chrome = {
        storage: {
            sync: { get: async () => ({ marsTranslatorSettings: { apiBaseUrl: baseUrl } }) },
            local: { get: async () => ({ marsApiToken: token }) },
        },
    };
}

test("backend operations are fixed and translation timeout is 135 seconds", () => {
    assert.equal(worker.OPERATIONS.translate.timeoutMs, 135000);
    assert.equal(worker.OPERATIONS.health.timeoutMs, 8000);
    assert.equal(worker.OPERATIONS.customPath, undefined);
});

test("API base is restricted to local HTTP", () => {
    assert.equal(worker.normalizeApiBase("http://localhost:9000/path"), "http://localhost:9000");
    assert.throws(() => worker.normalizeApiBase("https://example.com"), /localhost/);
    assert.throws(() => worker.normalizeApiBase("file:///tmp/server"), /localhost/);
});

test("token is loaded from local storage and attached only by worker", async () => {
    installChrome();
    let captured;
    global.fetch = async (url, options) => {
        captured = { url, options };
        return { ok: true, status: 200, json: async () => ({ status: "ok" }) };
    };

    const data = await worker.requestBackend("health");
    assert.equal(data.status, "ok");
    assert.equal(captured.options.headers["X-Mars-Token"], TOKEN);
    assert.equal(captured.url, "http://127.0.0.1:8000/api/v1/health/");
});

test("missing token fails before fetch", async () => {
    installChrome({ token: "short" });
    let called = false;
    global.fetch = async () => { called = true; };

    await assert.rejects(
        worker.requestBackend("health"),
        (error) => error.code === "AUTH_MISSING" && error.status === 401,
    );
    assert.equal(called, false);
});

test("structured backend errors retain code and status", async () => {
    installChrome();
    global.fetch = async () => ({
        ok: false,
        status: 503,
        json: async () => ({ code: "GPU_REQUIRED", detail: "GPU wajib" }),
    });
    await assert.rejects(
        worker.requestBackend("health"),
        (error) => error.code === "GPU_REQUIRED" && error.status === 503,
    );
});

test("unknown operation never reaches fetch", async () => {
    installChrome();
    let called = false;
    global.fetch = async () => { called = true; };
    await assert.rejects(
        worker.requestBackend("arbitrary"),
        (error) => error.code === "OPERATION_FORBIDDEN",
    );
    assert.equal(called, false);
});
