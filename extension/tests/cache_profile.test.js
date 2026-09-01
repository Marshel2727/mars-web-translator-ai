const test = require("node:test");
const assert = require("node:assert/strict");

function loadFactory() {
    global.MarsTranslator = {
        constants: {
            CACHE_SAVE_DELAY_MS: 1,
            CACHE_STORAGE_KEY: "marsTranslationCacheV2",
            LEGACY_CACHE_STORAGE_KEY: "marsTranslationCacheV1",
            MAX_PERSISTENT_CACHE_ITEMS: 10,
        },
    };
    delete require.cache[require.resolve("../src/content/text_replacer.js")];
    require("../src/content/text_replacer.js");
    return global.MarsTranslator.createTextReplacer;
}

function makeReplacer(context) {
    const createTextReplacer = loadFactory();
    return createTextReplacer({
        originalTextMap: new Map(),
        translationCache: new Map(),
        isTranslatableNode: () => true,
        getApplyingState: () => false,
        setApplyingState: () => {},
        getCacheContext: () => context,
    });
}

test("cache preserves case and whitespace but normalizes line endings", () => {
    delete global.chrome;
    const context = { translationProfile: "p1", model: "m1", optionsFingerprint: "o1" };
    const replacer = makeReplacer(context);
    replacer.setCachedTranslation("US", "Amerika Serikat");
    replacer.setCachedTranslation("Line 1\r\nLine 2", "Baris");

    assert.equal(replacer.getCachedTranslation("US"), "Amerika Serikat");
    assert.equal(replacer.getCachedTranslation("us"), undefined);
    assert.equal(replacer.getCachedTranslation("U  S"), undefined);
    assert.equal(replacer.getCachedTranslation("Line 1\nLine 2"), "Baris");
});

test("cache requires verified profile and separates model/options/profile", () => {
    delete global.chrome;
    const context = { translationProfile: "p1", model: "m1", optionsFingerprint: "o1" };
    const replacer = makeReplacer(context);
    replacer.setCachedTranslation("Hello", "Halo");

    assert.equal(replacer.getCachedTranslation("Hello", { ...context, translationProfile: "p2" }), undefined);
    assert.equal(replacer.getCachedTranslation("Hello", { ...context, model: "m2" }), undefined);
    assert.equal(replacer.getCachedTranslation("Hello", { ...context, optionsFingerprint: "o2" }), undefined);
    assert.equal(replacer.getCachedTranslation("Hello", { model: "m1" }), undefined);
});

test("cache initialization deletes V1 and loads V2", async () => {
    const removed = [];
    global.chrome = {
        storage: {
            local: {
                remove: async (key) => removed.push(key),
                get: async () => ({ marsTranslationCacheV2: { key: "value" } }),
                set: async () => {},
            },
        },
    };
    const createTextReplacer = loadFactory();
    const map = new Map();
    const replacer = createTextReplacer({
        originalTextMap: new Map(),
        translationCache: map,
        isTranslatableNode: () => true,
        getApplyingState: () => false,
        setApplyingState: () => {},
        getCacheContext: () => null,
    });
    await replacer.initializePersistentCache();
    assert.deepEqual(removed, ["marsTranslationCacheV1"]);
    assert.equal(map.get("key"), "value");
});
