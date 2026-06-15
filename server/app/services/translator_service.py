import json
import logging
import re

from app.clients.ollama_client import OllamaClient
from app.core.prompts import build_batch_translate_prompt, build_prompt
from app.schemas.translate import TranslateItem
from app.utils.language_detector import should_skip_translation

logger = logging.getLogger(__name__)

PROMPT_LEAK_MARKERS = (
    "ATURAN OUTPUT",
    "Aturan:",
    "ATURAN:",
    "Jangan ubah kode",
    "Jangan ubah nama",
    "Jawab langsung",
    "Format output wajib",
    "Input JSON",
    "INPUT MULAI",
    "INPUT SELESAI",
    "TEKS:",
)

class TranslatorService:
    def __init__(self):
        self.ollama_client = OllamaClient()
        
    async def translate(self, text: str, mode: str) -> str:
        if mode == "translate" and should_skip_translation(text):
            return text

        prompt = build_prompt(text=text, mode=mode)
        result = await self.ollama_client.generate(prompt)
        return self._sanitize_model_output(original_text=text, translated_text=result)

    async def translate_batch(self, items: list[TranslateItem], mode: str) -> dict[str, str]:
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

        prompt_items = [
            {
                "id": item.id,
                "text": item.text,
            }
            for item in translatable_items
        ]
        prompt = build_batch_translate_prompt(items=prompt_items, mode=mode)
        raw_result = await self.ollama_client.generate(prompt, response_format="json")

        try:
            parsed_results = self._parse_batch_result(raw_result)
        except ValueError as exc:
            logger.warning("Batch translation JSON parsing failed: %s", exc)
            translated_results = await self._translate_items_individually(
                items=translatable_items,
                mode=mode,
            )
            translated_results.update(skipped_translations)
            return translated_results

        original_text_by_id = {
            item.id: item.text
            for item in translatable_items
        }
        translated_results: dict[str, str] = {}
        for item in parsed_results:
            item_id = item.get("id")
            translated_text = item.get("translated_text")
            if item_id and translated_text:
                translated_results[item_id] = self._sanitize_model_output(
                    original_text=original_text_by_id.get(item_id, ""),
                    translated_text=translated_text,
                )

        missing_items = [
            item
            for item in translatable_items
            if item.id not in translated_results
        ]
        if missing_items:
            fallback_results = await self._translate_items_individually(
                items=missing_items,
                mode=mode,
            )
            translated_results.update(fallback_results)

        translated_results.update(skipped_translations)

        return translated_results

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

        for pattern in (r"\{[\s\S]*\}", r"\[[\s\S]*\]"):
            match = re.search(pattern, cleaned_result)
            if match:
                candidate = self._repair_common_json_mistakes(match.group(0))
                try:
                    return json.loads(candidate)
                except json.JSONDecodeError:
                    continue

        raise ValueError("Model tidak mengembalikan JSON valid.")

    def _repair_common_json_mistakes(self, text: str) -> str:
        text = text.strip()
        return re.sub(r",\s*([}\]])", r"\1", text)

    def _sanitize_model_output(self, original_text: str, translated_text: str) -> str:
        cleaned_text = translated_text.strip()
        leak_patterns = (
            r"\s*(?:ATURAN OUTPUT|Aturan|ATURAN):[\s\S]*?(?:TEKS|INPUT MULAI|Input JSON|INPUT JSON):?\s*",
            r"\s*(?:Terjemahkan|Jelaskan)[\s\S]*?(?:TEKS|INPUT MULAI):?\s*",
            r"\s*(?:INPUT MULAI|INPUT SELESAI)\s*",
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
    ) -> dict[str, str]:
        results: dict[str, str] = {}
        for item in items:
            try:
                results[item.id] = await self.translate(item.text, mode)
            except Exception as exc:
                logger.warning("Single item translation failed for id=%s: %s", item.id, exc)
                results[item.id] = item.text

        return results
