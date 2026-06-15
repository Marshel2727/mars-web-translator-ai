(() => {
    globalThis.MarsTranslator = globalThis.MarsTranslator || {};

    const messageTypes = globalThis.MarsTranslator.constants?.MESSAGE_TYPES || {
        TRANSLATE_VISIBLE_TEXT: "TRANSLATE_VISIBLE_TEXT",
        RESTORE_ORIGINAL_TEXT: "RESTORE_ORIGINAL_TEXT",
    };

    globalThis.MarsTranslator.messageTypes = messageTypes;
})();
