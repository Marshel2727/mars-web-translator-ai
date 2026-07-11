const API_BASE = "http://127.0.0.1:8000";

chrome.runtime.onInstalled.addListener(() => {
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
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
    if (!info.selectionText || !tab?.id) return;

    const mode = info.menuItemId === "mars-explain-selection" ? "explain" : "translate";
    const selectedText = info.selectionText.trim();

    if (selectedText.length < 3) return;

    try {
        const response = await fetch(`${API_BASE}/api/v1/translate/batch`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                mode,
                items: [{ id: "ctx-1", text: selectedText }],
            }),
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();
        const translatedText = data.results?.[0]?.translated_text || "Tidak ada hasil.";

        await chrome.tabs.sendMessage(tab.id, {
            type: "SHOW_TRANSLATION_TOOLTIP",
            text: translatedText,
            mode,
        });
    } catch (error) {
        console.error("Mars Translator context menu error:", error);
        await chrome.tabs.sendMessage(tab.id, {
            type: "SHOW_TRANSLATION_TOOLTIP",
            text: `Error: ${error.message}`,
            mode: "error",
        });
    }
});
