# Mars Web Translator AI

Mars Web Translator AI is a local AI-powered browser translator for technical documentation pages. It combines a Chrome/Brave extension, a FastAPI backend, and a custom Ollama model to translate visible web page text into Indonesian while keeping code, commands, URLs, package names, and technical terms stable.

The project is designed as a practical local-first alternative for translating developer documentation without sending page content to a cloud translation service.

## Features

- Auto-translates web pages from English to Indonesian.
- Prioritizes text currently visible in the viewport.
- Continues translating the rest of the page in the background.
- Detects navigation changes in modern single-page applications.
- Caches translated text in the browser using `chrome.storage.local`.
- Uses a local FastAPI server as the translation API.
- Uses Ollama with a custom translator model based on `qwen2.5:3b`.
- Preserves programming-related text such as code, commands, URLs, paths, function names, package names, and model names.
- Provides a popup UI for manual translate, restore original text, and API testing.

## Tech Stack

- Browser extension: Chrome Extension Manifest V3
- Frontend extension logic: JavaScript
- Backend API: FastAPI
- HTTP client: HTTPX
- Validation/config: Pydantic and pydantic-settings
- Local AI runtime: Ollama
- Base model: `qwen2.5:3b`
- Custom model: `mars-translator:qwen2.5-3b`

## Architecture

```text
Browser Page
    |
    | content script scans visible and background text nodes
    v
Chrome/Brave Extension
    |
    | POST /api/v1/translate/batch
    v
FastAPI Backend
    |
    | /api/generate
    v
Ollama Local Model
    |
    v
Translated text is written back into the page
```

The extension translates visible text first to reduce perceived delay. Remaining page text is translated in the background. Repeated text such as navigation labels, sidebars, and buttons is cached locally in the browser.

## Project Structure

```text
mars-web-translator-ai/
+-- extension/
|   +-- manifest.json
|   +-- src/
|       +-- content/
|       +-- popup/
|       +-- shared/
+-- server/
|   +-- app/
|   |   +-- api/
|   |   +-- clients/
|   |   +-- core/
|   |   +-- schemas/
|   |   +-- services/
|   +-- requirements.txt
+-- scripts/
+-- docs/
+-- Modelfile
+-- README.md
```

## Requirements

- Python 3.11 or newer
- Ollama installed and running locally
- `qwen2.5:3b` pulled in Ollama
- Chrome, Brave, or another Chromium-based browser

## Setup

### 1. Clone the repository

```bash
git clone https://github.com/your-username/mars-web-translator-ai.git
cd mars-web-translator-ai
```

### 2. Create and activate a Python virtual environment

```bash
cd server
python -m venv venv
```

Windows:

```bash
venv\Scripts\activate
```

macOS/Linux:

```bash
source venv/bin/activate
```

### 3. Install backend dependencies

```bash
pip install -r requirements.txt
```

### 4. Pull the base Ollama model

```bash
ollama pull qwen2.5:3b
```

### 5. Create the custom translator model

From the project root on Windows:

```powershell
.\scripts\create_model.ps1
```

The custom model name is:

```text
mars-translator:qwen2.5-3b
```

## Environment Variables

Create a `.env` file inside the `server/` directory:

```env
APP_NAME=Mars Web Translator AI
APP_ENV=development

API_V1_PREFIX=/api/v1

OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=mars-translator:qwen2.5-3b

REQUEST_TIMEOUT=120
MAX_BATCH_ITEMS=20
```

## Running the Backend

From the `server/` directory:

```bash
python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

For development with auto reload:

```bash
python -m uvicorn app.main:app --reload
```

Health check:

```text
http://127.0.0.1:8000/api/v1/health/
```

Ollama check:

```text
http://127.0.0.1:11434/api/tags
```

## Installing the Browser Extension

1. Open Chrome or Brave.
2. Go to:

```text
chrome://extensions
```

or:

```text
brave://extensions
```

3. Enable Developer Mode.
4. Click **Load unpacked**.
5. Select the `extension/` folder.
6. Make sure the FastAPI backend and Ollama are running.
7. Open a documentation website and the extension will start translating page text automatically.

## API Endpoints

### Health Check

```http
GET /api/v1/health/
```

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

Request body:

```json
{
  "mode": "translate",
  "items": [
    {
      "id": "1",
      "text": "Ollama is the easiest way to get up and running with large language models."
    }
  ]
}
```

Example response:

```json
{
  "results": [
    {
      "id": "1",
      "original_text": "Ollama is the easiest way to get up and running with large language models.",
      "translated_text": "Ollama adalah cara termudah untuk memulai dengan model bahasa besar."
    }
  ],
  "model": "mars-translator:qwen2.5-3b"
}
```

## How Translation Works

The extension scans text nodes on the page and separates translation work into two queues:

- Priority queue: text currently visible in the viewport.
- Background queue: remaining text on the page.

This makes the page feel responsive because visible text is translated first. The extension also stores translations in a persistent browser cache so repeated UI text does not need to be sent to the backend again.

## Limitations

- Translation speed depends on the local machine and Ollama model performance.
- The project requires Ollama to be running locally.
- Local LLM output can sometimes be inconsistent, especially for strict batch formatting.
- This project is optimized for technical documentation, not all types of web content.
- It is not intended to replace production-grade cloud translation APIs.

## Roadmap

- Add stronger structured output handling for Ollama responses.
- Add fallback translation when batch output is invalid.
- Add backend-side translation cache using SQLite.
- Add tests for API endpoints and translation fallback behavior.
- Add screenshots or demo GIFs.
- Add extension settings for language, auto-translate toggle, and cache clearing.

## License

This project is currently provided for portfolio and learning purposes. Add a license before publishing it for wider use.
