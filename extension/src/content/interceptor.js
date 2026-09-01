(function() {
    if (window._marsSubtitleInterceptorInjected) return;
    window._marsSubtitleInterceptorInjected = true;

    console.log("[Mars Translator] Subtitle Interceptor diaktifkan di Main World.");

    const originalFetch = window.fetch;
    const originalXHROpen = XMLHttpRequest.prototype.open;
    const originalXHRSend = XMLHttpRequest.prototype.send;
    const originalXHRSetRequestHeader = XMLHttpRequest.prototype.setRequestHeader;

    const pendingTranslations = new Map();
    const translationCache = new Map();
    const translationInFlight = new Map();

    const MAX_CACHE_SIZE = 200;
    const TIMEOUT_BASE_MS = 10000;
    const TIMEOUT_PER_CHAR_MS = 50;
    const TIMEOUT_MAX_MS = 60000;

    window.marsVideoInfo = window.marsVideoInfo || {};

    function detectPlatform() {
        const host = location.hostname;
        if (host.includes('youtube.com') || host.includes('youtu.be')) return 'youtube';
        if (host.includes('vimeo.com')) return 'vimeo';
        if (host.includes('frontendmasters.com')) return 'frontendmasters';
        if (host.includes('udemy.com')) return 'udemy';
        if (host.includes('coursera.org')) return 'coursera';
        if (host.includes('netflix.com')) return 'netflix';
        return 'generic';
    }

    window.marsVideoInfo.platform = detectPlatform();

    window.addEventListener("message", (event) => {
        if (event.source !== window || !event.data) return;

        if (event.data.type === "MARS_SUBTITLE_TRANSLATED") {
            const { originalUrl, translatedContent } = event.data;
            if (pendingTranslations.has(originalUrl)) {
                pendingTranslations.get(originalUrl)(translatedContent);
                pendingTranslations.delete(originalUrl);
            }
        }

        if (event.data.type === "MARS_CLEAR_SUBTITLE_CACHE") {
            translationCache.clear();
            translationInFlight.clear();
            pendingTranslations.clear();
            window.postMessage({ type: "MARS_CACHE_CLEARED" }, "*");
        }
    });

    function setCache(url, content) {
        if (translationCache.size >= MAX_CACHE_SIZE) {
            const firstKey = translationCache.keys().next().value;
            translationCache.delete(firstKey);
        }
        translationCache.set(url, content);
    }

    function getTimeout(textLength) {
        return Math.min(
            Math.max(TIMEOUT_BASE_MS, textLength * TIMEOUT_PER_CHAR_MS),
            TIMEOUT_MAX_MS
        );
    }

    function getOrStartTranslation(url, originalText, subtitleType) {
        if (translationCache.has(url)) {
            return Promise.resolve(translationCache.get(url));
        }

        if (translationInFlight.has(url)) {
            return translationInFlight.get(url);
        }

        const translationPromise = new Promise((resolve) => {
            pendingTranslations.set(url, resolve);
            window.postMessage({
                type: "MARS_TRANSLATE_SUBTITLE",
                url: url,
                content: originalText,
                subtitleType: subtitleType
            }, "*");

            const timeoutMs = getTimeout(originalText.length);
            setTimeout(() => {
                if (pendingTranslations.has(url)) {
                    console.warn(`[Mars Translator] Translation timeout (${timeoutMs}ms) for: ${url}`);
                    pendingTranslations.delete(url);
                    resolve(originalText);
                }
            }, timeoutMs);
        }).then((result) => {
            setCache(url, result);
            translationInFlight.delete(url);
            return result;
        });

        translationInFlight.set(url, translationPromise);
        return translationPromise;
    }

    function getSubtitleType(url) {
        if (url.includes('/api/timedtext')) return 'youtube';
        if (url.match(/\.(vtt|srt|sbv|ass|ssa|sub|idx)(\?|#|$)/i)) return 'vtt';
        if (url.includes('youtube.com') && (url.includes('caption') || url.includes('cc') || url.includes('subtitle'))) return 'youtube';
        if (url.endsWith('.json') || url.includes('/subtitle/') || url.includes('caption_data')) return 'json';
        return null;
    }

    window.fetch = function(...args) {
        if (window._marsSubtitlePassthrough) {
            return originalFetch.apply(this, args);
        }

        const resource = args[0];
        let url = "";

        if (typeof resource === "string") url = resource;
        else if (resource instanceof Request) url = resource.url;
        else if (resource instanceof URL) url = resource.toString();

        const subtitleTypeByUrl = getSubtitleType(url);

        if (!subtitleTypeByUrl) {
            return originalFetch.apply(this, args);
        }

        return originalFetch.apply(this, args).then(async (response) => {
            if (!response.ok) {
                console.warn(`[Mars Translator] Fetch subtitle gagal (HTTP ${response.status}), pass through: ${url}`);
                return response;
            }

            const clonedResponse = response.clone();
            let originalText;
            try {
                originalText = await clonedResponse.text();
            } catch (e) {
                console.warn("[Mars Translator] Gagal baca body subtitle, pass through:", e);
                return response;
            }

            let subtitleType = subtitleTypeByUrl;
            if (subtitleType === "vtt" && !originalText.trim().startsWith("WEBVTT")) {
                return response;
            }

            window.marsVideoInfo.subtitleDetected = true;
            window.marsVideoInfo.subtitleFormat = subtitleType;
            window.marsVideoInfo.subtitleLoadMethod = 'fetch';

            const stream = new ReadableStream({
                async start(controller) {
                    try {
                        const translatedText = await getOrStartTranslation(url, originalText, subtitleType);
                        controller.enqueue(new TextEncoder().encode(translatedText));
                        controller.close();
                    } catch (e) {
                        console.error("[Mars Translator] Fetch stream gagal:", e);
                        controller.enqueue(new TextEncoder().encode(originalText));
                        controller.close();
                    }
                }
            });

            const translatedHeaders = new Headers(response.headers);
            translatedHeaders.delete("content-length");
            translatedHeaders.delete("content-encoding");

            return new Response(stream, {
                status: response.status,
                statusText: response.statusText,
                headers: translatedHeaders
            });
        }).catch((err) => {
            console.warn("[Mars Translator] Fetch subtitle network error, pass through:", err);
            return originalFetch.apply(this, args);
        });
    };

    XMLHttpRequest.prototype.open = function(method, url, async, ...rest) {
        this._marsMethod = method;
        this._marsUrl = typeof url === 'string' ? url : (url ? url.toString() : '');
        this._marsAsync = async !== false;
        this._marsHeaders = {};
        return originalXHROpen.call(this, method, url, async !== false, ...rest);
    };

    XMLHttpRequest.prototype.setRequestHeader = function(name, value) {
        this._marsHeaders = this._marsHeaders || {};
        const existingValue = this._marsHeaders[name];
        this._marsHeaders[name] = existingValue ? `${existingValue}, ${value}` : value;
        return originalXHRSetRequestHeader.call(this, name, value);
    };

    XMLHttpRequest.prototype.send = function(body) {
        if (window._marsSubtitlePassthrough) {
            return originalXHRSend.call(this, body);
        }

        const url = this._marsUrl || "";
        const subtitleType = getSubtitleType(url);

        if (!subtitleType) {
            return originalXHRSend.call(this, body);
        }

        const xhr = this;
        const method = String(xhr._marsMethod || "GET").toUpperCase();
        const requestedResponseType = xhr.responseType || "";
        const hasCustomHeaders = Object.keys(xhr._marsHeaders || {}).length > 0;

        // Jangan mengambil alih request yang semantiknya tidak bisa direplikasi dengan aman.
        if (
            xhr._marsAsync === false ||
            method !== "GET" ||
            hasCustomHeaders ||
            xhr.withCredentials ||
            !["", "text", "json"].includes(requestedResponseType)
        ) {
            console.debug("[Mars Translator] XHR subtitle dilewatkan agar request asli tetap utuh:", url);
            return originalXHRSend.call(this, body);
        }

        window.marsVideoInfo.subtitleDetected = true;
        window.marsVideoInfo.subtitleFormat = subtitleType;
        window.marsVideoInfo.subtitleLoadMethod = 'xhr';

        (async () => {
            try {
                const response = await originalFetch.call(window, url, {
                    method,
                    credentials: "same-origin",
                });
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                const originalText = await response.text();

                const translatedText = await getOrStartTranslation(url, originalText, subtitleType);
                let responseValue = translatedText;
                if (requestedResponseType === "json") {
                    responseValue = JSON.parse(translatedText);
                }

                Object.defineProperty(xhr, 'readyState', { get: () => 4, configurable: true });
                Object.defineProperty(xhr, 'status', { get: () => response.status, configurable: true });
                Object.defineProperty(xhr, 'statusText', { get: () => response.statusText, configurable: true });
                Object.defineProperty(xhr, 'responseText', { get: () => translatedText, configurable: true });
                Object.defineProperty(xhr, 'response', { get: () => responseValue, configurable: true });
                Object.defineProperty(xhr, 'responseType', { get: () => requestedResponseType, configurable: true });
                Object.defineProperty(xhr, 'responseURL', { get: () => response.url || url, configurable: true });

                const subFormat = subtitleType === 'youtube' ? 'application/json' : 'text/vtt; charset=utf-8';
                if (!xhr._marsHeadersPatched) {
                    xhr.getResponseHeader = function(name) {
                        if (name && name.toLowerCase() === 'content-type') return subFormat;
                        if (name && ['content-length', 'content-encoding'].includes(name.toLowerCase())) {
                            return null;
                        }
                        return response.headers.get(name);
                    };
                    xhr.getAllResponseHeaders = function() {
                        const headerLines = [];
                        response.headers.forEach((value, name) => {
                            if (['content-type', 'content-length', 'content-encoding'].includes(name.toLowerCase())) return;
                            headerLines.push(`${name}: ${value}`);
                        });
                        headerLines.push(`content-type: ${subFormat}`);
                        return `${headerLines.join('\r\n')}\r\n`;
                    };
                    xhr._marsHeadersPatched = true;
                }

                xhr.dispatchEvent(new ProgressEvent('readystatechange'));
                xhr.dispatchEvent(new ProgressEvent('load'));
                xhr.dispatchEvent(new ProgressEvent('loadend'));

            } catch (e) {
                console.warn("[Mars Translator] XHR takeover gagal, fallback ke XHR asli:", e);
                originalXHRSend.call(xhr, body);
            }
        })();
    };

    if (window.TextTrack && window.TextTrack.prototype.addCue) {
        const originalAddCue = window.TextTrack.prototype.addCue;
        window.TextTrack.prototype.addCue = function(cue) {
            if (cue && cue.text && !cue._marsTranslated) {
                const originalText = cue.text;
                cue._marsTranslated = true;

                const cacheKey = `addCue:${originalText}`;

                getOrStartTranslation(cacheKey, originalText, "vtt").then(translatedText => {
                    if (translatedText) {
                        cue.text = translatedText;
                    }
                }).catch(() => {});
            }
            return originalAddCue.call(this, cue);
        };
    }

    window.marsRestoreSubtitle = function() {
        translationCache.clear();
        translationInFlight.clear();
        pendingTranslations.clear();
        window._marsSubtitlePassthrough = true;
        setTimeout(() => { window._marsSubtitlePassthrough = false; }, 10000);
        window.postMessage({ type: "MARS_CACHE_CLEARED" }, "*");
    };

    window.addEventListener("message", (event) => {
        if (event.source === window && event.data?.type === "MARS_ENABLE_PASSTHROUGH") {
            window._marsSubtitlePassthrough = true;
            setTimeout(() => { window._marsSubtitlePassthrough = false; }, parseInt(event.data?.duration) || 10000);
        }
    });

})();
