(function() {
    // Hindari injeksi ganda
    if (window._marsSubtitleInterceptorInjected) return;
    window._marsSubtitleInterceptorInjected = true;

    console.log("[Mars Translator] 🚀 Subtitle Interceptor diaktifkan di Main World.");

    const originalFetch = window.fetch;
    const originalXHROpen = XMLHttpRequest.prototype.open;
    const originalXHRSend = XMLHttpRequest.prototype.send;

    // --- Shared translation state ---
    // pendingTranslations: kunci URL → resolve function dari Promise yang menunggu terjemahan
    const pendingTranslations = new Map();
    // translationCache: kunci URL → hasil terjemahan yang sudah jadi (untuk request kedua/ketiga)
    const translationCache = new Map();
    // translationInFlight: kunci URL → Promise yang sedang berjalan (agar tidak duplicate request ke LLM)
    const translationInFlight = new Map();

    const TRANSLATION_TIMEOUT_MS = 30000;

    // Listen balasan terjemahan dari content script
    window.addEventListener("message", (event) => {
        if (event.source !== window || !event.data) return;

        if (event.data.type === "MARS_SUBTITLE_TRANSLATED") {
            const { originalUrl, translatedContent } = event.data;
            if (pendingTranslations.has(originalUrl)) {
                pendingTranslations.get(originalUrl)(translatedContent);
                pendingTranslations.delete(originalUrl);
            }
        }
    });

    /**
     * Meminta terjemahan ke content script.
     * Mengembalikan Promise yang resolve dengan teks terjemahan.
     * Jika URL yang sama sudah diminta sebelumnya, tunggu promise yang sama (tidak duplikat).
     * Includes a timeout to prevent memory leaks if content script doesn't respond.
     */
    function getOrStartTranslation(url, originalText, subtitleType) {
        // Sudah punya cache? Langsung kembalikan
        if (translationCache.has(url)) {
            console.log(`[Mars Translator] ⚡ Cache HIT untuk: ${url}`);
            return Promise.resolve(translationCache.get(url));
        }

        // Terjemahan sedang berjalan? Tunggu promise yang sama
        if (translationInFlight.has(url)) {
            console.log(`[Mars Translator] ⏳ Menunggu terjemahan yang sedang berjalan: ${url}`);
            return translationInFlight.get(url);
        }

        // Buat request terjemahan baru
        console.log(`[Mars Translator] 📤 Memulai terjemahan baru: ${url}`);
        const translationPromise = new Promise((resolve) => {
            pendingTranslations.set(url, resolve);
            window.postMessage({
                type: "MARS_TRANSLATE_SUBTITLE",
                url: url,
                content: originalText,
                subtitleType: subtitleType
            }, "*");

            // Timeout: jika content script tidak merespons, resolve dengan original text
            setTimeout(() => {
                if (pendingTranslations.has(url)) {
                    console.warn(`[Mars Translator] ⏰ Translation timeout for: ${url}`);
                    pendingTranslations.delete(url);
                    resolve(originalText);
                }
            }, TRANSLATION_TIMEOUT_MS);
        }).then((result) => {
            translationCache.set(url, result);
            translationInFlight.delete(url);
            return result;
        });

        translationInFlight.set(url, translationPromise);
        return translationPromise;
    }

    // Helper: apakah URL ini kemungkinan subtitle?
    function getSubtitleType(url) {
        if (url.includes("/api/timedtext")) return "youtube";
        if (url.includes(".vtt")) return "vtt";
        return null;
    }

    // =============================================================
    // --- Override Fetch API ---
    // =============================================================
    window.fetch = function(...args) {
        const resource = args[0];
        let url = "";

        if (typeof resource === "string") url = resource;
        else if (resource instanceof Request) url = resource.url;
        else if (resource instanceof URL) url = resource.toString();

        const subtitleTypeByUrl = getSubtitleType(url);

        // Bukan subtitle → langsung teruskan
        if (!subtitleTypeByUrl) {
            return originalFetch.apply(this, args);
        }

        // Fetch asli, lalu intercept body-nya
        const originalFetchPromise = originalFetch.apply(this, args);

        return originalFetchPromise.then(async (response) => {
            const clonedResponse = response.clone();
            const originalText = await clonedResponse.text();

            // Double-check konten
            let subtitleType = subtitleTypeByUrl;
            if (subtitleType === "vtt" && !originalText.trim().startsWith("WEBVTT")) {
                return new Response(originalText, {
                    status: response.status,
                    statusText: response.statusText,
                    headers: response.headers
                });
            }

            console.log(`[Mars Translator] 📡 Fetch menangkap subtitle (${subtitleType}): ${url}`);

            // Gunakan ReadableStream agar player tidak timeout:
            // Stream akan terbuka dan menunggu terjemahan selesai.
            const stream = new ReadableStream({
                async start(controller) {
                    try {
                        const translatedText = await getOrStartTranslation(url, originalText, subtitleType);
                        console.log(`[Mars Translator] ✅ Fetch stream selesai, dikirim ke player: ${url}`);
                        controller.enqueue(new TextEncoder().encode(translatedText));
                        controller.close();
                    } catch (e) {
                        console.error("[Mars Translator] ❌ Fetch stream gagal:", e);
                        controller.enqueue(new TextEncoder().encode(originalText));
                        controller.close();
                    }
                }
            });

            return new Response(stream, {
                status: response.status,
                statusText: response.statusText,
                headers: response.headers
            });
        });
    };

    // =============================================================
    // --- Override XMLHttpRequest (Total Takeover untuk subtitle) ---
    // Kunci: jangan panggil originalXHRSend untuk URL subtitle.
    // Sebagai gantinya, kita fetch sendiri, terjemahkan, lalu 
    // "pura-pura" XHR selesai dengan data Indonesia.
    // Ini memastikan player TIDAK PERNAH melihat teks Inggris dari XHR.
    // =============================================================
    XMLHttpRequest.prototype.open = function(method, url, async = true, ...rest) {
        this._marsMethod = method;
        this._marsUrl = url;
        this._marsAsync = async;
        return originalXHROpen.call(this, method, url, async, ...rest);
    };

    XMLHttpRequest.prototype.send = function(body) {
        const url = this._marsUrl || "";
        const subtitleType = getSubtitleType(url);

        if (!subtitleType) {
            // Bukan subtitle → jalankan normal
            return originalXHRSend.call(this, body);
        }

        // === TOTAL TAKEOVER ===
        // Kita TIDAK memanggil originalXHRSend.
        // Semua kontrol ada di tangan kita.
        const xhr = this;
        console.log(`[Mars Translator] 🚦 XHR Total Takeover untuk: ${url}`);

        (async () => {
            try {
                // Fetch konten subtitle dari server asli menggunakan Fetch API kita sendiri
                // (yang sudah di-patch, tapi kita pakai originalFetch agar tidak loop)
                const response = await originalFetch(url);
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                const originalText = await response.text();

                // Terjemahkan (atau ambil dari cache jika Fetch sudah menerjemahkannya lebih dulu)
                const translatedText = await getOrStartTranslation(url, originalText, subtitleType);
                console.log(`[Mars Translator] ✅ XHR takeover selesai, mengirim teks Indonesia ke player: ${url}`);

                // Fake properti XHR dengan teks terjemahan
                Object.defineProperty(xhr, 'readyState', { get: () => 4, configurable: true });
                Object.defineProperty(xhr, 'status', { get: () => 200, configurable: true });
                Object.defineProperty(xhr, 'statusText', { get: () => 'OK', configurable: true });
                Object.defineProperty(xhr, 'responseText', { get: () => translatedText, configurable: true });
                Object.defineProperty(xhr, 'response', { get: () => translatedText, configurable: true });
                Object.defineProperty(xhr, 'responseType', { get: () => 'text', configurable: true });
                Object.defineProperty(xhr, 'responseURL', { get: () => url, configurable: true });
                if (!xhr.getResponseHeader._marsPatched) {
                    const originalGetResponseHeader = xhr.getResponseHeader;
                    xhr.getResponseHeader = function(name) {
                        if (name && name.toLowerCase() === 'content-type') return 'text/vtt; charset=utf-8';
                        return originalGetResponseHeader.call(this, name);
                    };
                    xhr.getResponseHeader._marsPatched = true;
                }
                if (!xhr.getAllResponseHeaders._marsPatched) {
                    const originalGetAllResponseHeaders = xhr.getAllResponseHeaders;
                    xhr.getAllResponseHeaders = function() {
                        return 'content-type: text/vtt; charset=utf-8';
                    };
                    xhr.getAllResponseHeaders._marsPatched = true;
                }

                // Tembak event ke player: readystatechange → load → loadend
                xhr.dispatchEvent(new ProgressEvent('readystatechange'));
                xhr.dispatchEvent(new ProgressEvent('load'));
                xhr.dispatchEvent(new ProgressEvent('loadend'));

            } catch (e) {
                console.error("[Mars Translator] ❌ XHR takeover gagal, fallback ke XHR asli:", e);
                // Jika gagal, jalankan XHR asli sebagai fallback
                originalXHRSend.call(xhr, body);
            }
        })();

        // Return undefined seperti send() asli
    };

    // =============================================================
    // --- Monkey-Patch TextTrack.prototype.addCue ---
    // Backup: untuk player yang pakai HLS + native TextTrack
    // Uses originalText as cache key for deduplication.
    // =============================================================

    if (window.TextTrack && window.TextTrack.prototype.addCue) {
        const originalAddCue = window.TextTrack.prototype.addCue;
        window.TextTrack.prototype.addCue = function(cue) {
            if (cue && cue.text && !cue._marsTranslated) {
                const originalText = cue.text;
                cue._marsTranslated = true;

                // Use original text as key for deduplication
                const cacheKey = `addCue:${originalText}`;

                getOrStartTranslation(cacheKey, originalText, "vtt").then(translatedText => {
                    if (translatedText) {
                        cue.text = translatedText;
                        console.log(`[Mars Translator] 🎯 addCue: "${originalText.slice(0, 30)}" → "${translatedText.slice(0, 30)}"`);
                    }
                }).catch(e => {
                    console.error("[Mars Translator] ❌ addCue terjemahan gagal:", e);
                });
            }
            return originalAddCue.call(this, cue);
        };
        console.log("[Mars Translator] 💉 TextTrack.prototype.addCue berhasil di-patch.");
    }

})();
