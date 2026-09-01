(() => {
    globalThis.MarsTranslator = globalThis.MarsTranslator || {};

    const {
        CACHE_SAVE_DELAY_MS,
        CACHE_STORAGE_KEY,
        LEGACY_CACHE_STORAGE_KEY,
        MAX_PERSISTENT_CACHE_ITEMS,
    } = globalThis.MarsTranslator.constants;

    function createTextReplacer({
        originalTextMap,
        translationCache,
        isTranslatableNode,
        getApplyingState,
        setApplyingState,
        getCacheContext,
    }) {
        let cacheSaveTimer = null;

        function normalizeCacheText(text) {
            return String(text).replace(/\r\n/g, "\n").replace(/\r/g, "\n");
        }

        function getCacheKey(text, explicitContext) {
            const context = explicitContext || getCacheContext?.();
            if (!context?.translationProfile || !context?.model) return null;
            return JSON.stringify([
                "translate",
                context.translationProfile,
                context.model,
                context.optionsFingerprint || "",
                normalizeCacheText(text),
            ]);
        }

        function getCachedTranslation(text, context) {
            const cacheKey = getCacheKey(text, context);
            return cacheKey ? translationCache.get(cacheKey) : undefined;
        }

        function setCachedTranslation(text, translatedText, context) {
            const cacheKey = getCacheKey(text, context);
            const normalizedOriginal = normalizeCacheText(text);
            const normalizedTranslation = normalizeCacheText(translatedText || "");
            if (!cacheKey || !normalizedOriginal || !normalizedTranslation) return;
            if (normalizedOriginal === normalizedTranslation) return;

            if (translationCache.has(cacheKey)) translationCache.delete(cacheKey);
            translationCache.set(cacheKey, translatedText);
            trimTranslationCache();
            schedulePersistentCacheSave();
        }

        function trimTranslationCache() {
            while (translationCache.size > MAX_PERSISTENT_CACHE_ITEMS) {
                const oldestKey = translationCache.keys().next().value;
                translationCache.delete(oldestKey);
            }
        }

        async function initializePersistentCache() {
            if (!globalThis.chrome?.storage?.local) return;
            await chrome.storage.local.remove(LEGACY_CACHE_STORAGE_KEY);
            const data = await chrome.storage.local.get(CACHE_STORAGE_KEY);
            const storedCache = data[CACHE_STORAGE_KEY];
            if (!storedCache || typeof storedCache !== "object") return;

            for (const [key, value] of Object.entries(storedCache)) {
                if (typeof key === "string" && typeof value === "string") {
                    translationCache.set(key, value);
                }
            }
            trimTranslationCache();
        }

        function schedulePersistentCacheSave() {
            if (!globalThis.chrome?.storage?.local) return;
            if (cacheSaveTimer) clearTimeout(cacheSaveTimer);
            cacheSaveTimer = setTimeout(() => {
                cacheSaveTimer = null;
                savePersistentCache().catch((error) => {
                    console.warn("Mars Translator gagal menyimpan cache:", error);
                });
            }, CACHE_SAVE_DELAY_MS);
        }

        async function savePersistentCache() {
            if (!globalThis.chrome?.storage?.local) return;
            trimTranslationCache();
            await chrome.storage.local.set({
                [CACHE_STORAGE_KEY]: Object.fromEntries(translationCache),
            });
        }

        function applyTranslation(node, originalText, translatedText, options = {}) {
            if (!translatedText) return false;
            if (normalizeCacheText(originalText) === normalizeCacheText(translatedText)) {
                if (options.markProcessed && !originalTextMap.has(node)) {
                    originalTextMap.set(node, originalText);
                }
                return false;
            }

            const leadingSpace = originalText.match(/^\s*/)?.[0] || "";
            const trailingSpace = originalText.match(/\s*$/)?.[0] || "";
            if (options.saveToCache !== false) {
                setCachedTranslation(originalText, translatedText, options.cacheContext);
            }
            if (!originalTextMap.has(node)) originalTextMap.set(node, originalText);
            node.nodeValue = `${leadingSpace}${translatedText}${trailingSpace}`;
            return true;
        }

        function applyCachedTranslations(nodes, context) {
            if (!(context || getCacheContext?.())?.translationProfile) return 0;
            let appliedCount = 0;
            for (const node of nodes) {
                const originalText = node.nodeValue;
                const cachedTranslation = getCachedTranslation(originalText, context);
                if (!cachedTranslation || !isTranslatableNode(node)) continue;
                if (applyTranslation(node, originalText, cachedTranslation, {
                    saveToCache: false,
                    cacheContext: context,
                })) {
                    appliedCount += 1;
                }
            }
            return appliedCount;
        }

        function restoreOriginalText() {
            setApplyingState(true);
            originalTextMap.forEach((originalText, node) => {
                if (node.parentElement && document.body.contains(node.parentElement)) {
                    node.nodeValue = originalText;
                }
            });
            originalTextMap.clear();
            setTimeout(() => setApplyingState(false), 0);
        }

        return {
            applyCachedTranslations,
            applyTranslation,
            getCachedTranslation,
            setCachedTranslation,
            initializePersistentCache,
            restoreOriginalText,
        };
    }

    globalThis.MarsTranslator.createTextReplacer = createTextReplacer;
})();
