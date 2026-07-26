const resultEl = document.getElementById("result");
const statusDot = document.getElementById("statusDot");
const statusText = document.getElementById("statusText");
const cacheCountEl = document.getElementById("cacheCount");
const serverCacheCountEl = document.getElementById("serverCacheCount");
const translateBtn = document.getElementById("translateVisibleBtn");
const restoreBtn = document.getElementById("restoreBtn");
const testApiBtn = document.getElementById("testApiBtn");
const openOptionsLink = document.getElementById("openOptionsLink");

const DEFAULT_API_BASE = "http://127.0.0.1:8000";
const SETTINGS_KEY = "marsTranslatorSettings";

let apiBase = DEFAULT_API_BASE;

async function loadApiBase() {
    try {
        const data = await chrome.storage.sync.get(SETTINGS_KEY);
        const settings = data[SETTINGS_KEY] || {};
        apiBase = settings.apiBaseUrl || DEFAULT_API_BASE;
    } catch {
        apiBase = DEFAULT_API_BASE;
    }
}

async function getActiveTab() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab || null;
}

// ===== Health Check =====
async function checkServerHealth() {
  try {
    const response = await fetch(`${apiBase}/api/v1/health/`, { signal: AbortSignal.timeout(3000) });
    if (response.ok) {
      statusDot.className = "status-dot online";
      statusText.textContent = "Server terhubung";
    } else {
      setOffline();
    }
  } catch {
    setOffline();
  }
}

function setOffline() {
  statusDot.className = "status-dot offline";
  statusText.textContent = "Server tidak terhubung";
}

// ===== Stats =====
async function loadStats() {
  // Browser cache count
  try {
    const data = await chrome.storage.local.get("marsTranslationCacheV1");
    const cache = data.marsTranslationCacheV1;
    cacheCountEl.textContent = cache ? Object.keys(cache).length : "0";
  } catch {
    cacheCountEl.textContent = "—";
  }

  // Server cache count
  try {
    const response = await fetch(`${apiBase}/api/v1/cache/stats`, { signal: AbortSignal.timeout(3000) });
    if (response.ok) {
      const stats = await response.json();
      serverCacheCountEl.textContent = stats.total_entries ?? "—";
    } else {
      serverCacheCountEl.textContent = "—";
    }
  } catch {
    serverCacheCountEl.textContent = "—";
  }
}

// ===== Translate Visible =====
translateBtn.addEventListener("click", async () => {
  translateBtn.classList.add("loading");
  resultEl.textContent = "Menerjemahkan teks yang terlihat...";

  try {
    const tab = await getActiveTab();
    if (!tab) {
      resultEl.textContent = "Error: Tidak ada tab aktif yang ditemukan.";
      return;
    }
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
const checkSubtitleBtn = document.getElementById("checkSubtitleBtn");
checkSubtitleBtn.addEventListener("click", async () => {
  checkSubtitleBtn.classList.add("loading");
  resultEl.textContent = "Memeriksa keberadaan file subtitle di halaman...";

  try {
    const tab = await getActiveTab();
    if (!tab) {
      resultEl.textContent = "Error: Tidak ada tab aktif yang ditemukan.";
      return;
    }
    const response = await chrome.tabs.sendMessage(tab.id, { type: "CHECK_SUBTITLE_STATUS" });
    
    if (response && response.detected) {
      resultEl.textContent = `✅ Subtitle ditemukan dan siap/sedang diterjemahkan!\nTipe: ${response.type}`;
    } else {
      resultEl.textContent = `❌ Tidak ada subtitle yang terdeteksi di halaman ini.\n(Pastikan video memiliki CC atau Anda berada di halaman yang tepat)`;
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
    if (!tab) {
      resultEl.textContent = "Error: Tidak ada tab aktif yang ditemukan.";
      return;
    }
    const response = await chrome.tabs.sendMessage(tab.id, { type: "RESTORE_ORIGINAL_TEXT" });
    resultEl.textContent = response.message || response.error || JSON.stringify(response, null, 2);
  } catch (error) {
    resultEl.textContent = "Error: " + error.message + "\n\nCoba reload halaman web lalu klik lagi.";
  } finally {
    restoreBtn.classList.remove("loading");
  }
});

// ===== Test API =====
testApiBtn.addEventListener("click", async () => {
  testApiBtn.classList.add("loading");
  resultEl.textContent = "Mengirim request ke FastAPI...";

  try {
    const response = await fetch(`${apiBase}/api/v1/translate/batch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: "translate",
        items: [{ id: "1", text: "FastAPI is a modern web framework for building APIs with Python." }],
      }),
    });
    const data = await response.json();
    resultEl.textContent = JSON.stringify(data, null, 2);
  } catch (error) {
    resultEl.textContent = "Error: " + error.message;
  } finally {
    testApiBtn.classList.remove("loading");
    loadStats();
  }
});

const modelSelect = document.getElementById("modelSelect");

// ===== Models =====
async function loadModels() {
  try {
    const response = await fetch(`${apiBase}/api/v1/models/`, { signal: AbortSignal.timeout(4000) });
    if (!response.ok) throw new Error("Gagal mengambil model");
    const data = await response.json();
    
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
    modelSelect.disabled = false;
  } catch (error) {
    modelSelect.innerHTML = `<option value="">Gagal memuat model</option>`;
    modelSelect.disabled = true;
  }
}

modelSelect.addEventListener("change", async () => {
  const selectedModel = modelSelect.value;
  if (!selectedModel) return;

  modelSelect.disabled = true;
  resultEl.textContent = `Mengubah model aktif ke "${selectedModel}"...`;

  try {
    const response = await fetch(`${apiBase}/api/v1/models/active`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: selectedModel }),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.detail || `HTTP Error ${response.status}`);
    }

    const data = await response.json();
    resultEl.textContent = `Model aktif berhasil diubah ke: ${data.active_model} ✓`;
    
    // Save model choice in settings
    const settingsData = await chrome.storage.sync.get("marsTranslatorSettings");
    const currentSettings = settingsData.marsTranslatorSettings || {};
    currentSettings.selectedModel = data.active_model;
    await chrome.storage.sync.set({ marsTranslatorSettings: currentSettings });
  } catch (error) {
    resultEl.textContent = `Gagal mengubah model: ${error.message}`;
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
  await loadApiBase();
  checkServerHealth();
  loadStats();
  loadModels();
})();

