# Roadmap

This roadmap tracks the current state of Mars Web Translator AI and outlines planned improvements before the project is considered portfolio-ready or production-like.

## Completed

- Chrome/Brave extension using Manifest V3.
- Popup UI with translate, restore, and API test actions.
- FastAPI backend server.
- Ollama integration through local HTTP API.
- Custom translator model based on `qwen2.5:3b`.
- Batch translation endpoint.
- Viewport-first translation strategy.
- Background page translation queue.
- Detection for client-side navigation changes.
- Persistent browser translation cache with `chrome.storage.local`.
- CORS support for browser extension requests.
- Modular extension files for scanner, replacer, API, and viewport translation logic.

## In Progress

- Improving model output reliability for batch translation.
- Making translation behavior more stable across different documentation websites.
- Improving setup scripts for Windows and Unix-like environments.
- Preparing project documentation for GitHub and portfolio usage.

## Planned Improvements

### Backend Reliability

- Add Ollama structured output support.
- Add JSON schema validation for batch translation responses.
- Add fallback behavior when the model returns invalid batch output.
- Return clean API errors instead of unhandled server exceptions.
- Add retry logic for transient Ollama failures.

### Backend Performance

- Add backend-side translation cache using SQLite.
- Cache repeated translations by normalized source text.
- Warm up the Ollama model when the backend starts.
- Add timing logs for request duration and Ollama response time.
- Add configurable batch size.

### Extension UX

- Add an options/settings page.
- Add auto-translate toggle.
- Add clear cache button.
- Add target language selector.
- Add status indicator for background translation progress.
- Add per-site enable/disable settings.
- Improve handling of pages with dynamic content.

### Developer Experience

- Add `.env.example`.
- Fill `scripts/start_server.ps1`.
- Fill `scripts/start_server.sh`.
- Add setup instructions for Windows.
- Add setup instructions for Linux/macOS.
- Add a one-click local start option.

### Testing

- Add backend tests for health endpoint.
- Add backend tests for request validation.
- Add tests for invalid model output handling.
- Add tests for fallback translation behavior.
- Add lightweight tests for extension utility functions.

### Documentation

- Add screenshots.
- Add demo GIF or video.
- Add troubleshooting guide.
- Add explanation of local Ollama requirements.
- Add extension permission explanation.
- Add architecture diagram image.

### Packaging

- Add release-ready extension packaging.
- Add Docker support for the FastAPI backend.
- Add optional Docker Compose configuration.
- Add license file.

## Known Limitations

- Translation speed depends on local hardware and model size.
- Local LLM output can be inconsistent for strict structured responses.
- The system is optimized for technical documentation pages, not every type of website.
- The browser extension requires broad host permissions to translate arbitrary web pages.
- Ollama must be running locally for translation to work.

## Portfolio Readiness Checklist

- [ ] README completed.
- [ ] `.gitignore` completed.
- [ ] `.env.example` added.
- [ ] Start scripts completed.
- [ ] API docs completed.
- [ ] Architecture docs completed.
- [ ] Roadmap completed.
- [ ] Screenshots added.
- [ ] Demo video or GIF added.
- [ ] Backend error handling improved.
- [ ] License added.
