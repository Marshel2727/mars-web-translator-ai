(() => {
    globalThis.MarsTranslator = globalThis.MarsTranslator || {};

    const SETTINGS_KEY = "marsTranslatorSettings";
    const REQUEST_MESSAGE = "MARS_BACKEND_REQUEST";

    class MarsExtensionApiError extends Error {
        constructor(error = {}) {
            super(error.message || "Request backend gagal.");
            this.name = "MarsExtensionApiError";
            this.code = error.code || "INTERNAL_ERROR";
            this.status = Number(error.status || 0);
            this.data = error.data || null;
        }
    }

    async function workerRequest(operation, payload) {
        const response = await chrome.runtime.sendMessage({
            type: REQUEST_MESSAGE,
            operation,
            payload,
        });
        if (!response?.ok) throw new MarsExtensionApiError(response?.error);
        return response.data;
    }

    async function getOllamaOptions() {
        const data = await chrome.storage.sync.get(SETTINGS_KEY);
        const settings = data[SETTINGS_KEY] || {};
        const options = {};
        if (settings.numCtx != null) options.num_ctx = settings.numCtx;
        if (settings.numPredict != null) options.num_predict = settings.numPredict;
        if (settings.temperature != null) options.temperature = settings.temperature;
        if (settings.topP != null) options.top_p = settings.topP;
        if (settings.keepAlive != null) options.keep_alive = settings.keepAlive;
        return options;
    }

    async function translateBatch(items, mode = "translate") {
        const options = await getOllamaOptions();
        const body = { mode, items };
        if (Object.keys(options).length) body.options = options;
        return workerRequest("translate", body);
    }

    globalThis.MarsTranslator.api = {
        MarsExtensionApiError,
        clearServerCache: () => workerRequest("clearServerCache"),
        getHealth: () => workerRequest("health"),
        getModels: () => workerRequest("models"),
        getServerCacheStats: () => workerRequest("cacheStats"),
        setActiveModel: (model) => workerRequest("activateModel", { model }),
        translateBatch,
        workerRequest,
    };
})();
