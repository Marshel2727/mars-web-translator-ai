# Architecture

Mars Web Translator AI is a local-first browser translation system. It uses a Chromium extension to scan page text, a FastAPI backend to coordinate translation requests, and Ollama to run a local custom translator model.

## Goals

- Translate technical documentation pages from English to Indonesian.
- Prioritize text visible to the user.
- Continue translating the rest of the page in the background.
- Preserve technical terms, code, commands, URLs, and package names.
- Avoid cloud translation services by running locally.
- Reduce repeated translation work through browser-side caching.

## High-Level Flow

```text
Web Page
  |
  | text nodes
  v
Browser Extension Content Script
  |
  | batch request
  v
FastAPI Backend
  |
  | prompt
  v
Ollama
  |
  | custom local model
  v
Translated text
  |
  v
DOM text replacement
```

## Main Components

### Browser Extension

The extension is responsible for interacting with the active web page.

Key responsibilities:

- Scan DOM text nodes.
- Skip code blocks, scripts, form inputs, and non-user-facing content.
- Translate visible text first.
- Queue remaining page text for background translation.
- Detect navigation changes in modern single-page applications.
- Restore original text when requested.
- Cache translations using `chrome.storage.local`.

Important files:

```text
extension/manifest.json
extension/src/content/content.js
extension/src/content/dom_scanner.js
extension/src/content/text_replacer.js
extension/src/content/viewport_translator.js
extension/src/shared/api.js
extension/src/shared/constants.js
extension/src/popup/popup.js
```

### FastAPI Backend

The backend exposes a local HTTP API for the extension.

Key responsibilities:

- Accept translation requests from the browser extension.
- Validate request payloads using Pydantic schemas.
- Build prompts for the local model.
- Call Ollama using HTTP.
- Return translated text in a stable response format.

Important files:

```text
server/app/main.py
server/app/api/v1/api.py
server/app/api/v1/endpoints/translate.py
server/app/clients/ollama_client.py
server/app/services/translator_service.py
server/app/core/prompts.py
server/app/core/config.py
```

### Ollama Model

The system uses a custom Ollama model:

```text
mars-translator:qwen2.5-3b
```

Base model:

```text
qwen2.5:3b
```

The custom model is configured with a translation-focused system prompt in `Modelfile`. The goal is to make the model behave more like a technical documentation translator rather than a general chat assistant.

## Translation Strategy

The extension uses two queues:

### Priority Queue

The priority queue contains text nodes currently visible in the viewport.

Purpose:

- Reduce perceived delay.
- Make the page feel translated quickly.
- Prioritize what the user can see immediately.

### Background Queue

The background queue contains the rest of the page text.

Purpose:

- Continue translation after the visible section is handled.
- Prepare content before the user scrolls.
- Avoid blocking the first visible translation.

## Navigation Handling

Modern documentation sites often use client-side routing. A page can change without a full browser reload.

The extension listens to:

```text
history.pushState
history.replaceState
popstate
hashchange
scroll
MutationObserver
```

When navigation changes, the extension resets pending queues and prioritizes the new viewport.

## Caching Strategy

The extension uses persistent browser cache through:

```text
chrome.storage.local
```

Cache key format:

```text
translate:id:<normalized source text>
```

Benefits:

- Repeated navigation labels are translated instantly.
- Sidebars and headers do not need repeated model calls.
- Previously translated documentation terms can be reused across pages.
- Fewer backend and Ollama requests are needed.

## Performance Strategy

The project improves perceived performance through:

- Viewport-first translation.
- Background translation queue.
- Batch translation requests.
- Persistent browser cache.
- Reuse of a long-lived HTTPX async client.
- A smaller local model, `qwen2.5:3b`, through a custom translator model.

## Known Reliability Concern

Batch translation asks the model to return structured data. Local LLMs can sometimes return invalid JSON or malformed output.

Recommended future improvement:

- Use Ollama structured output.
- Validate model output.
- Add fallback translation for failed batch responses.
- Return graceful API errors instead of server exceptions.

## Local-First Design

The project is intentionally local-first:

- Page text is sent only to the local backend.
- The backend calls local Ollama.
- No cloud translation API is required.

This makes the project useful for learning, privacy-focused workflows, and portfolio demonstration of local AI integration.
