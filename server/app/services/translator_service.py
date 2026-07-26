import asyncio
import json
import logging
import re

from app.clients.ollama_client import OllamaClient
from app.core.config import settings
from app.core.prompts import build_batch_translate_prompt, build_prompt
from app.schemas.translate import OllamaOptionsPayload, TranslateItem
from app.services.cache_service import TranslationCacheService
from app.utils.language_detector import should_skip_translation

logger = logging.getLogger(__name__)

BATCH_JSON_SCHEMA = {
    "type": "object",
    "properties": {
        "results": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "id": {"type": "string"},
                    "translated_text": {"type": "string"},
                },
                "required": ["id", "translated_text"],
            },
        },
    },
    "required": ["results"],
}

PROMPT_LEAK_MARKERS = (
    "ATURAN OUTPUT",
    "Aturan:",
    "ATURAN:",
    "Jangan ubah kode",
    "Jangan ubah nama",
    "Format output wajib",
    "<text_to_translate>",
    "</text_to_translate>",
    "\\end{text_to_translate}",
    "<text_to_explain>",
    "</text_to_explain>",
    "\\end{text_to_explain}",
    "<input_json>",
    "</input_json>",
)


def _options_to_dict(options: OllamaOptionsPayload | None) -> dict | None:
    """Convert the Pydantic payload to a plain dict, excluding None values."""
    if options is None:
        return None
    result = {}
    for field in ("num_ctx", "num_predict", "temperature", "top_p"):
        val = getattr(options, field, None)
        if val is not None:
            result[field] = val
    return result or None


