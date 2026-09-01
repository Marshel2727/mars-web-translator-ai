# Batch Translation Fix Plan

## Root Cause

Model `qwen2.5-3b` (custom `mars-translator`) gagal output JSON untuk batch prompt karena:

1. **System prompt konflik** — `Modelfile` bilang *"Jawab hanya dengan hasil terjemahan"*, batch prompt minta JSON. Model 3B tidak bisa resolve konflik ini konsisten.
2. **`format` dict diabaikan Ollama** — `response_format=BATCH_JSON_SCHEMA` (dict) kemungkinan tidak didukung versi Ollama terinstall → `format` field diabaikan → model jalan tanpa constraint JSON → output makin kacau.
3. **`_escape_xml_special` untuk JSON** — Menyuntikkan `&amp;`, `&lt;`, `&gt;` ke dalam JSON string values, mengganggu model.

---

## 7 Bug yang Ditemukan

### Bug #1 — CRITICAL: Hasil gagal tersimpan ke cache sebagai "terjemahan"

**Lokasi:** `translator_service.py:362`, `:76-79`, `:389-391`

`_sanitize_model_output()` return `original_text` saat output kosong / prompt leak detected. Caller (`translate()` dan `_translate_items_individually()`) langsung meng-cache hasil ini tanpa validasi. Akibatnya teks Inggris yang gagal diterjemahkan muncul terus dari cache.

### Bug #2 — MEDIUM: `cache.set()` tidak commit

**Lokasi:** `cache_service.py:82-88`

`INSERT OR REPLACE` tanpa `await conn.commit()`. `set_batch()` di line 107 memang commit, tapi `set()` tidak. Hasil individual translation hilang setelah server restart.

### Bug #3 — CRITICAL: Regex code fence menghapus isi JSON

**Lokasi:** `translator_service.py:288`

```python
re.sub(r"```(?:json)?\s*[\s\S]*?```", "", text)
```

Regex `[\s\S]*?` match seluruh konten di dalam ` ``` `, bukan hanya markernya. JSON yang dibungkus code fence ikut terhapus → parsing pasti gagal → fallback satu per satu.

### Bug #4 — MEDIUM: Regex `//` merusak URL

**Lokasi:** `translator_service.py:304`

```python
re.sub(r"//[^\n]*", "", text)
```

`https://example.com/path` → `https:` karena `//example.com/path` dianggap komentar.

### Bug #5 — LOW: `num_predict` terlalu besar untuk batch

**Lokasi:** `translator_service.py:167`, `config.py:18`

Batch menggandakan `DEFAULT_NUM_PREDICT` (2048) menjadi 4096. Untuk model 3B, ini memberi terlalu banyak token output → ruang halusinasi/penjelasan tambahan → memperlambat respons.

### Bug #6 — MEDIUM: Cache key tidak include model

**Lokasi:** `cache_service.py:35-37`

Key hanya `text_hash + mode`. Ganti model (`qwen2.5-3b` → `gemma` dsb) tetap pakai hasil model lama. Butuh kolom `model` + `prompt_version` di table dan key.

### Bug #7 — LOW: Validasi batch response longgar

**Lokasi:** `translator_service.py:221-234`

Parser menerima ID tidak dikenal, ID duplikat, urutan salah. Position-based numbered list lebih ketat dan sederhana.

---

## Solusi: Numbered List Format

### Prompt Baru

```
Terjemahkan setiap teks ke Bahasa Indonesia.

{item_1}
{item_2}
...

Output:
[1]
```

Format: `[nomor] hasil_terjemahan` per baris. Cocok untuk Qwen 3B karena natural (mirip numbered list biasa).

### Parsing Baru

```python
LINE_RE = re.compile(r'^\s*\[(\d+)\]\s*(.*)')

for line in raw_result.split('\n'):
    m = LINE_RE.match(line)
    if m:
        idx = int(m.group(1)) - 1  # 0-based
        text = m.group(2).strip()
        results[idx] = text

# Map by position back to item.id
for i, item in enumerate(chunk):
    if results[i]:
        translated_results[item.id] = sanitize(results[i])
```

