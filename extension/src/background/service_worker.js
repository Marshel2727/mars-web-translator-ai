const DEFAULT_API_BASE = "http://127.0.0.1:8000";
const SETTINGS_KEY = "marsTranslatorSettings";
const TOKEN_KEY = "marsApiToken";
const LEGACY_CACHE_KEY = "marsTranslationCacheV1";
const REQUEST_MESSAGE = "MARS_BACKEND_REQUEST";

const OPERATIONS = Object.freeze({
    translate: { method: "POST", path: "/api/v1/translate/batch", timeoutMs: 135000 },
    health: { method: "GET", path: "/api/v1/health/", timeoutMs: 8000 },
    models: { method: "GET", path: "/api/v1/models/", timeoutMs: 10000 },
    activateModel: { method: "POST", path: "/api/v1/models/active", timeoutMs: 10000 },
    cacheStats: { method: "GET", path: "/api/v1/cache/stats", timeoutMs: 8000 },
    clearServerCache: { method: "DELETE", path: "/api/v1/cache/clear", timeoutMs: 10000 },
});

class WorkerApiError extends Error {
    constructor(code, message, status = 0, data = null) {
        super(message);
        this.name = "WorkerApiError";
        this.code = code;
        this.status = status;
        this.data = data;
    }
}

function normalizeApiBase(value) {
    const candidate = String(value || DEFAULT_API_BASE).trim();
    let url;
    try {
        url = new URL(candidate);
    } catch {
        throw new WorkerApiError("API_URL_INVALID", "Server URL tidak valid.");
    }
    if (url.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(url.hostname)) {
        throw new WorkerApiError(
            "API_URL_FORBIDDEN",
            "Server URL harus memakai HTTP pada localhost atau 127.0.0.1.",
        );
    }
    return url.origin;
}

async function getConnectionConfig() {
    const [syncData, localData] = await Promise.all([
        chrome.storage.sync.get(SETTINGS_KEY),
        chrome.storage.local.get(TOKEN_KEY),
    ]);
    const settings = syncData[SETTINGS_KEY] || {};
    const token = String(localData[TOKEN_KEY] || "").trim();
    if (token.length < 32) {
        throw new WorkerApiError(
            "AUTH_MISSING",
            "Token API belum diisi. Buka Pengaturan ekstensi dan masukkan MARS_API_TOKEN.",
            401,
        );
    }
    return { baseUrl: normalizeApiBase(settings.apiBaseUrl), token };
}

async function requestBackend(operationName, payload = undefined) {
    const operation = OPERATIONS[operationName];
    if (!operation) {
        throw new WorkerApiError("OPERATION_FORBIDDEN", "Operasi backend tidak diizinkan.");
    }

    const { baseUrl, token } = await getConnectionConfig();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), operation.timeoutMs);

    try {
        const options = {
            method: operation.method,
            headers: { "X-Mars-Token": token },
            signal: controller.signal,
        };
        if (payload !== undefined && operation.method !== "GET") {
            options.headers["Content-Type"] = "application/json";
            options.body = JSON.stringify(payload);
        }

        const response = await fetch(`${baseUrl}${operation.path}`, options);
        const data = await response.json().catch(() => null);
        if (!response.ok) {
            throw new WorkerApiError(
                data?.code || `HTTP_${response.status}`,
                data?.detail || `Backend mengembalikan HTTP ${response.status}.`,
                response.status,
                data,
            );
        }
        return data;
    } catch (error) {
        if (error instanceof WorkerApiError) throw error;
        if (error?.name === "AbortError") {
            throw new WorkerApiError(
                "REQUEST_TIMEOUT",
                `Request backend melewati batas ${Math.round(operation.timeoutMs / 1000)} detik.`,
                504,
            );
        }
        throw new WorkerApiError(
            "NETWORK_ERROR",
            "Backend lokal tidak dapat dihubungi. Pastikan Ollama dan FastAPI berjalan.",
            0,
        );
    } finally {
        clearTimeout(timer);
    }
}

function serializeError(error) {
    return {
        code: error?.code || "INTERNAL_ERROR",
        message: error?.message || "Terjadi kesalahan internal pada service worker.",
        status: Number(error?.status || 0),
        data: error?.data || null,
    };
}

async function initializeExtension() {
    await chrome.storage.local.remove(LEGACY_CACHE_KEY);
    await chrome.contextMenus.removeAll();
    chrome.contextMenus.create({
        id: "mars-translate-selection",
        title: "🪐 Terjemahkan ke Indonesia",
        contexts: ["selection"],
    });
    chrome.contextMenus.create({
        id: "mars-explain-selection",
        title: "🪐 Jelaskan dengan AI",
        contexts: ["selection"],
    });
}

if (globalThis.chrome?.runtime) {
    chrome.runtime.onInstalled.addListener(() => {
        initializeExtension().catch((error) => console.error("Mars init error:", error));
    });

    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
        if (message?.type !== REQUEST_MESSAGE) return false;
        requestBackend(message.operation, message.payload)
            .then((data) => sendResponse({ ok: true, data }))
            .catch((error) => sendResponse({ ok: false, error: serializeError(error) }));
        return true;
    });

    chrome.contextMenus.onClicked.addListener(async (info, tab) => {
        if (!info.selectionText || !tab?.id) return;
        const mode = info.menuItemId === "mars-explain-selection" ? "explain" : "translate";
        const selectedText = info.selectionText.trim();
        if (selectedText.length < 3) return;

        try {
            const data = await requestBackend("translate", {
                mode,
                items: [{ id: "ctx-1", text: selectedText }],
            });
            await chrome.tabs.sendMessage(tab.id, {
                type: "SHOW_TRANSLATION_TOOLTIP",
                text: data.results?.[0]?.translated_text || "Tidak ada hasil.",
                mode,
            });
        } catch (error) {
            try {
                await chrome.tabs.sendMessage(tab.id, {
                    type: "SHOW_TRANSLATION_TOOLTIP",
                    text: serializeError(error).message,
                    mode: "error",
                });
            } catch {
                // Content script tidak tersedia pada tab internal browser.
            }
        }
    });
}

if (typeof module !== "undefined" && module.exports) {
    module.exports = {
        OPERATIONS,
        REQUEST_MESSAGE,
        WorkerApiError,
        normalizeApiBase,
        requestBackend,
        serializeError,
    };
}
