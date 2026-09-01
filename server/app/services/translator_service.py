import asyncio
import logging
import re

from app.clients.ollama_client import OllamaClient, OllamaError
from app.core.config import settings
from app.core.prompts import build_batch_translate_prompt, build_prompt
from app.schemas.translate import OllamaOptionsPayload, TranslateItem
from app.services.cache_service import TranslationCacheService
from app.services.glossary_service import GlossaryService
from app.services.model_service import canonicalize_model_name
from app.services.profile_service import get_translation_profile
from app.utils.language_detector import detect_language, should_skip_translation

logger = logging.getLogger(__name__)

BATCH_LINE_RE = re.compile(r"^\s*\[(\d+)\]\s*(.*)")
CHINESE_CHAR_RE = re.compile(r"[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]")
UNCHANGED_RESULT_FEEDBACK = "Hasil terjemahan sama dengan teks asli."

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
        self.model = canonicalize_model_name(model or settings.OLLAMA_MODEL)

    def translation_profile(self, options: OllamaOptionsPayload | None = None) -> str:
        return get_translation_profile(self.model, options)

    async def translate(
        self,
        text: str,
        mode: str,
        options: OllamaOptionsPayload | None = None,
    ) -> str:
        if mode == "translate" and should_skip_translation(text):
            return text

        # Check cache before calling Ollama
        profile = self.translation_profile(options)
        cached = await self.cache.get(text, mode, profile)
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
        validated, feedback = self._run_qa_pipeline(text, sanitized)

        if feedback == UNCHANGED_RESULT_FEEDBACK:
            logger.info("Translation unchanged; keeping the original text.")
        elif feedback:
            logger.warning("Translation QA rejected output: %s", feedback)

        if validated is not None:
            try:
                await self.cache.set(text, mode, validated, profile)
            except Exception as exc:
                logger.warning("Failed to write translation to cache: %s", exc)

        return validated or text

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

        profile = self.translation_profile(options)

        # Check cache for each translatable item (parallel lookups)
        cached_results: dict[str, str] = {}
        uncached_items: list[TranslateItem] = []

        async def _check_cache(item: TranslateItem) -> tuple[str, str | None]:
            try:
                cached = await self.cache.get(item.text, mode, profile)
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
        all_cache_entries: list[tuple[str, str, str, str]] = []

        for chunk in chunks:
            prompt_items = [{"id": item.id, "text": item.text} for item in chunk]
            prompt = build_batch_translate_prompt(items=prompt_items, mode=mode)
            raw_result = await self.ollama_client.generate(
                prompt,
                model=self.model,
                options=_options_to_dict(options),
                keep_alive=options.keep_alive if options else None,
            )

            try:
                parsed_results = self._parse_batch_result(raw_result, len(chunk))
            except ValueError as exc:
                logger.warning(
                    "Batch translation list parsing failed (chunk of %d items): %s",
                    len(chunk), exc,
                )
                logger.debug("Raw model output for failed batch chunk:\n%s", raw_result)
                fallback = await self._translate_items_individually(
                    items=chunk, mode=mode, options=options,
                )
                translated_results.update(fallback)
                continue

            for idx, text in parsed_results.items():
                item = chunk[idx]
                sanitized = self._sanitize_model_output(
                    original_text=item.text, translated_text=text,
                )
                validated, feedback = self._run_qa_pipeline(item.text, sanitized)
                if validated is not None:
                    translated_results[item.id] = validated
                    all_cache_entries.append((item.text, mode, validated, profile))
                elif feedback == UNCHANGED_RESULT_FEEDBACK:
                    # This is a valid terminal result for code, product names, and terms
                    # that should remain in English. Do not spend another request on fallback.
                    translated_results[item.id] = item.text
                elif feedback:
                    logger.warning("Batch QA rejected item id=%s: %s", item.id, feedback)

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
        if max_chars <= 0:
            raise ValueError("Ukuran chunk harus lebih dari nol.")
        oversized = [item.id for item in items if len(item.text) > max_chars]
        if oversized:
            raise ValueError(f"Item melebihi batas chunk: {', '.join(oversized)}")

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

    def _parse_batch_result(
        self, raw_result: str, expected_count: int,
    ) -> dict[int, str]:
        results: dict[int, str] = {}
        current_idx: int | None = None
        current_lines: list[str] = []

        def flush_current() -> None:
            if current_idx is None:
                return
            text = "\n".join(current_lines).strip()
            if text:
                results[current_idx] = text

        for line in raw_result.strip().split("\n"):
            m = BATCH_LINE_RE.match(line)
            if m:
                flush_current()
                idx = int(m.group(1)) - 1
                if 0 <= idx < expected_count:
                    current_idx = idx
                    current_lines = [m.group(2).strip()]
                else:
                    current_idx = None
                    current_lines = []
                continue

            if current_idx is not None:
                current_lines.append(line.rstrip())

        flush_current()

        if not results:
            raise ValueError("Model tidak mengembalikan format yang valid.")

        return results

    def _sanitize_model_output(self, original_text: str, translated_text: str) -> str | None:
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

        cleaned_text = cleaned_text.replace("\r\n", "\n").replace("\r", "\n")
        cleaned_text = re.sub(r"[ \t]+", " ", cleaned_text)
        cleaned_text = re.sub(r" *\n *", "\n", cleaned_text)
        cleaned_text = re.sub(r"\n{3,}", "\n\n", cleaned_text).strip()

        if any(marker.lower() in cleaned_text.lower() for marker in PROMPT_LEAK_MARKERS):
            logger.warning("Model output contains prompt leak marker. Returning None.")
            return None

        return cleaned_text or None

    def _check_equality(self, original_text: str, translated_text: str) -> bool:
        """Return True when the model output is effectively unchanged."""
        normalize = lambda value: re.sub(r"\s+", " ", value).strip().casefold()
        return normalize(original_text) == normalize(translated_text)

    def _check_untranslated(self, translated_text: str) -> str | None:
        """Return feedback when a sufficiently long result is still English."""
        language, confidence = detect_language(translated_text)
        if language == "en":
            return f"Hasil masih terdeteksi sebagai Bahasa Inggris (confidence={confidence:.2f})."
        return None

    def _check_chinese_chars(self, translated_text: str) -> str | None:
        """Reject accidental Chinese characters often emitted by the base model."""
        if CHINESE_CHAR_RE.search(translated_text):
            return "Hasil mengandung karakter Mandarin yang tidak diharapkan."
        return None

    def _run_qa_pipeline(
        self,
        original_text: str,
        translated_text: str | None,
    ) -> tuple[str | None, str | None]:
        """Validate and post-process a sanitized model result."""
        if not translated_text or not translated_text.strip():
            return None, "Hasil terjemahan kosong."

        candidate = translated_text.strip()

        if any(marker.lower() in candidate.lower() for marker in PROMPT_LEAK_MARKERS):
            return None, "Hasil mengandung bagian prompt internal."

        if self._check_equality(original_text, candidate):
            return None, UNCHANGED_RESULT_FEEDBACK

        feedback = self._check_chinese_chars(candidate)
        if feedback:
            return None, feedback

        feedback = self._check_untranslated(candidate)
        if feedback:
            return None, feedback

        corrected = GlossaryService.apply(candidate)
        return corrected, None

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
                validated, feedback = self._run_qa_pipeline(item.text, sanitized)
                results[item.id] = validated or item.text

                if validated is not None:
                    try:
                        await self.cache.set(
                            item.text,
                            mode,
                            validated,
                            self.translation_profile(options),
                        )
                    except Exception as exc:
                        logger.warning("Failed to cache single item id=%s: %s", item.id, exc)
                elif feedback:
                    logger.warning("Single item QA rejected id=%s: %s", item.id, feedback)
            except OllamaError:
                raise
            except Exception as exc:
                logger.warning("Single item translation failed for id=%s: %s", item.id, exc)
                results[item.id] = item.text

        return results