class TranslatorService:
    def __init__(self, model: str | None = None):
        self.ollama_client = OllamaClient()
        self.cache = TranslationCacheService()
        self.model = model or settings.OLLAMA_MODEL

    async def translate(
        self,
        text: str,
        mode: str,
        options: OllamaOptionsPayload | None = None,
    ) -> str:
        if mode == "translate" and should_skip_translation(text):
            return text

        # Check cache before calling Ollama
        cached = await self.cache.get(text, mode)
        if cached is not None:
            logger.info("Cache hit for mode=%s, text_len=%d", mode, len(text))
            return cached

        prompt = build_prompt(text=text, mode=mode)
        result = await self.ollama_client.generate(
            prompt,
            model=self.model,
            options=_options_to_dict(options),
            keep_alive=options.keep_alive if options else None,
        )
        sanitized = self._sanitize_model_output(original_text=text, translated_text=result)

        # Save to cache (non-blocking on errors)
        try:
            await self.cache.set(text, mode, sanitized)
        except Exception as exc:
            logger.warning("Failed to write translation to cache: %s", exc)

        return sanitized

    async def translate_batch(
        self,
        items: list[TranslateItem],
        mode: str,
        options: OllamaOptionsPayload | None = None,
    ) -> dict[str, str]:
        skipped_translations = {
            item.id: item.text
            for item in items
            if mode == "translate" and should_skip_translation(item.text)
        }
        translatable_items = [
            item
            for item in items
            if item.id not in skipped_translations
        ]

        if not translatable_items:
            return skipped_translations

        # Check cache for each translatable item (parallel lookups)
        cached_results: dict[str, str] = {}
        uncached_items: list[TranslateItem] = []

        async def _check_cache(item: TranslateItem) -> tuple[str, str | None]:
            try:
                cached = await self.cache.get(item.text, mode)
            except Exception:
                cached = None
            return item.id, cached

        cache_results = await asyncio.gather(
            *[_check_cache(item) for item in translatable_items]
        )
        for item_id, cached in cache_results:
            if cached is not None:
                cached_results[item_id] = cached
            else:
                uncached_items.append(
                    next(item for item in translatable_items if item.id == item_id)
                )

        cache_hits = len(cached_results)
        if cache_hits:
            logger.info(
                "Batch cache: %d hits, %d misses", cache_hits, len(uncached_items)
            )

        # If all items were cached, return early
        if not uncached_items:
            cached_results.update(skipped_translations)
            return cached_results

        chunks = self._chunk_items(uncached_items, settings.MAX_BATCH_CHARS)
        logger.info(
            "Batch split into %d chunk(s) for %d uncached items",
            len(chunks), len(uncached_items),
        )

        translated_results: dict[str, str] = {}
        all_cache_entries: list[tuple[str, str, str]] = []

        for chunk in chunks:
            prompt_items = [{"id": item.id, "text": item.text} for item in chunk]
            prompt = build_batch_translate_prompt(items=prompt_items, mode=mode)
            batch_options = dict(_options_to_dict(options) or {})
            batch_options.setdefault("num_predict", settings.DEFAULT_NUM_PREDICT * 2)
            raw_result = await self.ollama_client.generate(
                prompt,
                response_format=BATCH_JSON_SCHEMA,
                model=self.model,
                options=batch_options,
                keep_alive=options.keep_alive if options else None,
            )

            try:
                parsed_results = self._parse_batch_result(raw_result)
            except ValueError as exc:
                logger.warning(
                    "Batch translation JSON parsing failed (chunk of %d items): %s",
                    len(chunk), exc,
                )
                logger.debug("Raw model output for failed batch chunk:\n%s", raw_result)
                fallback = await self._translate_items_individually(
                    items=chunk, mode=mode, options=options,
                )
                translated_results.update(fallback)
                continue

            original_text_by_id = {item.id: item.text for item in chunk}
            for item in parsed_results:
                item_id = item.get("id")
                translated_text = item.get("translated_text")
                if item_id and translated_text:
                    sanitized = self._sanitize_model_output(
                        original_text=original_text_by_id.get(item_id, ""),
                        translated_text=translated_text,
                    )
                    translated_results[item_id] = sanitized
                    original = original_text_by_id.get(item_id)
                    if original:
                        all_cache_entries.append((original, mode, sanitized))

        if all_cache_entries:
            try:
                await self.cache.set_batch(all_cache_entries)
            except Exception as exc:
                logger.warning("Failed to cache batch results: %s", exc)

        missing_items = [
            item for item in uncached_items if item.id not in translated_results
        ]
        if missing_items:
            fallback_results = await self._translate_items_individually(
                items=missing_items, mode=mode, options=options,
            )
            translated_results.update(fallback_results)

        translated_results.update(cached_results)
        translated_results.update(skipped_translations)

        return translated_results

    def _chunk_items(
        self, items: list[TranslateItem], max_chars: int
    ) -> list[list[TranslateItem]]:
        """Split items into chunks where total text length <= max_chars per chunk."""
        chunks: list[list[TranslateItem]] = []
        current_chunk: list[TranslateItem] = []
        current_len = 0
        for item in items:
            if current_chunk and current_len + len(item.text) > max_chars:
                chunks.append(current_chunk)
                current_chunk = []
                current_len = 0
            current_chunk.append(item)
            current_len += len(item.text)
        if current_chunk:
            chunks.append(current_chunk)
        return chunks

    def _parse_batch_result(self, raw_result: str) -> list[dict[str, str]]:
        data = self._load_json_from_model_output(raw_result)

        if isinstance(data, dict):
            data = data.get("results")

        if not isinstance(data, list):
            raise ValueError("Format hasil model harus berupa list JSON.")

        return [
            item
            for item in data
            if isinstance(item, dict)
        ]

    def _load_json_from_model_output(self, raw_result: str) -> object:
        cleaned_result = self._repair_common_json_mistakes(raw_result)
        try:
            return json.loads(cleaned_result)
        except json.JSONDecodeError:
            pass

        # Coba ekstrak JSON object atau array dari dalam teks
        for pattern in (r"\{[\s\S]*\}", r"\[[\s\S]*\]"):
            # Gunakan greedy match untuk menangkap JSON terlengkap
            matches = list(re.finditer(pattern, cleaned_result))
            # Coba dari yang terpanjang (kemungkinan paling lengkap)
            matches_sorted = sorted(matches, key=lambda m: len(m.group(0)), reverse=True)
            for match in matches_sorted:
                candidate = self._repair_common_json_mistakes(match.group(0))
                try:
                    return json.loads(candidate)
                except json.JSONDecodeError:
                    # Coba perbaiki JSON yang terpotong
                    fixed = self._fix_truncated_json(candidate)
                    try:
                        return json.loads(fixed)
                    except json.JSONDecodeError:
                        continue

        raise ValueError("Model tidak mengembalikan JSON valid.")

    def _repair_common_json_mistakes(self, text: str) -> str:
        text = text.strip()

        # Hapus markdown code block (```json ... ``` atau ``` ... ```)
        text = re.sub(r"```(?:json)?\s*[\s\S]*?```", "", text)

        # Hapus kalimat penjelasan di awal sebelum JSON
        # Contoh: "Berikut hasilnya:" atau "Tentu, ini terjemahannya:"
        text = re.sub(r"^[^[{]*(?=[\[{])", "", text, flags=re.DOTALL)

        # Hapus kalimat di akhir setelah JSON
        text = re.sub(r"(?<=[}\]])[^}\]]*$", "", text, flags=re.DOTALL)

        # Perbaiki single quote menjadi double quote (hati-hati dengan apostrophe dalam teks)
        # Hanya ganti ' yang berperan sebagai delimiter JSON: 'value' setelah : , [ {
        text = re.sub(r"(?<=[{,:\[])'([^']*?)'(?=[,}\]:])", r'"\1"', text)

        # Hapus trailing comma sebelum } atau ]
        text = re.sub(r",\s*([}\]])", r"\1", text)

        # Hapus komentar JavaScript (// ...) - handle both with and without trailing newline
        text = re.sub(r"//[^\n]*", "", text)

        return text.strip()

    def _fix_truncated_json(self, text: str) -> str:
        """Coba perbaiki JSON yang terpotong di tengah dengan menutup bracket yang terbuka."""
        # Jika JSON terpotong di tengah string value (odd number of unescaped quotes),
        # tutup string dulu dengan menghapus sisa teks dari quote terakhir yang tidak tertutup.
        quote_positions = [
            i for i, ch in enumerate(text) if ch == '"' and (i == 0 or text[i - 1] != '\\')
        ]
        if len(quote_positions) % 2 != 0:
            # Find the last unclosed quote and take everything up to it
            last_quote = quote_positions[-1]
            # Check if there's content after the last quote that isn't a structural char
            remaining = text[last_quote + 1:].strip()
            if remaining and remaining[0] not in (',', '}', ']', ':'):
                # The quote is mid-value; truncate to the last complete key-value pair
                text = text[:last_quote]
                # Re-count quotes after truncation
                quote_positions = [
                    i for i, ch in enumerate(text) if ch == '"' and (i == 0 or text[i - 1] != '\\')
                ]

        if len(quote_positions) % 2 != 0:
            text += '"'

        # Hitung bracket yang terbuka
        open_braces = text.count('{') - text.count('}')
        open_brackets = text.count('[') - text.count(']')

        # Tutup semua bracket yang terbuka
        text += '}' * open_braces
        text += ']' * open_brackets

        # Hapus trailing comma yang mungkin muncul sebelum bracket penutup baru
        text = re.sub(r",\s*([}\]])", r"\1", text)
        return text

    def _sanitize_model_output(self, original_text: str, translated_text: str) -> str:
        cleaned_text = translated_text.strip()
        leak_patterns = (
            r"\s*(?:ATURAN OUTPUT|Aturan|ATURAN):[\s\S]*?(?:TEKS|INPUT MULAI|Input JSON|INPUT JSON|<text_to_translate>|<text_to_explain>|<input_json>):?\s*",
            r"\s*(?:Terjemahkan|Jelaskan)[\s\S]*?(?:TEKS|INPUT MULAI|<text_to_translate>|<text_to_explain>):?\s*",
            r"\s*(?:INPUT MULAI|INPUT SELESAI)\s*",
            r"\s*\\?(?:end)?</?(?:text_to_translate|text_to_explain|input_json|\\end\{text_to_translate\}|\\end\{text_to_explain\})>\s*",
            r"\\end\{text_to_translate\}",
            r"\\end\{text_to_explain\}",
        )

        for pattern in leak_patterns:
            cleaned_text = re.sub(pattern, " ", cleaned_text, flags=re.IGNORECASE)

        cleaned_text = re.sub(r"\s+", " ", cleaned_text).strip()

        if any(marker.lower() in cleaned_text.lower() for marker in PROMPT_LEAK_MARKERS):
            logger.warning("Model output still contains prompt leak marker. Returning original text.")
            return original_text

        return cleaned_text or original_text

    async def _translate_items_individually(
        self,
        items: list[TranslateItem],
        mode: str,
        options: OllamaOptionsPayload | None = None,
    ) -> dict[str, str]:
        """Translate items one by one as fallback. Skips cache/skip checks since items
        were already filtered as cache misses and translatable."""
        results: dict[str, str] = {}
        for item in items:
            try:
                prompt = build_prompt(text=item.text, mode=mode)
                result = await self.ollama_client.generate(
                    prompt,
                    model=self.model,
                    options=_options_to_dict(options),
                    keep_alive=options.keep_alive if options else None,
                )
                sanitized = self._sanitize_model_output(
                    original_text=item.text, translated_text=result
                )
                results[item.id] = sanitized

                try:
                    await self.cache.set(item.text, mode, sanitized)
                except Exception as exc:
                    logger.warning("Failed to cache single item id=%s: %s", item.id, exc)
            except Exception as exc:
                logger.warning("Single item translation failed for id=%s: %s", item.id, exc)
                results[item.id] = item.text

        return results
