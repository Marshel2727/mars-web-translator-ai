import json
import re


def _escape_xml_special(text: str) -> str:
    """Escape characters that could break XML-like delimiters in prompts."""
    text = text.replace("&", "&amp;")
    text = text.replace("<", "&lt;")
    text = text.replace(">", "&gt;")
    return text


def build_translate_prompt(text: str) -> str:
    safe_text = _escape_xml_special(text)
    return f"""
Terjemahkan INPUT berikut ke Bahasa Indonesia yang natural, jelas, dan mudah dipahami.

ATURAN OUTPUT:
- Jawab hanya hasil terjemahan dari INPUT.
- Jangan salin instruksi, aturan, label, atau pembatas prompt.
- Jangan salin tag XML pembatas.
- Jangan ubah kode program.
- Jangan ubah nama function, class, package, command, URL, path file, parameter, atau keyword programming.
- Pertahankan istilah teknis penting jika istilah Inggrisnya lebih umum.
- Jangan menambahkan opini.
- Jangan meringkas terlalu pendek.

<text_to_translate>
{safe_text}
</text_to_translate>
"""

def build_explain_prompt(text: str) -> str:
    safe_text = _escape_xml_special(text)
    return f"""
Jelaskan INPUT berikut dalam Bahasa Indonesia sederhana.

Format:
1. Maksud utama
2. Penjelasan sederhana
3. Istilah penting
4. Contoh pemahaman
5. Kesimpulan singkat

Aturan:
- Jangan salin instruksi, aturan, label, atau pembatas prompt.
- Jangan salin tag XML pembatas.
- Jangan ubah kode program.
- Jangan ubah nama function, class, package, command, URL, path file, parameter, atau keyword programming.
- Jika ada istilah teknis, jelaskan dengan bahasa sederhana.

<text_to_explain>
{safe_text}
</text_to_explain>
"""
    
def build_prompt(text: str, mode: str) -> str:
    if mode == "explain":
        return build_explain_prompt(text)
    
    return build_translate_prompt(text)


def build_batch_translate_prompt(items: list[dict[str, str]], mode: str) -> str:
    safe_items = [
        {"id": item["id"], "text": item["text"]}
        for item in items
    ]
    payload = json.dumps(safe_items, ensure_ascii=False)

    if mode == "explain":
        task = "Jelaskan setiap teks ke Bahasa Indonesia sederhana."
    else:
        task = "Terjemahkan setiap teks ke Bahasa Indonesia yang natural dan jelas."

    return f"""Output ONLY valid JSON. No markdown, no explanation, no extra text.
{task} Jangan ubah kode, nama, URL.
Contoh format output:
{{"results":[{{"id":"id_1","translated_text":"hasil_terjemahan"}}]}}
Input: {payload}
Output JSON:"""
