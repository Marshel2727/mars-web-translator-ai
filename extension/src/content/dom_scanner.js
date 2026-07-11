(() => {
    globalThis.MarsTranslator = globalThis.MarsTranslator || {};

    const { SKIP_SELECTOR } = globalThis.MarsTranslator.constants;
    const languageDetector = globalThis.MarsTranslator.languageDetector;

    const SYNTAX_HIGHLIGHT_PATTERN = /\b(hljs|highlight|prism|shiki|CodeMirror|monaco|code-block|syntax|token|language-)\b/i;

    function isVisibleElement(element) {
        const style = window.getComputedStyle(element);
        const rect = element.getBoundingClientRect();

        return (
            style.display !== "none" &&
            style.visibility !== "hidden" &&
            style.opacity !== "0" &&
            rect.width > 0 &&
            rect.height > 0
        );
    }

    function isElementInViewport(element) {
        const rect = element.getBoundingClientRect();

        return (
            rect.bottom > 0 &&
            rect.right > 0 &&
            rect.top < window.innerHeight &&
            rect.left < window.innerWidth
        );
    }

    function isGoodText(text) {
        if (!text) return false;

        const cleanText = text.trim();

        if (cleanText.length < 10) return false;
        if (/^[{}[\]();.,:<>/\\|`'"-]+$/.test(cleanText)) return false;

        return true;
    }

    function hasSyntaxHighlightAncestor(element) {
        let current = element;
        while (current && current !== document.body) {
            if (current.className && typeof current.className === "string" && SYNTAX_HIGHLIGHT_PATTERN.test(current.className)) {
                return true;
            }
            if (current.dataset && (current.dataset.language || current.dataset.lang)) {
                return true;
            }
            current = current.parentElement;
        }
        return false;
    }

    function isTranslatableNode(node, options = {}, originalTextMap = new Map()) {
        const parent = node.parentElement;
        const text = node.nodeValue?.trim();

        if (languageDetector.isIndonesianPage()) return false;
        if (!parent) return false;
        if (!document.body.contains(parent)) return false;
        if (parent.closest(SKIP_SELECTOR)) return false;
        if (hasSyntaxHighlightAncestor(parent)) return false;
        if (originalTextMap.has(node)) return false;
        if (!isVisibleElement(parent)) return false;
        if (options.visibleOnly && !isElementInViewport(parent)) return false;
        if (!isGoodText(text)) return false;
        if (languageDetector.shouldSkipTranslation(text)) return false;

        return true;
    }

    function collectTextNodes(options = {}, originalTextMap = new Map()) {
        const nodes = [];
        const limit = options.limit ?? Infinity;
        const walker = document.createTreeWalker(
            document.body,
            NodeFilter.SHOW_TEXT,
            {
                acceptNode(node) {
                    if (!isTranslatableNode(node, options, originalTextMap)) {
                        return NodeFilter.FILTER_REJECT;
                    }

                    return NodeFilter.FILTER_ACCEPT;
                },
            }
        );

        let node = walker.nextNode();
        while (node && nodes.length < limit) {
            nodes.push(node);
            node = walker.nextNode();
        }

        return nodes;
    }

    function cleanupState(originalTextMap, nodeSets) {
        originalTextMap.forEach((originalText, node) => {
            if (!node.parentElement || !document.body.contains(node.parentElement)) {
                originalTextMap.delete(node);
            }
        });

        nodeSets.queuedNodeSet.forEach((node) => {
            if (!node.parentElement || !document.body.contains(node.parentElement) || originalTextMap.has(node)) {
                nodeSets.queuedNodeSet.delete(node);
                nodeSets.priorityNodeSet.delete(node);
                nodeSets.backgroundNodeSet.delete(node);
            }
        });
    }

    globalThis.MarsTranslator.domScanner = {
        collectTextNodes,
        cleanupState,
        isTranslatableNode,
    };
})();
