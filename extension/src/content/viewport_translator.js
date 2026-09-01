(() => {
    globalThis.MarsTranslator = globalThis.MarsTranslator || {};

    const {
        BACKGROUND_BATCH_PAUSE_MS,
        BACKGROUND_TRANSLATE_DELAY_MS,
        MAX_BACKGROUND_NODES_PER_SCAN,
        MAX_BATCH_SIZE,
        MAX_PRIORITY_NODES_PER_SCAN,
        PRIORITY_TRANSLATE_DELAY_MS,
    } = globalThis.MarsTranslator.constants;

    function createViewportTranslator({ state, domScanner, textReplacer, api }) {
        function enqueueNodes(nodes, queueType) {
            const queue = queueType === "priority" ? state.priorityQueue : state.backgroundQueue;
            const queueSet = queueType === "priority" ? state.priorityNodeSet : state.backgroundNodeSet;
            let queuedCount = 0;

            for (const node of nodes) {
                if (!domScanner.isTranslatableNode(node, {}, state.originalTextMap)) continue;

                const cachedTranslation = textReplacer.getCachedTranslation(node.nodeValue, state.cacheContext);
                if (cachedTranslation) continue;

                if (queueSet.has(node)) continue;
                if (queueType === "background" && state.queuedNodeSet.has(node)) continue;

                queue.push(node);
                queueSet.add(node);
                state.queuedNodeSet.add(node);
                queuedCount += 1;
            }

            return queuedCount;
        }

        function dequeueBatch(queueType) {
            const queue = queueType === "priority" ? state.priorityQueue : state.backgroundQueue;
            const queueSet = queueType === "priority" ? state.priorityNodeSet : state.backgroundNodeSet;
            const batch = [];
            const configuredBatchSize = Number.isFinite(state.maxBatchSize)
                ? state.maxBatchSize
                : MAX_BATCH_SIZE;
            const batchSize = Math.max(1, Math.min(configuredBatchSize, MAX_BATCH_SIZE));

            while (queue.length > 0 && batch.length < batchSize) {
                const node = queue.shift();
                queueSet.delete(node);

                if (!domScanner.isTranslatableNode(node, {}, state.originalTextMap)) {
                    state.queuedNodeSet.delete(node);
                    continue;
                }

                batch.push(node);
            }

            return batch;
        }

        function cleanupState() {
            domScanner.cleanupState(state.originalTextMap, {
                queuedNodeSet: state.queuedNodeSet,
                priorityNodeSet: state.priorityNodeSet,
                backgroundNodeSet: state.backgroundNodeSet,
            });
        }

        function enqueueViewportText() {
            if (!document.body) return 0;

            cleanupState();
            const nodes = domScanner.collectTextNodes({
                visibleOnly: true,
                limit: MAX_PRIORITY_NODES_PER_SCAN,
            }, state.originalTextMap);
            const cachedCount = textReplacer.applyCachedTranslations(nodes, state.cacheContext);
            const queuedCount = enqueueNodes(nodes, "priority");

            return cachedCount + queuedCount;
        }

        function enqueueBackgroundText() {
            if (!document.body) return 0;

            cleanupState();
            const nodes = domScanner.collectTextNodes({
                visibleOnly: false,
                limit: MAX_BACKGROUND_NODES_PER_SCAN,
            }, state.originalTextMap);
            const cachedCount = textReplacer.applyCachedTranslations(nodes, state.cacheContext);
            const queuedCount = enqueueNodes(nodes, "background");

            return cachedCount + queuedCount;
        }

        async function translateNodeBatch(batchNodes, pageToken) {
            const nodeById = new Map();
            const items = batchNodes.map((node, index) => {
                const originalText = node.nodeValue;
                const id = `mars-${Date.now()}-${index}`;

                nodeById.set(id, {
                    node,
                    originalText,
                });

                return {
                    id,
                    text: originalText.trim(),
                };
            });

            const data = await api.translateBatch(items);

            if (pageToken !== state.activePageToken) {
                return 0;
            }

            if (data.model) {
                state.activeModel = data.model;
            }
            if (data.translation_profile && data.model) {
                globalThis.MarsTranslator.updateTranslationProfile?.(
                    data.translation_profile,
                    data.model,
                );
            }

            let translatedCount = 0;
            state.isApplyingTranslations = true;

            for (const result of data.results) {
                const saved = nodeById.get(result.id);

                if (!saved) continue;
                if (!saved.node.parentElement || !document.body.contains(saved.node.parentElement)) continue;
                if (saved.node.nodeValue !== saved.originalText) continue;

                const applied = textReplacer.applyTranslation(
                    saved.node,
                    saved.originalText,
                    result.translated_text,
                    {
                        cacheContext: state.cacheContext,
                        markProcessed: true,
                    },
                );
                if (applied) translatedCount += 1;
            }

            setTimeout(() => {
                state.isApplyingTranslations = false;
            }, 0);

            return translatedCount;
        }

        function releaseQueuedNodes(nodes) {
            for (const node of nodes) {
                state.queuedNodeSet.delete(node);
                state.priorityNodeSet.delete(node);
                state.backgroundNodeSet.delete(node);
            }
        }

        async function processQueues(pageToken = state.activePageToken) {
            if (state.isProcessingQueue || !state.autoTranslateEnabled) {
                return {
                    ok: true,
                    message: "Terjemahan sedang berjalan",
                };
            }

            state.isProcessingQueue = true;
            let translatedCount = 0;

            try {
                while (state.autoTranslateEnabled && pageToken === state.activePageToken) {
                    const queueType = state.priorityQueue.length > 0 ? "priority" : "background";

                    if (queueType === "background" && state.backgroundQueue.length === 0) break;
                    if (queueType === "priority" && state.priorityQueue.length === 0) break;

                    const batchNodes = dequeueBatch(queueType);
                    if (batchNodes.length === 0) continue;

                    try {
                        translatedCount += await translateNodeBatch(batchNodes, pageToken);
                    } finally {
                        releaseQueuedNodes(batchNodes);
                    }

                    if (queueType === "background") {
                        await wait(BACKGROUND_BATCH_PAUSE_MS);
                    }
                }
            } finally {
                state.isProcessingQueue = false;
            }

            if (
                state.autoTranslateEnabled &&
                pageToken === state.activePageToken &&
                (state.priorityQueue.length > 0 || state.backgroundQueue.length > 0)
            ) {
                scheduleQueueProcessing(0);
            }

            return {
                ok: true,
                message: `${translatedCount} teks berhasil diterjemahkan`,
            };
        }

        async function translateViewportNow() {
            const queuedOrCachedCount = enqueueViewportText();

            if (queuedOrCachedCount === 0) {
                return {
                    ok: false,
                    message: "Tidak ada teks yang memenuhi syarat untuk diterjemahkan",
                };
            }

            return processQueues(state.activePageToken);
        }

        function scheduleViewportTranslate(delay = PRIORITY_TRANSLATE_DELAY_MS) {
            if (!state.autoTranslateEnabled || !document.body) return;

            if (state.priorityTimer) {
                clearTimeout(state.priorityTimer);
            }

            const pageToken = state.activePageToken;

            state.priorityTimer = setTimeout(() => {
                state.priorityTimer = null;
                enqueueViewportText();
                scheduleQueueProcessing(0, pageToken);
            }, delay);
        }

        function scheduleBackgroundTranslate(delay = BACKGROUND_TRANSLATE_DELAY_MS) {
            if (!state.autoTranslateEnabled || !document.body) return;

            if (state.backgroundTimer) {
                clearTimeout(state.backgroundTimer);
            }

            const pageToken = state.activePageToken;

            state.backgroundTimer = setTimeout(() => {
                state.backgroundTimer = null;
                enqueueBackgroundText();
                scheduleQueueProcessing(0, pageToken);
            }, delay);
        }

        function scheduleQueueProcessing(delay = 0, pageToken = state.activePageToken) {
            setTimeout(() => {
                processQueues(pageToken).catch((error) => {
                    console.error("Mars Translator gagal menerjemahkan antrean:", error);
                });
            }, delay);
        }

        function resetQueues() {
            state.priorityQueue = [];
            state.backgroundQueue = [];
            state.queuedNodeSet.clear();
            state.priorityNodeSet.clear();
            state.backgroundNodeSet.clear();
        }

        function clearTimers() {
            if (state.priorityTimer) {
                clearTimeout(state.priorityTimer);
                state.priorityTimer = null;
            }

            if (state.backgroundTimer) {
                clearTimeout(state.backgroundTimer);
                state.backgroundTimer = null;
            }
        }

        function restoreOriginalText() {
            state.autoTranslateEnabled = false;
            clearTimers();
            resetQueues();
            textReplacer.restoreOriginalText();
        }

        function handlePageChange() {
            state.activePageToken += 1;
            state.autoTranslateEnabled = state.autoTranslatePreference;
            clearTimers();
            resetQueues();
            scheduleViewportTranslate(PRIORITY_TRANSLATE_DELAY_MS);
            scheduleBackgroundTranslate(BACKGROUND_TRANSLATE_DELAY_MS);
        }

        function handleModelChange(model) {
            const shouldTranslate = state.autoTranslateEnabled;
            state.activePageToken += 1;
            state.activeModel = model || null;
            state.translationProfile = null;
            state.cacheContext = null;
            clearTimers();
            resetQueues();
            textReplacer.restoreOriginalText();
            state.autoTranslateEnabled = shouldTranslate;

            if (shouldTranslate) {
                scheduleViewportTranslate(0);
                scheduleBackgroundTranslate(BACKGROUND_TRANSLATE_DELAY_MS);
            }
        }

        function wait(ms) {
            return new Promise((resolve) => setTimeout(resolve, ms));
        }

        return {
            clearTimers,
            handleModelChange,
            handlePageChange,
            restoreOriginalText,
            scheduleBackgroundTranslate,
            scheduleViewportTranslate,
            translateViewportNow,
        };
    }

    globalThis.MarsTranslator.createViewportTranslator = createViewportTranslator;
})();
