(() => {
    console.log("Mars Translator content script aktif");

    const {
        api,
        constants,
        createTextReplacer,
        createViewportTranslator,
        domScanner,
        messageTypes,
    } = globalThis.MarsTranslator;

    const isBlockedHost = constants.BLOCKED_HOSTS.some((host) => {
        return location.hostname === host || location.hostname.endsWith(`.${host}`);
    });

    const state = {
        originalTextMap: new Map(),
        translationCache: new Map(),
        priorityQueue: [],
        backgroundQueue: [],
        queuedNodeSet: new Set(),
        priorityNodeSet: new Set(),
        backgroundNodeSet: new Set(),
        autoTranslateEnabled: !isBlockedHost,
        priorityTimer: null,
        backgroundTimer: null,
        isProcessingQueue: false,
        isApplyingTranslations: false,
        activePageToken: 0,
    };

    const textReplacer = createTextReplacer({
        originalTextMap: state.originalTextMap,
        translationCache: state.translationCache,
        isTranslatableNode: (node, options = {}) => domScanner.isTranslatableNode(node, options, state.originalTextMap),
        getApplyingState: () => state.isApplyingTranslations,
        setApplyingState: (value) => {
            state.isApplyingTranslations = value;
        },
    });

    const viewportTranslator = createViewportTranslator({
        state,
        domScanner,
        textReplacer,
        api,
    });

    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (message.type === messageTypes.TRANSLATE_VISIBLE_TEXT) {
            if (isBlockedHost) {
                sendResponse({
                    ok: false,
                    message: "Halaman AI chat dilewati agar tidak diterjemahkan",
                });
                return false;
            }

            state.autoTranslateEnabled = true;
            viewportTranslator.translateViewportNow()
                .then((results) => sendResponse(results))
                .catch((error) => sendResponse({
                    ok: false,
                    error: error.message,
                }));
            return true;
        }

        if (message.type === messageTypes.RESTORE_ORIGINAL_TEXT) {
            viewportTranslator.restoreOriginalText();
            sendResponse({ ok: true, message: "Teks asli telah dipulihkan" });
        }
    });

    textReplacer.initializePersistentCache()
        .catch((error) => {
            console.warn("Mars Translator gagal memuat cache:", error);
        })
        .finally(() => {
            if (isBlockedHost) {
                console.log("Mars Translator melewati halaman AI:", location.hostname);
                return;
            }

            setupAutoTranslate();
        });

    function setupAutoTranslate() {
        if (!document.body) {
            window.addEventListener("DOMContentLoaded", setupAutoTranslate, { once: true });
            return;
        }

        const observer = new MutationObserver((mutations) => {
            if (state.isApplyingTranslations) return;

            for (const mutation of mutations) {
                if (mutation.type === "characterData" && state.originalTextMap.has(mutation.target)) {
                    state.originalTextMap.delete(mutation.target);
                }
            }

            viewportTranslator.scheduleViewportTranslate();
            viewportTranslator.scheduleBackgroundTranslate();
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true,
            characterData: true,
        });

        const originalPushState = history.pushState;
        const originalReplaceState = history.replaceState;

        history.pushState = function (...args) {
            const result = originalPushState.apply(this, args);
            viewportTranslator.handlePageChange();
            return result;
        };

        history.replaceState = function (...args) {
            const result = originalReplaceState.apply(this, args);
            viewportTranslator.handlePageChange();
            return result;
        };

        window.addEventListener("popstate", viewportTranslator.handlePageChange);
        window.addEventListener("hashchange", viewportTranslator.handlePageChange);
        window.addEventListener("scroll", () => viewportTranslator.scheduleViewportTranslate(), { passive: true });
        window.addEventListener("load", () => {
            viewportTranslator.scheduleViewportTranslate(0);
            viewportTranslator.scheduleBackgroundTranslate();
        }, { once: true });

        viewportTranslator.scheduleViewportTranslate(0);
        viewportTranslator.scheduleBackgroundTranslate();
    }
})();
