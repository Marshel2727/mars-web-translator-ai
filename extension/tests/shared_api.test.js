const test = require("node:test");
const assert = require("node:assert/strict");

function loadApi(sendMessage) {
    global.MarsTranslator = {};
    global.chrome = {
        runtime: { sendMessage },
        storage: {
            sync: {
                get: async () => ({
                    marsTranslatorSettings: {
                        numCtx: 512,
                        numPredict: 64,
                        temperature: 0,
                        topP: 0.8,
                        keepAlive: "30m",
                    },
                }),
            },
        },
    };
    delete require.cache[require.resolve("../src/shared/api.js")];
    require("../src/shared/api.js");
    return global.MarsTranslator.api;
}

test("shared API sends allowlisted worker operation with inference options", async () => {
    let message;
    const api = loadApi(async (input) => {
        message = input;
        return { ok: true, data: { results: [], translation_profile: "profile" } };
    });
    const result = await api.translateBatch([{ id: "1", text: "Hello" }]);

    assert.equal(message.type, "MARS_BACKEND_REQUEST");
    assert.equal(message.operation, "translate");
    assert.equal(message.payload.options.num_ctx, 512);
    assert.equal(message.payload.options.keep_alive, "30m");
    assert.equal(result.translation_profile, "profile");
});

test("shared API exposes structured worker errors", async () => {
    const api = loadApi(async () => ({
        ok: false,
        error: { code: "AUTH_INVALID", status: 401, message: "bad token" },
    }));
    await assert.rejects(
        api.getModels(),
        (error) => error.code === "AUTH_INVALID" && error.status === 401,
    );
});
