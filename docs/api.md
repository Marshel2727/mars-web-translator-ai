# API Documentation

This document describes the FastAPI backend used by Mars Web Translator AI. The backend acts as a local translation API between the browser extension and the Ollama model.

## Base URL

Development server:

```text
http://127.0.0.1:8000
```

Default API prefix:

```text
/api/v1
```

## Endpoints

### Health Check

```http
GET /api/v1/health/
```

Use this endpoint to verify that the FastAPI server is running.

Example response:

```json
{
  "status": "ok",
  "message": "Mars Web Translator AI server is running"
}
```

### Batch Translate

```http
POST /api/v1/translate/batch
```

Translates multiple text items in a single request. This endpoint is used by the browser extension when translating visible text and background page content.

## Request Body

```json
{
  "mode": "translate",
  "items": [
    {
      "id": "item-1",
      "text": "Ollama is the easiest way to get up and running with large language models."
    }
  ]
}
```

### Fields

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `mode` | string | No | Translation mode. Defaults to `translate`. |
| `items` | array | Yes | List of text items to translate. |
| `items[].id` | string | Yes | Client-generated identifier used to map responses back to DOM nodes. |
| `items[].text` | string | Yes | Source text to translate. |

## Response Body

```json
{
  "results": [
    {
      "id": "item-1",
      "original_text": "Ollama is the easiest way to get up and running with large language models.",
      "translated_text": "Ollama adalah cara termudah untuk memulai dengan model bahasa besar."
    }
  ],
  "model": "mars-translator:qwen2.5-3b"
}
```

### Fields

| Field | Type | Description |
| --- | --- | --- |
| `results` | array | List of translated results. |
| `results[].id` | string | Same ID sent by the client. |
| `results[].original_text` | string | Original source text. |
| `results[].translated_text` | string | Translated Indonesian text. |
| `model` | string | Ollama model used by the backend. |

## Error Responses

### Too Many Items

If the request contains more items than `MAX_BATCH_ITEMS`, the API returns:

```http
400 Bad Request
```

Example:

```json
{
  "detail": "Maksimal 20 item per batch."
}
```

### Validation Error

If required fields are missing or invalid, FastAPI returns:

```http
422 Unprocessable Entity
```

Example causes:

- `items` is missing.
- `items[].id` is empty.
- `items[].text` is empty.
- Field names do not match the schema.

### Ollama or Model Error

If Ollama is not running, the backend may fail while calling:

```text
http://localhost:11434/api/generate
```

Check Ollama with:

```text
http://127.0.0.1:11434/api/tags
```

## Configuration

The backend uses environment variables from `server/.env`.

```env
APP_NAME=Mars Web Translator AI
APP_ENV=development
API_V1_PREFIX=/api/v1
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=mars-translator:qwen2.5-3b
REQUEST_TIMEOUT=120
MAX_BATCH_ITEMS=20
```

## Notes

- The API is designed for local development and local browser extension usage.
- The extension sends batches of text nodes to reduce repeated HTTP requests.
- The current model output is parsed by the backend, so malformed model output can affect translation reliability.
- For production-style usage, structured output validation and fallback behavior should be added.
