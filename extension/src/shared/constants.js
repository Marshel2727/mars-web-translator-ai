(() => {
    globalThis.MarsTranslator = globalThis.MarsTranslator || {};

    const DEFAULT_SETTINGS = {
        apiBaseUrl: "http://127.0.0.1:8000",
        maxBatchSize: 20,
        autoTranslate: true,
    };

    globalThis.MarsTranslator.constants = {
        API_BASE_URL: "http://127.0.0.1:8000",
        DEFAULT_SETTINGS,
        MESSAGE_TYPES: {
            TRANSLATE_VISIBLE_TEXT: "TRANSLATE_VISIBLE_TEXT",
            RESTORE_ORIGINAL_TEXT: "RESTORE_ORIGINAL_TEXT",
            SHOW_TRANSLATION_TOOLTIP: "SHOW_TRANSLATION_TOOLTIP",
            GET_STATS: "GET_STATS",
        },
        SKIP_SELECTOR: [
            "script",
            "style",
            "noscript",
            "code",
            "pre",
            "kbd",
            "samp",
            "textarea",
            "input",
            "select",
            "option",
            "svg",
            ".highlight",
            ".hljs",
            ".prism-code",
            ".shiki",
            ".code-block",
            ".CodeMirror",
            ".monaco-editor",
            "[data-language]",
            "[data-lang]",
            ".token",
            ".language-markup",
            ".language-javascript",
            ".language-python",
            ".language-typescript",
            ".language-css",
            ".language-html",
            ".language-json",
            ".language-bash",
            ".language-shell",
            ".language-yaml",
            ".language-xml",
        ].join(", "),
        BLOCKED_HOSTS: [
            "chat.openai.com",
            "chatgpt.com",
            "claude.ai",
            "gemini.google.com",
            "bard.google.com",
            "aistudio.google.com",
            "copilot.microsoft.com",
            "perplexity.ai",
            "poe.com",
            "you.com",
            "phind.com",
            "grok.com",
            "x.ai",
            "character.ai",
            "meta.ai",
            "notebooklm.google.com",
        ],
        BLOCKED_PATHS: [
            {
                host: "huggingface.co",
                pathPrefix: "/chat",
            },
        ],
        MAX_BATCH_SIZE: 20,
        MAX_PRIORITY_NODES_PER_SCAN: 40,
        MAX_BACKGROUND_NODES_PER_SCAN: 500,
        PRIORITY_TRANSLATE_DELAY_MS: 250,
        BACKGROUND_TRANSLATE_DELAY_MS: 1500,
        BACKGROUND_BATCH_PAUSE_MS: 250,
        CACHE_STORAGE_KEY: "marsTranslationCacheV2",
        LEGACY_CACHE_STORAGE_KEY: "marsTranslationCacheV1",
        MAX_PERSISTENT_CACHE_ITEMS: 3000,
        CACHE_SAVE_DELAY_MS: 700,
        SETTINGS_STORAGE_KEY: "marsTranslatorSettings",
    };

    // Load user settings and override defaults
    if (globalThis.chrome?.storage?.sync) {
        chrome.storage.sync.get("marsTranslatorSettings", (data) => {
            const userSettings = data.marsTranslatorSettings || {};
            if (userSettings.apiBaseUrl) {
                globalThis.MarsTranslator.constants.API_BASE_URL = userSettings.apiBaseUrl;
            }
            if (userSettings.maxBatchSize) {
                globalThis.MarsTranslator.constants.MAX_BATCH_SIZE = userSettings.maxBatchSize;
            }
        });
    }
})();
