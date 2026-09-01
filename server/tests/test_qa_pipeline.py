import pytest
from app.services.glossary_service import GlossaryService
from app.services.translator_service import TranslatorService


class TestGlossary:
    def test_basic_corrections(self):
        tests = [
            ("Pengakuan perangkat keras", "Dukungan perangkat keras"),
            ("Gulungan Discord", "Discord Server"),
            ("Strategi Pengakuan", "Strategi Otentikasi"),
            ("Output Strukturi", "Structured Outputs"),
            ("KERTASANAKAN", "CIPHERTEXT"),
            ("Text biasa tanpa perubahan", "Text biasa tanpa perubahan"),
        ]
        for inp, expected in tests:
            assert GlossaryService.apply(inp) == expected, f"Failed: {inp!r}"

    def test_multiple_corrections(self):
        result = GlossaryService.apply(
            "Pengakuan perangkat keras dan Gulungan Discord"
        )
        assert "Dukungan perangkat keras" in result
        assert "Discord Server" in result

    def test_empty_string(self):
        assert GlossaryService.apply("") == ""
        assert GlossaryService.apply(None) is None

    def test_reload(self):
        GlossaryService.reload()
        assert GlossaryService.apply("Output Strukturi") == "Structured Outputs"


class TestQAChecks:
    def setup_method(self):
        self.srv = TranslatorService()

    def test_equality_check(self):
        assert self.srv._check_equality("Hello World", "Hello World") is True
        assert self.srv._check_equality("hello world", "HELLO WORLD") is True
        assert self.srv._check_equality("Hello World", " Halo Dunia ") is False

    def test_untranslated_detects_english(self):
        text = "The system is the best tool for this kind of operation"
        result = self.srv._check_untranslated(text)
        assert result is not None

    def test_untranslated_passes_indonesian(self):
        text = "Sistem ini adalah alat terbaik untuk jenis operasi ini"
        result = self.srv._check_untranslated(text)
        assert result is None

    def test_untranslated_short_text(self):
        assert self.srv._check_untranslated("Hello World") is None

    def test_chinese_detected(self):
        result = self.srv._check_chinese_chars("Halo Dunia \u4f60\u597d")
        assert result is not None

    def test_chinese_clean(self):
        result = self.srv._check_chinese_chars("Halo Dunia")
        assert result is None

    def test_pipeline_good_translation(self):
        result, feedback = self.srv._run_qa_pipeline("Hello World", "Halo Dunia")
        assert result == "Halo Dunia"
        assert feedback is None

    def test_pipeline_rejects_same(self):
        result, feedback = self.srv._run_qa_pipeline("Hello World", "Hello World")
        assert result is None
        assert feedback is not None

    def test_pipeline_rejects_chinese(self):
        result, feedback = self.srv._run_qa_pipeline("Hello World", "Halo Dunia \u4f60\u597d")
        assert result is None
        assert feedback is not None

    def test_pipeline_applies_glossary(self):
        result, feedback = self.srv._run_qa_pipeline(
            "Hardware support",
            "Pengakuan perangkat keras adalah hal penting",
        )
        assert result == "Dukungan perangkat keras adalah hal penting"
        assert feedback is None

    def test_pipeline_untranslated_rejected(self):
        long_en = "The system is the best tool for this kind of operation and it works well"
        result, feedback = self.srv._run_qa_pipeline(long_en, long_en)
        assert result is None
        assert feedback is not None

    def test_pipeline_prompt_leak_rejected(self):
        result, feedback = self.srv._run_qa_pipeline("Hello", "Halo <text_to_translate>")
        assert result is None
        assert feedback is not None

    def test_pipeline_empty_input(self):
        result, feedback = self.srv._run_qa_pipeline("", "")
        assert result is None
        assert feedback is not None

    def test_pipeline_null_input(self):
        result, feedback = self.srv._run_qa_pipeline("Hello", None)
        assert result is None
        assert feedback is not None

    def test_pipeline_mixed_id_en_ok(self):
        result, feedback = self.srv._run_qa_pipeline(
            "the API endpoint",
            "titik akhir API",
        )
        assert result == "titik akhir API"
        assert feedback is None
