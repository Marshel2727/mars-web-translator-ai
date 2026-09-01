(() => {
    globalThis.MarsTranslator = globalThis.MarsTranslator || {};

    const base = globalThis.MarsTranslator.constants?.MESSAGE_TYPES || {
        TRANSLATE_VISIBLE_TEXT: "TRANSLATE_VISIBLE_TEXT",
        RESTORE_ORIGINAL_TEXT: "RESTORE_ORIGINAL_TEXT",
        SHOW_TRANSLATION_TOOLTIP: "SHOW_TRANSLATION_TOOLTIP",
        GET_STATS: "GET_STATS",
    };

    globalThis.MarsTranslator.messageTypes = {
        ...base,
        RESTORE_SUBTITLE: "RESTORE_SUBTITLE",
        CHECK_SUBTITLE_STATUS: "CHECK_SUBTITLE_STATUS",
        MODEL_CHANGED: "MODEL_CHANGED",
    };
})();
