import sqlite3
import csv

DB_PATH = "server/data/translation_cache.db"


def export_csv(filename, rows):
    with open(filename, "w", newline="", encoding="utf-8-sig") as f:
        writer = csv.writer(f)
        writer.writerow([
            "original_text",
            "translated_text"
        ])
        writer.writerows(rows)

    print(f"✅ {filename} ({len(rows)} data)")


conn = sqlite3.connect(DB_PATH)
cursor = conn.cursor()

# ============================
# 1. RANDOM 300
# ============================

cursor.execute("""
SELECT
    original_text,
    translated_text
FROM translation_cache
WHERE mode='translate'
ORDER BY RANDOM()
LIMIT 300;
""")

random_rows = cursor.fetchall()

export_csv(
    "translations_random_300.csv",
    random_rows
)

# ============================
# 2. MIDDLE 300
# ============================

cursor.execute("""
SELECT COUNT(*)
FROM translation_cache
WHERE mode='translate';
""")

total = cursor.fetchone()[0]

middle_offset = max((total // 2) - 150, 0)

cursor.execute(f"""
SELECT
    original_text,
    translated_text
FROM translation_cache
WHERE mode='translate'
LIMIT 300 OFFSET {middle_offset};
""")

middle_rows = cursor.fetchall()

export_csv(
    "translations_middle_300.csv",
    middle_rows
)

# ============================
# 3. LATEST 300
# ============================

cursor.execute("""
SELECT
    original_text,
    translated_text
FROM translation_cache
WHERE mode='translate'
ORDER BY created_at DESC
LIMIT 300;
""")

latest_rows = cursor.fetchall()

export_csv(
    "translations_latest_300.csv",
    latest_rows
)

conn.close()

print("\n====================================")
print(f"Total data translate : {total}")
print("Export selesai!")
print("====================================")