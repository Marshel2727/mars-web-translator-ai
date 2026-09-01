const resultEl = document.getElementById("result");
const statusDot = document.getElementById("statusDot");
const statusText = document.getElementById("statusText");
const cacheCountEl = document.getElementById("cacheCount");
const serverCacheCountEl = document.getElementById("serverCacheCount");
const translateBtn = document.getElementById("translateVisibleBtn");
const checkSubtitleBtn = document.getElementById("checkSubtitleBtn");
const restoreBtn = document.getElementById("restoreBtn");
const restoreSubtitleBtn = document.getElementById("restoreSubtitleBtn");
const testApiBtn = document.getElementById("testApiBtn");
const openOptionsLink = document.getElementById("openOptionsLink");
const videoInfoSection = document.getElementById("videoInfoSection");

const viPlatform = document.getElementById("viPlatform");
const viVideoCount = document.getElementById("viVideoCount");
const viSubtitleDetected = document.getElementById("viSubtitleDetected");
const viFormat = document.getElementById("viFormat");
const viLoadMethod = document.getElementById("viLoadMethod");
const viStatus = document.getElementById("viStatus");
const viTracksRow = document.getElementById("viTracksRow");
const viTracks = document.getElementById("viTracks");

const SETTINGS_KEY = "marsTranslatorSettings";
const CACHE_KEY = "marsTranslationCacheV2";
const api = globalThis.MarsTranslator.api;

function describeApiError(error) {
  const messages = {
    AUTH_MISSING: "Token API belum diisi — buka Pengaturan",
    AUTH_INVALID: "Token API tidak valid",
    ORIGIN_FORBIDDEN: "Origin ekstensi ditolak backend",
    NETWORK_ERROR: "Backend lokal tidak terhubung",
    REQUEST_TIMEOUT: "Backend melewati batas waktu",
    HTTP_503: "Backend aktif, tetapi Ollama/model GPU belum siap",
    MODEL_NOT_FOUND: "Model tidak ditemukan di Ollama",
    MODEL_NOT_ACTIVE: "Model request bukan model aktif",
    GPU_REQUIRED: "Model tidak menggunakan GPU",
  };
  return messages[error?.code] || error?.message || "Request backend gagal";
}

async function getActiveTab() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab || null;
}

// ===== Health Check =====
async function checkServerHealth() {
  try {
    const health = await api.getHealth();
    statusDot.className = "status-dot online";
    statusText.textContent = health.status === "ok" ? "Server dan GPU siap" : "Server degraded";
  } catch (error) {
    setOffline(describeApiError(error));
  }
}

function setOffline(message = "Server tidak terhubung") {
  statusDot.className = "status-dot offline";
  statusText.textContent = message;
}

// ===== Stats =====
async function loadStats() {
  try {
    const data = await chrome.storage.local.get(CACHE_KEY);
    const cache = data[CACHE_KEY];
    cacheCountEl.textContent = cache ? Object.keys(cache).length : "0";
  } catch {
    cacheCountEl.textContent = "—";
  }

  try {
    const stats = await api.getServerCacheStats();
    serverCacheCountEl.textContent = stats.total_entries ?? "—";
  } catch {
    serverCacheCountEl.textContent = "—";
  }
}

function displayVideoInfo(response) {
  videoInfoSection.style.display = 'block';
  viPlatform.textContent = response.platform || '—';
  viVideoCount.textContent = response.videoCount != null ? response.videoCount + ' <video>' : '—';

  if (response.detected) {
    viSubtitleDetected.textContent = 'Terdeteksi';
    viSubtitleDetected.className = 'info-value subtitle-yes';
  } else {
    viSubtitleDetected.textContent = 'Tidak ada';
    viSubtitleDetected.className = 'info-value subtitle-no';
  }

  viFormat.textContent = response.subtitleFormat || (response.subtitleDetected ? response.type : '—');
  viLoadMethod.textContent = response.subtitleLoadMethod || '—';

  const statusMap = { 'idle': 'Menganggur', 'translating': 'Menerjemahkan...', 'done': 'Selesai', 'error': 'Gagal' };
  viStatus.textContent = statusMap[response.subtitleStatus] || response.subtitleStatus || '—';

  if (response.tracks && response.tracks.length > 0) {
    viTracksRow.style.display = 'flex';
    viTracks.textContent = response.tracks.map(t => `${t.lang || '?'} (${t.kind || '?'})`).join(', ');
  } else {
    viTracksRow.style.display = 'none';
  }

  if (response.detected) {
    restoreSubtitleBtn.style.display = 'flex';
  } else {
    restoreSubtitleBtn.style.display = 'none';
  }
}

// ===== Translate Visible =====
translateBtn.addEventListener("click", async () => {
  translateBtn.classList.add("loading");
  resultEl.textContent = "Menerjemahkan teks yang terlihat...";

  try {
    const tab = await getActiveTab();
    if (!tab) { resultEl.textContent = "Error: Tidak ada tab aktif."; return; }
    const response = await chrome.tabs.sendMessage(tab.id, { type: "TRANSLATE_VISIBLE_TEXT" });
    resultEl.textContent = response.message || response.error || JSON.stringify(response, null, 2);
  } catch (error) {
    resultEl.textContent = "Error: " + error.message + "\n\nCoba reload halaman web lalu klik lagi.";
  } finally {
    translateBtn.classList.remove("loading");
    loadStats();
  }
});

