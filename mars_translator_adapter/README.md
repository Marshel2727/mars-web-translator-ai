---
base_model: unsloth/Qwen2.5-3B-Instruct-bnb-4bit
library_name: peft
pipeline_tag: text-generation
tags:
- legacy
- lora
- qwen2.5
---

# Legacy Qwen2.5 Adapter — Do Not Apply to Qwen3

Folder ini menyimpan adapter PEFT/LoRA lama yang dilatih dari `unsloth/Qwen2.5-3B-Instruct-bnb-4bit`.

Adapter ini **bukan** bagian dari model resmi runtime saat ini dan **tidak kompatibel** dengan base model `qwen3:8b`. Jangan menggabungkan `adapter_model.safetensors` atau konfigurasi di folder ini ke `mars-translator-qwen3:latest`.

Artefak dipertahankan hanya untuk reproduksi atau evaluasi eksperimen Qwen2.5 terdahulu. Runtime resmi dibangun dari root `Modelfile` melalui `scripts/create_model.ps1` atau `scripts/create_model.sh`.
