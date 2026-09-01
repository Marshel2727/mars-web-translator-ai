(() => {
    // EXPERIMENTAL ONLY: intentionally omitted from manifest.json.
    // This scanner may retranslate only when the original source text is known;
    // the backend does not expose a separate "fix" mode.
    globalThis.MarsTranslator = globalThis.MarsTranslator || {};

    const CHINESE_RE = /[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]/;
    const PROMPT_LEAK_RE = /(?:ATURAN OUTPUT|Aturan:|ATURAN:|Jangan ubah kode|Jangan ubah nama|Format output wajib|<text_to_translate>|<\/text_to_translate>|<text_to_explain>|<\/text_to_explain>|\\end\{text_to_translate\}|\\end\{text_to_explain\}|INPUT MULAI|INPUT SELESAI)/i;

    const PROMPT_OUTPUT_RE = /^\s*(?:OUTPUT|Output|output)\s*:/i;
    const CODE_LIKE_RE = /(?:=>|->|\{|function\s*\(|const\s+\w+\s*=|let\s+\w+\s*=|var\s+\w+\s*=|if\s*\(|for\s*\(|while\s*\(|return\s+|import\s+|export\s+|class\s+|new\s+\w+\s*\()/;
    const JSON_LIKE_RE = /^\s*(?:\{[\s\S]*\}|\[[\s\S]*\])\s*$/;
    const IDENTIFIER_RE = /^[\w\s\-./:;,[\]{}()]+$/;

    const MAX_SCAN_NODES = 1000;
    const MIN_TEXT_LENGTH = 5;

    function hasChineseChars(text) {
        return CHINESE_RE.test(text);
    }

    function hasPromptLeak(text) {
        if (PROMPT_OUTPUT_RE.test(text) && text.length < 50) {
            return false;
        }
        return PROMPT_LEAK_RE.test(text);
    }

    function isCodeLike(text) {
        if (CODE_LIKE_RE.test(text)) return true;
        if (JSON_LIKE_RE.test(text)) return true;
        if (IDENTIFIER_RE.test(text) && text.length < 100) return false;
        const alphaRatio = (text.match(/[a-zA-Z]/g) || []).length / text.length;
        return alphaRatio < 0.4;
    }

    function isVisibleNode(node) {
        const parent = node.parentElement;
        if (!parent) return false;
        const style = window.getComputedStyle(parent);
        return (
            style.display !== "none" &&
            style.visibility !== "hidden" &&
            style.opacity !== "0"
        );
    }

    function scanPageForIssues(originalTextMap) {
        const issues = [];
        const seenTexts = new Set();

        const walker = document.createTreeWalker(
            document.body,
            NodeFilter.SHOW_TEXT,
            null,
            false
        );

        let node;
        let id = 0;
        while ((node = walker.nextNode()) && id < MAX_SCAN_NODES) {
            const text = node.nodeValue?.trim();
            if (!text || text.length < MIN_TEXT_LENGTH) continue;
            if (!isVisibleNode(node)) continue;
            if (isCodeLike(text)) continue;

            const issueTypes = [];
            if (hasChineseChars(text)) issueTypes.push("chinese");
            if (hasPromptLeak(text)) issueTypes.push("prompt_leak");

            if (issueTypes.length === 0) continue;

            const normalizedKey = text.slice(0, 100).toLowerCase();
            if (seenTexts.has(normalizedKey)) continue;
            seenTexts.add(normalizedKey);

            const originalText = originalTextMap.get(node) || null;

            issues.push({
                id: String(id++),
                node,
                text: text.slice(0, 200),
                issueTypes,
                originalText,
                canFix: originalText !== null && originalText !== text,
            });
        }

        return issues;
    }

    async function fixIssues(issues, api) {
        if (issues.length === 0) {
            return { fixed: 0, failed: 0, skipped: 0, total: 0 };
        }

        const translateItems = [];
        const skippedItems = [];

        for (const issue of issues) {
            if (issue.canFix && issue.originalText) {
                translateItems.push({ id: issue.id, text: issue.originalText });
            } else {
                skippedItems.push({ id: issue.id, text: issue.text });
            }
        }

        let fixed = 0;
        let failed = 0;

        // Phase 1: Translate mode (items with original English text)
        if (translateItems.length > 0) {
            try {
                const response = await api.translateBatch(translateItems, "translate");
                const results = response.results || [];
                for (const result of results) {
                    const issue = issues.find(i => i.id === result.id);
                    if (!issue) continue;

                    const translated = (result.translated_text || "").trim();
                    if (!translated || translated === issue.originalText || hasChineseChars(translated)) {
                        failed++;
                        continue;
                    }

                    applyToNode(issue.node, translated);
                    fixed++;
                }
            } catch (err) {
                failed += translateItems.length;
            }
        }

        const skipped = skippedItems.length + (translateItems.length - fixed - failed);
        return { fixed, failed, skipped, total: issues.length };
    }

    function applyToNode(node, newText) {
        const origValue = node.nodeValue;
        const leading = origValue.match(/^\s*/)?.[0] || "";
        const trailing = origValue.match(/\s*$/)?.[0] || "";
        node.nodeValue = leading + newText + trailing;
    }

    globalThis.MarsTranslator.pageScanner = {
        scanPageForIssues,
        fixIssues,
        hasChineseChars,
        hasPromptLeak,
    };
})();
