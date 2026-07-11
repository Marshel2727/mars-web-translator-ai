const resultEl = document.getElementById("result");
const statusDot = document.getElementById("statusDot");
const statusText = document.getElementById("statusText");
const cacheCountEl = document.getElementById("cacheCount");
const serverCacheCountEl = document.getElementById("serverCacheCount");
const translateBtn = document.getElementById("translateVisibleBtn");
const restoreBtn = document.getElementById("restoreBtn");
const testApiBtn = document.getElementById("testApiBtn");
const openOptionsLink = document.getElementById("openOptionsLink");

const API_BASE = "http://127.0.0.1:8000";

// ===== Health Check =====
async function checkServerHealth() {
  try {
    const response = await fetch(`${API_BASE}/api/v1/health/`, { signal: AbortSignal.timeout(3000) });
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
    const response = await fetch(`${API_BASE}/api/v1/cache/stats`, { signal: AbortSignal.timeout(3000) });
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
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const response = await chrome.tabs.sendMessage(tab.id, { type: "TRANSLATE_VISIBLE_TEXT" });
    resultEl.textContent = response.message || response.error || JSON.stringify(response, null, 2);
  } catch (error) {
    resultEl.textContent = "Error: " + error.message + "\n\nCoba reload halaman web lalu klik lagi.";
  } finally {
    translateBtn.classList.remove("loading");
    loadStats();
  }
});

// ===== Restore =====
restoreBtn.addEventListener("click", async () => {
  restoreBtn.classList.add("loading");
  resultEl.textContent = "Mengembalikan teks asli...";

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
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
    const response = await fetch(`${API_BASE}/api/v1/translate/batch`, {
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

// ===== Options Link =====
openOptionsLink.addEventListener("click", (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});

// ===== Init =====
checkServerHealth();
loadStats();
