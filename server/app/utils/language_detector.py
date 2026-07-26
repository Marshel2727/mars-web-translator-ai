import re


INDONESIAN_WORDS = {
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
}

ENGLISH_WORDS = {
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
}


def _normalize_words(text: str) -> list[str]:
    normalized = re.sub(r"[^a-z\s-]", " ", text.lower())
    return [word for word in normalized.split() if len(word) >= 2]


def detect_language(text: str) -> tuple[str, float]:
    words = _normalize_words(text)

    if len(words) < 4:
        return "unknown", 0.0

    indonesian_hits = sum(1 for word in words if word in INDONESIAN_WORDS)
    english_hits = sum(1 for word in words if word in ENGLISH_WORDS)
    indonesian_score = indonesian_hits / len(words)
    english_score = english_hits / len(words)

    if indonesian_hits >= 2 and indonesian_score >= 0.18 and indonesian_score > english_score:
        return "id", indonesian_score

    if english_hits >= 2 and english_score >= 0.16 and english_score > indonesian_score * 1.2:
        return "en", english_score

    return "unknown", max(indonesian_score, english_score)


def should_skip_translation(text: str) -> bool:
    language, _confidence = detect_language(text)
    return language == "id"
