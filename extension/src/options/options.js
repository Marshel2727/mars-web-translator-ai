const apiBaseUrlInput = document.getElementById("apiBaseUrl");
const maxBatchSizeInput = document.getElementById("maxBatchSize");
const autoTranslateInput = document.getElementById("autoTranslate");
const saveBtn = document.getElementById("saveBtn");
const resetBtn = document.getElementById("resetBtn");
const clearBrowserCacheBtn = document.getElementById("clearBrowserCacheBtn");
const clearServerCacheBtn = document.getElementById("clearServerCacheBtn");
const toast = document.getElementById("toast");

const SETTINGS_KEY = "marsTranslatorSettings";
const CACHE_KEY = "marsTranslationCacheV1";

const DEFAULTS = {
  apiBaseUrl: "http://127.0.0.1:8000",
  maxBatchSize: 20,
  autoTranslate: true,
};

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("visible");
  setTimeout(() => {
    toast.classList.remove("visible");
  }, 2500);
}

async function loadSettings() {
  const data = await chrome.storage.sync.get(SETTINGS_KEY);
  const settings = { ...DEFAULTS, ...(data[SETTINGS_KEY] || {}) };

  apiBaseUrlInput.value = settings.apiBaseUrl;
  maxBatchSizeInput.value = settings.maxBatchSize;
  autoTranslateInput.checked = settings.autoTranslate;
}

saveBtn.addEventListener("click", async () => {
  const settings = {
    apiBaseUrl: apiBaseUrlInput.value.trim() || DEFAULTS.apiBaseUrl,
    maxBatchSize: parseInt(maxBatchSizeInput.value, 10) || DEFAULTS.maxBatchSize,
    autoTranslate: autoTranslateInput.checked,
  };

  await chrome.storage.sync.set({ [SETTINGS_KEY]: settings });
  showToast("Pengaturan disimpan ✓");
});

resetBtn.addEventListener("click", async () => {
  await chrome.storage.sync.set({ [SETTINGS_KEY]: DEFAULTS });
  apiBaseUrlInput.value = DEFAULTS.apiBaseUrl;
  maxBatchSizeInput.value = DEFAULTS.maxBatchSize;
  autoTranslateInput.checked = DEFAULTS.autoTranslate;
  showToast("Pengaturan di-reset ke default ✓");
});

clearBrowserCacheBtn.addEventListener("click", async () => {
  await chrome.storage.local.remove(CACHE_KEY);
  showToast("Cache browser dihapus ✓");
});

clearServerCacheBtn.addEventListener("click", async () => {
  try {
    const settings = await chrome.storage.sync.get(SETTINGS_KEY);
    const baseUrl = settings[SETTINGS_KEY]?.apiBaseUrl || DEFAULTS.apiBaseUrl;
    const response = await fetch(`${baseUrl}/api/v1/cache/clear`, { method: "DELETE" });
    if (response.ok) {
      showToast("Cache server dihapus ✓");
    } else {
      showToast("Gagal menghapus cache server");
    }
  } catch {
    showToast("Tidak bisa terhubung ke server");
  }
});

loadSettings();
