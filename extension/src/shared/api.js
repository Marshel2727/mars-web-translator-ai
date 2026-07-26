(() => {
    globalThis.MarsTranslator = globalThis.MarsTranslator || {};

    const { API_BASE_URL } = globalThis.MarsTranslator.constants;

    const SETTINGS_KEY = "marsTranslatorSettings";

    /**
     * Read the user-configured API base URL from storage.
     * Falls back to the default API_BASE_URL.
     */
    async function getBaseUrl() {
        try {
            const data = await chrome.storage.sync.get(SETTINGS_KEY);
            const settings = data[SETTINGS_KEY] || {};
            return settings.apiBaseUrl || API_BASE_URL;
        } catch {
            return API_BASE_URL;
        }
    }

    /**
     * Read Ollama inference options saved from the extension Options page.
     * Returns an `options` object ready to embed in the translate request payload.
     */
    async function getOllamaOptions() {
        try {
            const data     = await chrome.storage.sync.get(SETTINGS_KEY);
            const settings = data[SETTINGS_KEY] || {};

            const options = {};
            if (settings.numCtx     != null) options.num_ctx     = settings.numCtx;
            if (settings.numPredict != null) options.num_predict = settings.numPredict;
            if (settings.temperature!= null) options.temperature = settings.temperature;
            if (settings.topP       != null) options.top_p       = settings.topP;
            if (settings.keepAlive  != null) options.keep_alive  = settings.keepAlive;

            return options;
        } catch {
            return {};
        }
    }

    async function translateBatch(items, mode = "translate") {
        const baseUrl  = await getBaseUrl();
        const ollamaOptions = await getOllamaOptions();

        const body = {
            mode,
            items,
        };

        // Only attach options object if at least one parameter is set
        if (Object.keys(ollamaOptions).length > 0) {
            body.options = ollamaOptions;
        }

        const response = await fetch(`${baseUrl}/api/v1/translate/batch`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(35000),
        });

        if (!response.ok) {
            throw new Error(`HTTP Error: ${response.status}`);
        }

        return response.json();
    }

    async function getModels() {
        const baseUrl = await getBaseUrl();
        const response = await fetch(`${baseUrl}/api/v1/models/`, {
            signal: AbortSignal.timeout(10000),
        });
        if (!response.ok) {
            throw new Error(`HTTP Error: ${response.status}`);
        }
        return response.json();
    }

    async function setActiveModel(model) {
        const baseUrl = await getBaseUrl();
        const response = await fetch(`${baseUrl}/api/v1/models/active`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({ model }),
            signal: AbortSignal.timeout(10000),
        });
        if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            throw new Error(err.detail || `HTTP Error: ${response.status}`);
        }
        return response.json();
    }

    globalThis.MarsTranslator.api = {
        translateBatch,
        getModels,
        setActiveModel,
    };
})();
