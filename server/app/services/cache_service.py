import hashlib
import logging
from pathlib import Path

import aiosqlite

logger = logging.getLogger(__name__)

_DB_PATH = Path(__file__).resolve().parent.parent.parent / "data" / "translation_cache.db"

_CREATE_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS translation_cache (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    text_hash TEXT NOT NULL,
    mode TEXT NOT NULL,
    original_text TEXT NOT NULL,
    translated_text TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
)
"""

_CREATE_INDEX_SQL = """
CREATE UNIQUE INDEX IF NOT EXISTS idx_hash_mode
ON translation_cache (text_hash, mode)
"""


class TranslationCacheService:
    """Async SQLite translation cache with class-level singleton connection."""

    _connection: aiosqlite.Connection | None = None

    @staticmethod
    def _hash(text: str) -> str:
        normalized = text.strip().lower()
        return hashlib.sha256(normalized.encode("utf-8")).hexdigest()

    @classmethod
    async def initialize(cls) -> None:
        """Create the data directory, open a shared DB connection, and ensure the table exists."""
        if cls._connection is not None:
            return

        _DB_PATH.parent.mkdir(parents=True, exist_ok=True)
        logger.info("Opening translation cache DB at %s", _DB_PATH)

        cls._connection = await aiosqlite.connect(str(_DB_PATH))
        await cls._connection.execute(_CREATE_TABLE_SQL)
        await cls._connection.execute(_CREATE_INDEX_SQL)
        await cls._connection.commit()

        logger.info("Translation cache initialized successfully.")

    @classmethod
    def _conn(cls) -> aiosqlite.Connection:
        if cls._connection is None:
            raise RuntimeError(
                "TranslationCacheService is not initialized. Call await initialize() first."
            )
        return cls._connection

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    async def get(self, text: str, mode: str) -> str | None:
        """Return the cached translation for *text* + *mode*, or ``None``."""
        text_hash = self._hash(text)
        cursor = await self._conn().execute(
            "SELECT translated_text FROM translation_cache WHERE text_hash = ? AND mode = ?",
            (text_hash, mode),
        )
        row = await cursor.fetchone()
        return row[0] if row else None

    async def set(self, text: str, mode: str, translated_text: str) -> None:
        """Store a translation result, replacing any existing entry for the same hash+mode."""
        text_hash = self._hash(text)
        await self._conn().execute(
            """
            INSERT OR REPLACE INTO translation_cache (text_hash, mode, original_text, translated_text)
            VALUES (?, ?, ?, ?)
            """,
            (text_hash, mode, text, translated_text),
        )
        await self._conn().commit()

    async def get_stats(self) -> dict:
        """Return basic cache statistics."""
        cursor = await self._conn().execute("SELECT COUNT(*) FROM translation_cache")
        row = await cursor.fetchone()
        total_entries = row[0] if row else 0

        db_size_bytes = _DB_PATH.stat().st_size if _DB_PATH.exists() else 0

        return {
            "total_entries": total_entries,
            "db_size_bytes": db_size_bytes,
        }

    async def clear(self) -> None:
        """Delete all cached translations."""
        await self._conn().execute("DELETE FROM translation_cache")
        await self._conn().commit()
        logger.info("Translation cache cleared.")

    @classmethod
    async def close(cls) -> None:
        """Close the shared database connection."""
        if cls._connection is not None:
            await cls._connection.close()
            cls._connection = None
            logger.info("Translation cache DB connection closed.")
