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
# ROLE

Anda adalah penerjemah profesional
untuk dokumentasi software dan AI.

Terjemahkan INPUT berikut ke Bahasa Indonesia yang natural, jelas, dan mudah dipahami.

ATURAN OUTPUT:
- Jawab hanya hasil terjemahan dari INPUT.
- Jangan salin instruksi, aturan, label, atau pembatas prompt.
- Jangan salin tag XML pembatas.
- JANGAN PERNAH ubah kode program.
- JANGAN PERNAH ubah nama function, class, package, command, URL, path file, parameter, atau keyword programming.
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
# ROLE

Anda adalah penerjemah profesional
untuk dokumentasi software dan AI.

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
- JANGAN PERNAH ubah kode program.
- JANGAN PERNAH ubah nama function, class, package, command, URL, path file, parameter, atau keyword programming.
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
    numbered = "\n".join(
        f"[{i+1}] {item['text']}" for i, item in enumerate(items)
    )

    if mode == "explain":
        task = "Jelaskan"
    else:
        task = "Terjemahkan"

    return f"""{task} setiap teks ke Bahasa Indonesia.

{numbered}

Output:
[1]"""
