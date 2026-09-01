import hashlib
import logging
from pathlib import Path

import aiosqlite

logger = logging.getLogger(__name__)

_DB_PATH = Path(__file__).resolve().parent.parent.parent / "data" / "translation_cache.db"
_SCHEMA_VERSION = 2

_CREATE_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS translation_cache (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    text_hash TEXT NOT NULL,
    mode TEXT NOT NULL,
    translation_profile TEXT NOT NULL DEFAULT '',
    original_text TEXT NOT NULL,
    translated_text TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
)
"""

_CREATE_INDEX_SQL = """
CREATE UNIQUE INDEX IF NOT EXISTS idx_hash_mode_profile
ON translation_cache (text_hash, mode, translation_profile)
"""


class TranslationCacheService:
    """Async SQLite cache keyed by exact text semantics and translation profile."""

    _connection: aiosqlite.Connection | None = None

    @staticmethod
    def _normalize_text(text: str) -> str:
        return text.replace("\r\n", "\n").replace("\r", "\n")

    @classmethod
    def _hash(cls, text: str) -> str:
        normalized = cls._normalize_text(text)
        return hashlib.sha256(normalized.encode("utf-8")).hexdigest()

    @classmethod
    async def initialize(cls) -> None:
        if cls._connection is not None:
            return

        _DB_PATH.parent.mkdir(parents=True, exist_ok=True)
        cls._connection = await aiosqlite.connect(str(_DB_PATH))
        await cls._connection.execute("PRAGMA journal_mode=WAL")
        await cls._connection.execute("PRAGMA busy_timeout=5000")

        cursor = await cls._connection.execute("PRAGMA user_version")
        row = await cursor.fetchone()
        version = int(row[0] if row else 0)
        if version < _SCHEMA_VERSION:
            logger.info(
                "Migrating translation cache from schema %d to %d; old entries are removed.",
                version,
                _SCHEMA_VERSION,
            )
            await cls._connection.execute("DROP TABLE IF EXISTS translation_cache")
            await cls._connection.execute(f"PRAGMA user_version={_SCHEMA_VERSION}")

        await cls._connection.execute(_CREATE_TABLE_SQL)
        await cls._connection.execute(_CREATE_INDEX_SQL)
        await cls._connection.commit()

    @classmethod
    def _conn(cls) -> aiosqlite.Connection:
        if cls._connection is None:
            raise RuntimeError(
                "TranslationCacheService is not initialized. Call await initialize() first."
            )
        return cls._connection

    async def get(self, text: str, mode: str, translation_profile: str = "") -> str | None:
        cursor = await self._conn().execute(
            "SELECT translated_text FROM translation_cache "
            "WHERE text_hash = ? AND mode = ? AND translation_profile = ?",
            (self._hash(text), mode, translation_profile),
        )
        row = await cursor.fetchone()
        return row[0] if row else None

    async def set(
        self,
        text: str,
        mode: str,
        translated_text: str,
        translation_profile: str = "",
    ) -> None:
        await self._conn().execute(
            """
            INSERT OR REPLACE INTO translation_cache
                (text_hash, mode, translation_profile, original_text, translated_text)
            VALUES (?, ?, ?, ?, ?)
            """,
            (self._hash(text), mode, translation_profile, text, translated_text),
        )
        await self._conn().commit()

    async def set_batch(self, entries: list[tuple[str, str, str, str]]) -> None:
        if not entries:
            return
        await self._conn().executemany(
            """
            INSERT OR REPLACE INTO translation_cache
                (text_hash, mode, translation_profile, original_text, translated_text)
            VALUES (?, ?, ?, ?, ?)
            """,
            [
                (self._hash(text), mode, profile, text, translated_text)
                for text, mode, translated_text, profile in entries
            ],
        )
        await self._conn().commit()

    async def commit(self) -> None:
        await self._conn().commit()

    async def get_stats(self) -> dict:
        cursor = await self._conn().execute("SELECT COUNT(*) FROM translation_cache")
        row = await cursor.fetchone()
        return {
            "total_entries": row[0] if row else 0,
            "db_size_bytes": _DB_PATH.stat().st_size if _DB_PATH.exists() else 0,
            "schema_version": _SCHEMA_VERSION,
        }

    async def clear(self) -> None:
        await self._conn().execute("DELETE FROM translation_cache")
        await self._conn().commit()

    @classmethod
    async def close(cls) -> None:
        if cls._connection is not None:
            await cls._connection.close()
            cls._connection = None
