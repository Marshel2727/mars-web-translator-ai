import json
import hashlib
import logging
import re
from pathlib import Path

logger = logging.getLogger(__name__)

_GLOSSARY_PATH = Path(__file__).resolve().parent.parent / "data" / "glossary.json"


class GlossaryService:
    _corrections: list[dict] | None = None
    _loaded_digest: str | None = None

    @classmethod
    def _load(cls) -> list[dict]:
        current_digest = cls.digest()
        if cls._corrections is not None and cls._loaded_digest == current_digest:
            return cls._corrections
        try:
            with open(_GLOSSARY_PATH, "r", encoding="utf-8") as f:
                data = json.load(f)
            cls._corrections = data.get("corrections", [])
            cls._loaded_digest = current_digest
            logger.info("Loaded %d glossary corrections", len(cls._corrections))
        except Exception as exc:
            logger.warning("Failed to load glossary from %s: %s", _GLOSSARY_PATH, exc)
            cls._corrections = []
            cls._loaded_digest = current_digest
        return cls._corrections

    @classmethod
    def apply(cls, text: str) -> str:
        if not text:
            return text
        corrections = cls._load()
        result = text
        for entry in corrections:
            try:
                result = re.sub(
                    entry["pattern"],
                    entry["replacement"],
                    result,
                )
            except re.error as exc:
                logger.debug("Skipping invalid glossary regex %r: %s", entry.get("pattern"), exc)
        if result != text:
            logger.debug("Glossary applied: %r -> %r", text[:60], result[:60])
        return result

    @classmethod
    def reload(cls) -> None:
        cls._corrections = None
        cls._loaded_digest = None
        cls._load()

    @classmethod
    def digest(cls) -> str:
        try:
            content = _GLOSSARY_PATH.read_bytes()
        except OSError:
            content = b""
        return hashlib.sha256(content).hexdigest()
