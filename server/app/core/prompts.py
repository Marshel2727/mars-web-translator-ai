import json


def build_translate_prompt(text: str) -> str:
    return f"""
Terjemahkan INPUT berikut ke Bahasa Indonesia yang natural, jelas, dan mudah dipahami.

ATURAN OUTPUT:
- Jawab hanya hasil terjemahan dari INPUT.
- Jangan salin instruksi, aturan, label, atau pembatas prompt.
- Jangan ubah kode program.
- Jangan ubah nama function, class, package, command, URL, path file, parameter, atau keyword programming.
- Pertahankan istilah teknis penting jika istilah Inggrisnya lebih umum.
- Jangan menambahkan opini.
- Jangan meringkas terlalu pendek.

INPUT MULAI
{text}
INPUT SELESAI
"""

def build_explain_prompt(text: str) -> str:
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
- Jangan ubah kode program.
- Jangan ubah nama function, class, package, command, URL, path file, parameter, atau keyword programming.
- Jika ada istilah teknis, jelaskan dengan bahasa sederhana.

INPUT MULAI
{text}
INPUT SELESAI
"""
    
def build_prompt(text: str, mode: str) -> str:
    if mode == "explain":
        return build_explain_prompt(text)
    
    return build_translate_prompt(text)


def build_batch_translate_prompt(items: list[dict[str, str]], mode: str) -> str:
    payload = json.dumps(items, ensure_ascii=False)

    if mode == "explain":
        task = "Jelaskan setiap teks dokumentasi dalam Bahasa Indonesia sederhana."
    else:
        task = "Terjemahkan setiap teks dokumentasi ke Bahasa Indonesia yang natural, jelas, dan mudah dipahami."

    return f"""
{task}

Aturan:
- Jangan ubah nilai id.
- Jangan ubah kode program, command, URL, path file, parameter, keyword programming, nama package, nama function, nama class, nama produk, atau nama model.
- Jangan menyalin instruksi, aturan, label, pembatas prompt, pembuka, penutup, catatan, markdown, atau penjelasan ekstra.
- Pertahankan istilah teknis Inggris jika lebih umum dipakai.
- Balas hanya JSON valid.

Format output wajib:
{{
  "results": [
    {{"id": "id yang sama", "translated_text": "hasil"}}
  ]
}}

Input JSON:
{payload}
"""
