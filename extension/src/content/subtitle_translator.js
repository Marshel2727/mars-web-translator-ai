(() => {
    globalThis.MarsTranslator = globalThis.MarsTranslator || {};
    const { api } = globalThis.MarsTranslator;

    // --- Injeksi Interceptor ke Main World ---
    function injectInterceptor() {
        if (document.getElementById("mars-subtitle-interceptor")) return;

        const script = document.createElement("script");
        script.id = "mars-subtitle-interceptor";
        script.src = chrome.runtime.getURL("src/content/interceptor.js");
        script.onload = () => script.remove(); // Hapus setelah dimuat agar DOM bersih
        
        // Inject ke <head> secepat mungkin
        (document.head || document.documentElement).appendChild(script);
        console.log("[Mars Translator] 💉 Interceptor script disuntikkan ke halaman.");
    }

    window.marsVideoInfo = window.marsVideoInfo || {};

    injectInterceptor();

    // --- Floating UI Status ---
    let subtitleToast = null;
    let toastSafetyTimer = null;

    function showSubtitleStatus(text, progress = null, isSuccess = false, isError = false) {
        if (toastSafetyTimer) {
            clearTimeout(toastSafetyTimer);
            toastSafetyTimer = null;
        }

        if (!subtitleToast) {
            subtitleToast = document.createElement("div");
            subtitleToast.style.cssText = `
                position: fixed;
                top: 20px;
                left: 50%;
                transform: translateX(-50%);
                background: linear-gradient(145deg, rgba(15, 11, 30, 0.95), rgba(26, 16, 53, 0.95));
                backdrop-filter: blur(8px);
                border: 1px solid rgba(139, 92, 246, 0.3);
                border-radius: 20px;
                padding: 8px 16px;
                color: #e2e0ef;
                font-family: 'Inter', sans-serif;
                font-size: 13px;
                font-weight: 500;
                z-index: 2147483647;
                box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
                display: flex;
                align-items: center;
                gap: 8px;
                transition: opacity 0.3s;
                cursor: pointer;
            `;
            subtitleToast.title = "Klik untuk menutup notifikasi ini";
            subtitleToast.onclick = () => {
                if (subtitleToast) {
                    subtitleToast.style.opacity = "0";
                    setTimeout(() => {
                        subtitleToast?.remove();
                        subtitleToast = null;
                    }, 300);
                }
            };
            document.documentElement.appendChild(subtitleToast);
        }

        let icon = "⏳";
        if (isSuccess) icon = "✅";
        if (isError) icon = "❌";

        let progressText = progress !== null ? `(${progress}%)` : "";
        subtitleToast.innerHTML = `<span>${icon}</span> <span>${text} ${progressText}</span>`;

        if (isSuccess || isError) {
            setTimeout(() => {
                if (subtitleToast) {
                    subtitleToast.style.opacity = "0";
                    setTimeout(() => {
                        subtitleToast?.remove();
                        subtitleToast = null;
                    }, 300);
                }
            }, 3000);
        } else {
            // Safety timer: Jika lebih dari 40 detik tidak ada update, otomatis tutup toast
            toastSafetyTimer = setTimeout(() => {
                if (subtitleToast) {
                    subtitleToast.style.opacity = "0";
                    setTimeout(() => {
                        subtitleToast?.remove();
                        subtitleToast = null;
                    }, 300);
                }
            }, 40000);
        }
    }

    // --- Parsing & Reconstruct ---

    /**
     * Parsing VTT
     * Mengembalikan array of objek dan cara merekonstruksinya
     */
    function parseVTT(content) {
        const lines = content.split('\n');
        const items = [];
        const structure = []; // Menyimpan timestamp / metadata untuk reconstruct
        let currentTextId = null;
        let idCounter = 0;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            
            // Jika baris berisi panah waktu (timestamp), baris berikutnya adalah teks
            if (line.includes('-->')) {
                structure.push({ type: 'time', content: line });
                
                // Ambil semua teks setelah timestamp sampai baris kosong
                let textLines = [];
                let j = i + 1;
                while (j < lines.length && lines[j].trim() !== '') {
                    textLines.push(lines[j]);
                    j++;
                }
                
                if (textLines.length > 0) {
                    const id = `vtt_${idCounter++}`;
                    const originalText = textLines.join('\n');
                    items.push({ id, text: originalText });
                    structure.push({ type: 'text', id, originalText });
                }
                i = j - 1; // Skip baris teks yang sudah dibaca
            } else {
                structure.push({ type: 'raw', content: line });
            }
        }

        return { items, structure };
    }

    function reconstructVTT(structure, translatedMap) {
        let result = [];
        for (const block of structure) {
            if (block.type === 'raw' || block.type === 'time') {
                result.push(block.content);
            } else if (block.type === 'text') {
                result.push(translatedMap[block.id] ?? block.originalText ?? "");
            }
        }
        return result.join('\n');
    }

    /**
     * Parse YouTube JSON timedtext
     */
    function parseYouTube(content) {
        try {
            const data = JSON.parse(content);
            const items = [];
            
            if (data.events) {
                data.events.forEach((event, idx) => {
                    if (event.segs) {
                        const text = event.segs.map(s => s.utf8).join("");
                        if (text.trim()) {
                            items.push({ id: `yt_${idx}`, text: text });
                        }
                    }
                });
            }
            return { items, data };
        } catch (e) {
            console.error("Gagal parse YouTube subtitle", e);
            return { items: [], data: null };
        }
    }

    function reconstructYouTube(data, translatedMap) {
        if (!data || !data.events) return JSON.stringify(data);
        
        data.events.forEach((event, idx) => {
            if (event.segs) {
                const id = `yt_${idx}`;
                if (translatedMap[id]) {
                    // Timpa segmen pertama dengan teks terjemahan, hapus segmen sisa
                    event.segs[0].utf8 = translatedMap[id];
                    event.segs.length = 1;
                }
            }
        });
        
        return JSON.stringify(data);
    }

    // --- Batch Translator ---
    async function translateSubtitleChunks(items, url) {
        const CHUNK_SIZE = 20; // Sesuaikan dengan backend MAX_BATCH_ITEMS = 20
        const translatedMap = {};
        
        let completed = 0;
        let consecutiveErrors = 0;

        for (let i = 0; i < items.length; i += CHUNK_SIZE) {
            const chunk = items.slice(i, i + CHUNK_SIZE);
            
            const progress = Math.round((completed / items.length) * 100);
            showSubtitleStatus("Menerjemahkan Subtitle...", progress);

            try {
                // Gunakan mode "translate"
                const response = await api.translateBatch(chunk, "translate");
                if (response && response.results) {
                    if (response.translation_profile && response.model) {
                        globalThis.MarsTranslator.updateTranslationProfile?.(
                            response.translation_profile,
                            response.model,
                        );
                    }
                    response.results.forEach(res => {
                        translatedMap[res.id] = res.translated_text;
                    });

                    // Respons parsial tidak boleh menghapus cue yang tidak dikembalikan backend.
                    chunk.forEach(item => {
                        if (!(item.id in translatedMap)) {
                            translatedMap[item.id] = item.text;
                        }
                    });
                    consecutiveErrors = 0; // Reset error counter on success
                } else {
                    chunk.forEach(item => translatedMap[item.id] = item.text);
                    consecutiveErrors++;
                }
            } catch (err) {
                console.error("[Mars Translator] Gagal translate chunk", err);
                // Fallback ke teks asli jika gagal
                chunk.forEach(c => translatedMap[c.id] = c.text);
                consecutiveErrors++;
            }

            // Jika 2 chunk berturut-turut gagal (misal server mati/offline), hentikan loop.
            if (consecutiveErrors >= 2) {
                console.warn("[Mars Translator] Backend server tidak merespons. Menghentikan batch translation.");
                showSubtitleStatus("Server Backend Mati / Offline", null, false, true);

                // Semua chunk yang belum diproses harus tetap menggunakan subtitle asli.
                items.slice(i + CHUNK_SIZE).forEach(item => {
                    translatedMap[item.id] = item.text;
                });
                break;
            }
            
            completed += chunk.length;
        }

        return translatedMap;
    }

    // --- Listener dari Interceptor ---
    window.addEventListener("message", async (event) => {
        if (event.source !== window || !event.data) return;

        if (event.data.type === "MARS_TRANSLATE_SUBTITLE") {
            const { url, content, subtitleType } = event.data;
            console.log(`[Mars Translator] 📝 Memproses subtitle (${subtitleType}) untuk: ${url}`);
            
            window.marsSubtitleDetected = true;
            window.marsSubtitleDetectedType = subtitleType;
            
            showSubtitleStatus("Memulai Pre-Fetch Subtitle...", 0);

            try {
                let parsedItems = [];
                let structure = null;
                let parsedData = null;

                // 1. Parsing
                if (subtitleType === "vtt") {
                    const parsed = parseVTT(content);
                    parsedItems = parsed.items;
                    structure = parsed.structure;
                } else if (subtitleType === "youtube") {
                    const parsed = parseYouTube(content);
                    parsedItems = parsed.items;
                    parsedData = parsed.data;
                }

                if (parsedItems.length === 0) {
                    showSubtitleStatus("Subtitle kosong / gagal diparsing", null, false, true);
                    return window.postMessage({ type: "MARS_SUBTITLE_TRANSLATED", originalUrl: url, translatedContent: content }, "*");
                }

                // 2. Translate Chunked
                const translatedMap = await translateSubtitleChunks(parsedItems, url);

                // 3. Reconstruct
                let translatedContent = content;
                if (subtitleType === "vtt") {
                    translatedContent = reconstructVTT(structure, translatedMap);
                } else if (subtitleType === "youtube") {
                    translatedContent = reconstructYouTube(parsedData, translatedMap);
                }

                showSubtitleStatus("Subtitle Diterjemahkan", 100, true);

                // 4. Kirim balik ke interceptor
                window.postMessage({
                    type: "MARS_SUBTITLE_TRANSLATED",
                    originalUrl: url,
                    translatedContent: translatedContent
                }, "*");

            } catch (err) {
                console.error("[Mars Translator] Error saat memproses subtitle:", err);
                showSubtitleStatus("Gagal menerjemahkan subtitle", null, false, true);
                
                window.postMessage({
                    type: "MARS_SUBTITLE_TRANSLATED",
                    originalUrl: url,
                    translatedContent: content // fallback ke original
                }, "*");
            }
        }
    });

    function scanVideoInfo() {
        const info = {
            platform: window.marsVideoInfo?.platform || detectPlatformFromHost(),
            videoCount: document.querySelectorAll('video').length,
            subtitleDetected: false,
            subtitleFormat: window.marsVideoInfo?.subtitleFormat || null,
            subtitleLoadMethod: window.marsVideoInfo?.subtitleLoadMethod || null,
            subtitleStatus: window.marsSubtitleDetected ? 'done' : 'idle',
            tracks: [],
            interceptorPresent: !!window._marsSubtitleInterceptorInjected,
        };

        document.querySelectorAll('track').forEach(t => {
            const src = t.getAttribute('src') || '';
            info.tracks.push({
                lang: t.getAttribute('srclang') || '',
                kind: t.getAttribute('kind') || '',
                label: t.getAttribute('label') || '',
                src: src,
                isTranslated: t.getAttribute('data-mars-translated') === 'true',
                format: src.match(/\.(\w+)(\?|#|$)/)?.[1] || 'unknown',
            });
        });

        if (info.tracks.length > 0) info.subtitleDetected = true;
        if (window.marsVideoInfo?.subtitleDetected) info.subtitleDetected = true;
        if (info.subtitleFormat && !info.subtitleLoadMethod) info.subtitleLoadMethod = 'track';

        return info;
    }

    function detectPlatformFromHost() {
        const host = location.hostname;
        if (host.includes('youtube.com') || host.includes('youtu.be')) return 'youtube';
        if (host.includes('vimeo.com')) return 'vimeo';
        if (host.includes('frontendmasters.com')) return 'frontendmasters';
        if (host.includes('udemy.com')) return 'udemy';
        if (host.includes('coursera.org')) return 'coursera';
        if (host.includes('netflix.com')) return 'netflix';
        return 'generic';
    }

    // --- DOM Track Interceptor (<track> tag) ---
    async function processTrackElement(track) {
        const currentStatus = track.getAttribute("data-mars-translated");
        if (currentStatus === "processing" || currentStatus === "true") return;

        let src = track.getAttribute("src");
        if (!src) return;

        if (!src.includes(".vtt")) {
            if (track.kind !== "subtitles" && track.kind !== "captions") return;
        }

        track.setAttribute("data-mars-translated", "processing");

        if (!track.hasAttribute("data-mars-original-src")) {
            track.setAttribute("data-mars-original-src", src);
        }

        const video = track.closest("video") || document.querySelector("video");
        let wasPlaying = false;

        if (video && !video.paused) {
            wasPlaying = true;
            video.pause();
        }

        window.marsSubtitleDetected = true;
        window.marsSubtitleDetectedType = "vtt (track)";
        window.marsVideoInfo = window.marsVideoInfo || {};
        window.marsVideoInfo.subtitleDetected = true;
        window.marsVideoInfo.subtitleFormat = 'vtt';
        window.marsVideoInfo.subtitleLoadMethod = 'track';
        window.marsVideoInfo.subtitleStatus = 'translating';

        showSubtitleStatus("Pre-Fetch Subtitle HTML5...", 0);

        try {
            const absoluteSrc = new URL(src, location.href).toString();
            const response = await fetch(absoluteSrc);
            if (!response.ok) throw new Error("Gagal fetch file subtitle");

            const content = await response.text();

            const parsed = parseVTT(content);
            if (parsed.items.length === 0) {
                track.setAttribute("data-mars-translated", "empty");
                showSubtitleStatus("Subtitle kosong", null, false, true);
                if (wasPlaying && video) video.play().catch(() => {});
                return;
            }

            const translatedMap = await translateSubtitleChunks(parsed.items, absoluteSrc);
            const translatedContent = reconstructVTT(parsed.structure, translatedMap);

            const blob = new Blob([translatedContent], { type: "text/vtt" });
            const blobUrl = URL.createObjectURL(blob);

            const previousBlobUrl = track.getAttribute("data-mars-blob-url");
            if (previousBlobUrl) {
                URL.revokeObjectURL(previousBlobUrl);
            }

            track.setAttribute("src", blobUrl);
            track.setAttribute("data-mars-blob-url", blobUrl);
            track.setAttribute("data-mars-translated", "true");
            window.marsVideoInfo.subtitleStatus = 'done';

            showSubtitleStatus("Subtitle Diterjemahkan", 100, true);

        } catch (e) {
            console.error("[Mars Translator] Gagal memproses <track> subtitle:", e);
            track.setAttribute("data-mars-translated", "error");
            window.marsVideoInfo.subtitleStatus = 'error';
            showSubtitleStatus("Gagal menerjemahkan subtitle", null, false, true);
        }

        if (wasPlaying && video) {
            video.play().catch(() => {});
        }
    }

    function setupTrackInterceptor() {
        if (!document.documentElement) {
            window.addEventListener("DOMContentLoaded", setupTrackInterceptor);
            return;
        }

        // 1. Cek yang sudah ada di DOM
        document.querySelectorAll("track").forEach(processTrackElement);

        // 2. Pantau penambahan <track> atau perubahan src
        const observer = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
                if (mutation.type === "childList") {
                    mutation.addedNodes.forEach(node => {
                        if (node.tagName && node.tagName.toLowerCase() === "track") {
                            processTrackElement(node);
                        } else if (node.querySelectorAll) {
                            node.querySelectorAll("track").forEach(track => processTrackElement(track));
                        }
                    });
                } else if (mutation.type === "attributes" && mutation.target.tagName && mutation.target.tagName.toLowerCase() === "track") {
                    if (mutation.attributeName === "src") {
                        const status = mutation.target.getAttribute("data-mars-translated");
                        if (status !== "true" && status !== "processing") {
                            processTrackElement(mutation.target);
                        }
                    }
                }
            }
        });

        observer.observe(document.documentElement, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ["src"]
        });
    }

    setupTrackInterceptor();

    // --- Frontend Masters Transcript Scraper ---
    let fmTranscriptScraped = false;

    async function scrapeFrontendMastersTranscript() {
        if (fmTranscriptScraped) return;
        if (!location.hostname.includes("frontendmasters.com")) return;

        const transcriptLines = document.querySelectorAll("div.transcripts a.line");
        if (transcriptLines.length < 5) return; // Tunggu sampai benar-benar terisi

        fmTranscriptScraped = true; // Tandai agar tidak dipanggil lagi
        console.log(`[Mars Translator] 🕵️ Menemukan ${transcriptLines.length} baris transcript Frontend Masters. Memulai Pre-Fetch...`);

        showSubtitleStatus("Menyedot Transcript Video...", 0);

        // Ekstrak teks
        const items = [];
        transcriptLines.forEach((el, idx) => {
            let text = el.innerText; // Gunakan innerText agar cocok dengan hasil DOM Scanner
            // Hapus prefix nama pembicara jika ada (opsional, tapi lebih aman biarkan persis seperti DOM)
            if (text.trim()) {
                items.push({ id: `fm_tr_${idx}`, text: text });
            }
        });

        if (items.length === 0) {
            fmTranscriptScraped = false;
            return;
        }

        try {
            // Kita gunakan fungsi translateSubtitleChunks untuk memicu proses batch translate di background.
            // Meskipun kita tidak mengubah isi elemen <a> di sini, proses ini akan
            // MEMAKSA backend FastAPI menyimpan semua terjemahan ini ke dalam CACHE.
            // Saat subtitle video muncul, DOM Scanner akan langsung mendapatkan Cache Hit!
            const translatedMap = await translateSubtitleChunks(items, "frontendmasters_transcript");
            
            // PREFILL LOCAL CACHE (DOM Scanner)
            // Ini sangat krusial: agar tidak ada "race condition" (video mereplace subtitle sebelum async selesai),
            // kita harus memasukkan teks secara paksa ke Cache Sinkron Lokal (text_replacer.js).
            if (globalThis.MarsTranslator && globalThis.MarsTranslator.prefillCache) {
                items.forEach(item => {
                    const translatedText = translatedMap[item.id];
                    if (translatedText) {
                        globalThis.MarsTranslator.prefillCache(item.text, translatedText);
                    }
                });
            }

            showSubtitleStatus("Transcript Tersimpan di Cache (0 Latency Siap)!", 100, true);
            console.log("[Mars Translator] ✅ Seluruh transcript Frontend Masters berhasil di-cache.");
        } catch (e) {
            console.error("[Mars Translator] Gagal mem-pre-fetch transcript:", e);
            showSubtitleStatus("Gagal cache transcript", null, false, true);
            fmTranscriptScraped = false; 
        }
    }

    // Periksa transcript secara berkala (karena panel ini sering dimuat secara asinkron)
    if (location.hostname.includes("frontendmasters.com")) {
        setInterval(scrapeFrontendMastersTranscript, 3000);
    }

    // --- State & Status Check for Popup UI ---
    window.marsSubtitleDetected = false;
    window.marsSubtitleDetectedType = null;

    async function restoreSubtitle() {
        window.postMessage({ type: "MARS_CLEAR_SUBTITLE_CACHE" }, "*");
        window.postMessage({ type: "MARS_ENABLE_PASSTHROUGH", duration: "15000" }, "*");

        await new Promise(r => setTimeout(r, 100));

        const tracks = document.querySelectorAll('track[data-mars-translated]');
        tracks.forEach(track => {
            const originalSrc = track.getAttribute('data-mars-original-src');
            const blobUrl = track.getAttribute('data-mars-blob-url');
            if (originalSrc) {
                track.setAttribute('src', originalSrc);
            }
            if (blobUrl) URL.revokeObjectURL(blobUrl);
            track.removeAttribute('data-mars-translated');
            track.removeAttribute('data-mars-original-src');
            track.removeAttribute('data-mars-blob-url');
        });

        window.marsSubtitleDetected = false;
        window.marsSubtitleDetectedType = null;
        window.marsVideoInfo = {};
    }

    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (message.type === "CHECK_SUBTITLE_STATUS") {
            const info = scanVideoInfo();

            info.detected = window.marsSubtitleDetected || info.subtitleDetected;
            info.type = window.marsSubtitleDetectedType || (info.subtitleDetected ? info.subtitleFormat : "unknown");

            sendResponse(info);
            return true;
        }

        if (message.type === "RESTORE_SUBTITLE") {
            restoreSubtitle().then(() => {
                sendResponse({ ok: true });
            }).catch((e) => {
                sendResponse({ ok: false, error: e.message });
            });
            return true;
        }
    });

})();
