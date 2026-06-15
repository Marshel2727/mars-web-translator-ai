(() => {
    globalThis.MarsTranslator = globalThis.MarsTranslator || {};

    const {
        CACHE_SAVE_DELAY_MS,
        CACHE_STORAGE_KEY,
        MAX_PERSISTENT_CACHE_ITEMS,
    } = globalThis.MarsTranslator.constants;

    function createTextReplacer({ originalTextMap, translationCache, isTranslatableNode, getApplyingState, setApplyingState }) {
        let cacheSaveTimer = null;

        function normalizeCacheText(text) {
            return text.trim().replace(/\s+/g, " ");
        }

        function getCacheKey(text) {
            return `translate:id:${normalizeCacheText(text)}`;
        }

        function getCachedTranslation(text) {
            return translationCache.get(getCacheKey(text));
        }

        function setCachedTranslation(text, translatedText) {
            const cacheKey = getCacheKey(text);

            if (!normalizeCacheText(text) || !translatedText) return;

            if (translationCache.has(cacheKey)) {
                translationCache.delete(cacheKey);
            }

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

            if (cacheSaveTimer) {
                clearTimeout(cacheSaveTimer);
            }

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
            const leadingSpace = originalText.match(/^\s*/)?.[0] || "";
            const trailingSpace = originalText.match(/\s*$/)?.[0] || "";

            if (options.saveToCache !== false) {
                setCachedTranslation(originalText, translatedText);
            }

            originalTextMap.set(node, originalText);
            node.nodeValue = `${leadingSpace}${translatedText}${trailingSpace}`;
        }

        function applyCachedTranslations(nodes) {
            let appliedCount = 0;

            setApplyingState(true);

            for (const node of nodes) {
                const originalText = node.nodeValue;
                const cachedTranslation = getCachedTranslation(originalText);

                if (!cachedTranslation) continue;
                if (!isTranslatableNode(node)) continue;

                applyTranslation(node, originalText, cachedTranslation, { saveToCache: false });
                appliedCount += 1;
            }

            setTimeout(() => {
                if (getApplyingState()) {
                    setApplyingState(false);
                }
            }, 0);

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

            setTimeout(() => {
                setApplyingState(false);
            }, 0);
        }

        return {
            applyCachedTranslations,
            applyTranslation,
            getCachedTranslation,
            initializePersistentCache,
            restoreOriginalText,
        };
    }

    globalThis.MarsTranslator.createTextReplacer = createTextReplacer;
})();
