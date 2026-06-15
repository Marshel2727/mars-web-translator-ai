(() => {
    globalThis.MarsTranslator = globalThis.MarsTranslator || {};

    const INDONESIAN_WORDS = new Set([
        "ada",
        "adalah",
        "agar",
        "akan",
        "anda",
        "apa",
        "atau",
        "bagaimana",
        "bagi",
        "bahasa",
        "bisa",
        "cara",
        "dalam",
        "dan",
        "dari",
        "dengan",
        "di",
        "ini",
        "itu",
        "jika",
        "juga",
        "karena",
        "ke",
        "kembali",
        "lebih",
        "melalui",
        "menggunakan",
        "pada",
        "sebagai",
        "sudah",
        "tersebut",
        "tidak",
        "untuk",
        "yang",
    ]);

    const ENGLISH_WORDS = new Set([
        "about",
        "and",
        "are",
        "as",
        "be",
        "by",
        "can",
        "for",
        "from",
        "how",
        "if",
        "in",
        "into",
        "is",
        "it",
        "of",
        "on",
        "or",
        "that",
        "the",
        "this",
        "to",
        "use",
        "using",
        "with",
        "you",
        "your",
    ]);

    const INDONESIAN_LANG_PREFIXES = ["id", "id-id"];

    function normalizeWords(text) {
        return text
            .toLowerCase()
            .replace(/[^a-z\s-]/g, " ")
            .split(/\s+/)
            .filter((word) => word.length >= 2);
    }

    function isIndonesianPage() {
        const lang = document.documentElement.lang?.trim().toLowerCase();

        if (!lang) return false;

        return INDONESIAN_LANG_PREFIXES.some((prefix) => lang === prefix || lang.startsWith(`${prefix}-`));
    }

    function detectLanguage(text) {
        const words = normalizeWords(text);

        if (words.length < 4) {
            return {
                language: "unknown",
                confidence: 0,
            };
        }

        const indonesianHits = words.filter((word) => INDONESIAN_WORDS.has(word)).length;
        const englishHits = words.filter((word) => ENGLISH_WORDS.has(word)).length;
        const indonesianScore = indonesianHits / words.length;
        const englishScore = englishHits / words.length;

        if (indonesianHits >= 2 && indonesianScore >= 0.18 && indonesianScore > englishScore * 1.35) {
            return {
                language: "id",
                confidence: indonesianScore,
            };
        }

        if (englishHits >= 2 && englishScore >= 0.16 && englishScore > indonesianScore) {
            return {
                language: "en",
                confidence: englishScore,
            };
        }

        return {
            language: "unknown",
            confidence: Math.max(indonesianScore, englishScore),
        };
    }

    function shouldSkipTranslation(text) {
        return detectLanguage(text).language === "id";
    }

    globalThis.MarsTranslator.languageDetector = {
        detectLanguage,
        isIndonesianPage,
        shouldSkipTranslation,
    };
})();