### Yang Dihapus

- `BATCH_JSON_SCHEMA`
- `response_format` (`"json"` dan dict schema — tidak dipakai lagi)
- `_load_json_from_model_output()`
- `_repair_common_json_mistakes()`
- `_fix_truncated_json()`
- `_escape_xml_special()` dari batch items

---

## Rencana Eksekusi

### Batch A: Fix Critical Bugs + Numbered List

| File | Line | Perubahan |
|------|------|-----------|
| `server/app/core/prompts.py` | 64-81 | Ganti `build_batch_translate_prompt` → numbered list `[N] text` |
| `server/app/services/translator_service.py` | 15-31 | Hapus `BATCH_JSON_SCHEMA` |
| `server/app/services/translator_service.py` | 168-174 | Revert `response_format` → `None` |
| `server/app/services/translator_service.py` | 177-188 | Map hasil numbered list → item.id by position |
| `server/app/services/translator_service.py` | 221-261 | Ganti `_parse_batch_result` → regex `\[(\d+)\]\s*(.*)` |
| `server/app/services/translator_service.py` | 284-342 | Hapus `_repair_common_json_mistakes`, `_fix_truncated_json` |
| `server/app/services/translator_service.py` | 344-364 | **Fix Bug #1**: `_sanitize_model_output` return `None` kalo gagal, biar gak di-cache |
| `server/app/services/translator_service.py` | 73-79 | Skip cache kalo `sanitized is None` |
| `server/app/services/translator_service.py` | 169-181 | Skip cache kalo sanitize return None |
| `server/app/services/translator_service.py` | 383-391 | Skip cache kalo sanitize return None (individual fallback) |

### Batch B: Fix Cache

| File | Line | Perubahan |
|------|------|-----------|
| `server/app/services/cache_service.py` | 79-88 | **Fix Bug #2**: tambah `await self._conn().commit()` di `set()` |
| `server/app/services/cache_service.py` | 14-26 | **Fix Bug #6**: tambah kolom `model` + `prompt_version` ke table, include di key |

### Batch C: Perbaikan Lain

| File | Line | Perubahan |
|------|------|-----------|
| `server/app/core/config.py` | 18 | **Fix Bug #5**: Revert `DEFAULT_NUM_PREDICT` ke 2048, batch pakai default (jangan double) |
| `server/app/services/translator_service.py` | 288 | **Fix Bug #3**: Ganti regex code fence → hapus cuma marker ` ``` `, bukan isinya |
| `server/app/services/translator_service.py` | 304 | **Fix Bug #4**: Hapus regex `//` atau ganti pakai negative lookbehind utk URL |

### Batch D: Clear Old Cache + Tests

- **Cache migration**: Deteksi schema lama (tanpa kolom `model`) → clear atau migrate
- **Tests baru**:
  - Empty output → return original text, jangan cache
  - Prompt leak detection → return original text, jangan cache
  - URL `https://` dalam teks → tetap dipertahankan
  - JSON code fence dalam output → isinya tetap diparsing
  - ID salah/duplikat → fallback hanya untuk item yang hilang
  - Multi-baris hasil → `[1]` hanya ambil line pertama setelah `]`
  - Cache persist setelah restart
  - Cache model switching

---

## Prioritas

| Priority | Batch | Feature |
|----------|-------|---------|
| 🔴 **Sekarang** | A | Numbered list + fix critical bug #1 |
| 🔴 **Sekarang** | B | Fix cache commit + model-aware key |
| 🔴 **Sekarang** | C | Fix code fence regex + URL regex |
| 🟡 **Next** | D | Clear old cache + new tests |
| 🟢 **Nanti** | — | Bilingual subtitle, floating menu, icons, .bat, streaming |
