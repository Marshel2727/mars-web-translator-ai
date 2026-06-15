(() => {
    globalThis.MarsTranslator = globalThis.MarsTranslator || {};

    const { API_BASE_URL } = globalThis.MarsTranslator.constants;

    async function translateBatch(items, mode = "translate") {
        const response = await fetch(`${API_BASE_URL}/api/v1/translate/batch`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                mode,
                items,
            }),
        });

        if (!response.ok) {
            throw new Error(`HTTP Error: ${response.status}`);
        }

        return response.json();
    }

    globalThis.MarsTranslator.api = {
        translateBatch,
    };
})();