// ===== Check Subtitle =====
checkSubtitleBtn.addEventListener("click", async () => {
  checkSubtitleBtn.classList.add("loading");
  resultEl.textContent = "Memeriksa subtitle...";

  try {
    const tab = await getActiveTab();
    if (!tab) { resultEl.textContent = "Error: Tidak ada tab aktif."; return; }
    const response = await chrome.tabs.sendMessage(tab.id, { type: "CHECK_SUBTITLE_STATUS" });

    displayVideoInfo(response || {});

    if (response && response.detected) {
      resultEl.textContent = `Subtitle ditemukan! Format: ${response.subtitleFormat || response.type}`;
    } else {
      resultEl.textContent = "Tidak ada subtitle terdeteksi di halaman ini.";
    }
  } catch (error) {
    resultEl.textContent = "Error: " + error.message + "\n\nCoba reload halaman web lalu klik lagi.";
  } finally {
    checkSubtitleBtn.classList.remove("loading");
  }
});

// ===== Restore =====
restoreBtn.addEventListener("click", async () => {
  restoreBtn.classList.add("loading");
  resultEl.textContent = "Mengembalikan teks asli...";

  try {
    const tab = await getActiveTab();
    if (!tab) { resultEl.textContent = "Error: Tidak ada tab aktif."; return; }
    const response = await chrome.tabs.sendMessage(tab.id, { type: "RESTORE_ORIGINAL_TEXT" });
    resultEl.textContent = response.message || response.error || JSON.stringify(response, null, 2);
  } catch (error) {
    resultEl.textContent = "Error: " + error.message + "\n\nCoba reload halaman web lalu klik lagi.";
  } finally {
    restoreBtn.classList.remove("loading");
  }
});

// ===== Restore Subtitle =====
restoreSubtitleBtn.addEventListener("click", async () => {
  restoreSubtitleBtn.classList.add("loading");
  resultEl.textContent = "Mengembalikan subtitle asli...";

  try {
    const tab = await getActiveTab();
    if (!tab) { resultEl.textContent = "Error: Tidak ada tab aktif."; return; }
    const response = await chrome.tabs.sendMessage(tab.id, { type: "RESTORE_SUBTITLE" });
    if (response && response.ok) {
      resultEl.textContent = "Subtitle asli dipulihkan. Refresh halaman jika masih tampak terjemahan.";
    } else {
      resultEl.textContent = "Gagal restore subtitle: " + (response?.error || 'unknown');
    }
    restoreSubtitleBtn.style.display = 'none';
    videoInfoSection.style.display = 'none';
  } catch (error) {
    resultEl.textContent = "Error: " + error.message + "\n\nCoba reload halaman web lalu klik lagi.";
  } finally {
    restoreSubtitleBtn.classList.remove("loading");
  }
});

// ===== Test API =====
testApiBtn.addEventListener("click", async () => {
  testApiBtn.classList.add("loading");
  resultEl.textContent = "Mengirim request ke FastAPI...";

  try {
    const data = await api.translateBatch([
      { id: "1", text: "FastAPI is a modern web framework for building APIs with Python." },
    ]);
    resultEl.textContent = JSON.stringify(data, null, 2);
  } catch (error) {
    resultEl.textContent = "Error: " + describeApiError(error);
  } finally {
    testApiBtn.classList.remove("loading");
    loadStats();
  }
});

const modelSelect = document.getElementById("modelSelect");

// ===== Models =====
async function loadModels() {
  try {
    const data = await api.getModels();
    
    modelSelect.innerHTML = "";
    data.models.forEach((model) => {
      const opt = document.createElement("option");
      opt.value = model;
      opt.textContent = model;
      if (model === data.active_model) {
        opt.selected = true;
      }
      modelSelect.appendChild(opt);
    });
    modelSelect.disabled = data.models.length === 0;
  } catch (error) {
    modelSelect.innerHTML = `<option value="">${describeApiError(error)}</option>`;
    modelSelect.disabled = true;
  }
}

modelSelect.addEventListener("change", async () => {
  const selectedModel = modelSelect.value;
  if (!selectedModel) return;

  modelSelect.disabled = true;
  resultEl.textContent = `Mengubah model aktif ke "${selectedModel}"...`;

  try {
    const data = await api.setActiveModel(selectedModel);
    resultEl.textContent = `Model aktif berhasil diubah ke: ${data.active_model} ✓`;
    
    // Save model choice in settings
    const settingsData = await chrome.storage.sync.get("marsTranslatorSettings");
    const currentSettings = settingsData.marsTranslatorSettings || {};
    currentSettings.selectedModel = data.active_model;
    await chrome.storage.sync.set({ marsTranslatorSettings: currentSettings });
  } catch (error) {
    resultEl.textContent = `Gagal mengubah model: ${describeApiError(error)}`;
  } finally {
    modelSelect.disabled = false;
  }
});

// ===== Options Link =====
openOptionsLink.addEventListener("click", (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});

// ===== Init =====
(async () => {
  checkServerHealth();
  loadStats();
  loadModels();
})();

