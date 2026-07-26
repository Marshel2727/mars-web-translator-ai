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

    function isCurrentPageBlocked() {
        const isBlockedByHost = constants.BLOCKED_HOSTS.some((host) => {
            return location.hostname === host || location.hostname.endsWith(`.${host}`);
        });
        const isBlockedByPath = (constants.BLOCKED_PATHS || []).some((rule) => {
            const hostMatches = location.hostname === rule.host || location.hostname.endsWith(`.${rule.host}`);
            return hostMatches && location.pathname.startsWith(rule.pathPrefix);
        });

        return isBlockedByHost || isBlockedByPath;
    }

    const state = {
        originalTextMap: new Map(),
        translationCache: new Map(),
        priorityQueue: [],
        backgroundQueue: [],
        queuedNodeSet: new Set(),
        priorityNodeSet: new Set(),
        backgroundNodeSet: new Set(),
        autoTranslateEnabled: !isCurrentPageBlocked(),
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

    globalThis.MarsTranslator.prefillCache = (originalText, translatedText) => {
        textReplacer.setCachedTranslation(originalText, translatedText);
    };

    const viewportTranslator = createViewportTranslator({
        state,
        domScanner,
        textReplacer,
        api,
    });

    // ===== Tooltip for Context Menu =====
    let activeTooltip = null;

    function showTranslationTooltip(text, mode) {
        removeTooltip();

        const tooltip = document.createElement("div");
        tooltip.id = "mars-translator-tooltip";

        const modeLabel = mode === "explain" ? "Penjelasan AI" : mode === "error" ? "Error" : "Terjemahan";
        const accentColor = mode === "error" ? "#f87171" : mode === "explain" ? "#34d399" : "#a78bfa";

        tooltip.innerHTML = `
            <div style="
                position: fixed;
                bottom: 20px;
                right: 20px;
                max-width: 420px;
                min-width: 280px;
                background: linear-gradient(145deg, rgba(15, 11, 30, 0.97), rgba(26, 16, 53, 0.97));
                backdrop-filter: blur(16px);
                border: 1px solid rgba(139, 92, 246, 0.2);
                border-radius: 14px;
                padding: 0;
                box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5), 0 0 30px rgba(139, 92, 246, 0.1);
                z-index: 2147483647;
                font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
                color: #e2e0ef;
                animation: marsTooltipFadeIn 0.3s ease-out;
            ">
                <div style="
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    padding: 12px 16px;
                    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
                ">
                    <span style="
                        font-size: 12px;
                        font-weight: 600;
                        color: ${accentColor};
                        text-transform: uppercase;
                        letter-spacing: 0.5px;
                    ">🪐 ${modeLabel}</span>
                    <button id="mars-tooltip-close" style="
                        background: none;
                        border: none;
                        color: #7c7a8e;
                        cursor: pointer;
                        font-size: 18px;
                        padding: 0 4px;
                        line-height: 1;
                    ">✕</button>
                </div>
                <div style="
                    padding: 14px 16px;
                    font-size: 13.5px;
                    line-height: 1.7;
                    color: #c4c3d6;
                    max-height: 300px;
                    overflow-y: auto;
                    white-space: pre-wrap;
                    word-break: break-word;
                ">${escapeHtml(text)}</div>
            </div>
        `;

        const style = document.createElement("style");
        style.textContent = `
            @keyframes marsTooltipFadeIn {
                from { opacity: 0; transform: translateY(10px); }
                to { opacity: 1; transform: translateY(0); }
            }
        `;
        tooltip.appendChild(style);

        document.body.appendChild(tooltip);
        activeTooltip = tooltip;

        tooltip.querySelector("#mars-tooltip-close").addEventListener("click", removeTooltip);

        setTimeout(removeTooltip, 30000);
    }

    function removeTooltip() {
        if (activeTooltip) {
            activeTooltip.remove();
            activeTooltip = null;
        }
    }

    function escapeHtml(text) {
        const div = document.createElement("div");
        div.textContent = text;
        return div.innerHTML;
    }

    // ===== Message Listener =====
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (message.type === messageTypes.TRANSLATE_VISIBLE_TEXT) {
            if (isCurrentPageBlocked()) {
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

        if (message.type === "SHOW_TRANSLATION_TOOLTIP") {
            showTranslationTooltip(message.text, message.mode);
            sendResponse({ ok: true });
        }
    });

    // ===== Initialization =====
    textReplacer.initializePersistentCache()
        .catch((error) => {
            console.warn("Mars Translator gagal memuat cache:", error);
        })
        .finally(() => {
            if (isCurrentPageBlocked()) {
                console.log("Mars Translator melewati halaman AI:", location.hostname);
            }

            setupAutoTranslate();
        });

    function setupAutoTranslate() {
        if (!document.body) {
            window.addEventListener("DOMContentLoaded", setupAutoTranslate, { once: true });
            return;
        }

        const observer = new MutationObserver((mutations) => {
            if (isCurrentPageBlocked()) return;
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
            handleNavigationChange();
            return result;
        };

        history.replaceState = function (...args) {
            const result = originalReplaceState.apply(this, args);
            handleNavigationChange();
            return result;
        };

        window.addEventListener("popstate", handleNavigationChange);
        window.addEventListener("hashchange", handleNavigationChange);
        window.addEventListener("scroll", () => {
            if (!isCurrentPageBlocked()) {
                viewportTranslator.scheduleViewportTranslate();
            }
        }, { passive: true });
        window.addEventListener("load", () => {
            if (!isCurrentPageBlocked()) {
                viewportTranslator.scheduleViewportTranslate(0);
                viewportTranslator.scheduleBackgroundTranslate();
            }
        }, { once: true });

        if (!isCurrentPageBlocked()) {
            viewportTranslator.scheduleViewportTranslate(0);
            viewportTranslator.scheduleBackgroundTranslate();
            scheduleNavigationRetries();
        }
    }

    function handleNavigationChange() {
        if (isCurrentPageBlocked()) {
            state.autoTranslateEnabled = false;
            viewportTranslator.clearTimers();
            return;
        }

        viewportTranslator.handlePageChange();
        scheduleNavigationRetries();
    }

    function scheduleNavigationRetries() {
        for (const delay of [0, 250, 800, 1500, 3000]) {
            setTimeout(() => {
                if (isCurrentPageBlocked()) return;
                state.autoTranslateEnabled = true;
                viewportTranslator.scheduleViewportTranslate(0);
                viewportTranslator.scheduleBackgroundTranslate(250);
            }, delay);
        }
    }
})();
