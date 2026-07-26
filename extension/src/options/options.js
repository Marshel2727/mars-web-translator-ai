// ---- DOM refs ----
const apiBaseUrlInput    = document.getElementById("apiBaseUrl");
const maxBatchSizeInput  = document.getElementById("maxBatchSize");
const autoTranslateInput = document.getElementById("autoTranslate");
const modelSelectInput   = document.getElementById("modelSelect");

// Ollama parameter controls
const numCtxSelect       = document.getElementById("numCtx");
const numCtxBadge        = document.getElementById("numCtxBadge");
const numPredictRange    = document.getElementById("numPredict");
const numPredictValue    = document.getElementById("numPredictValue");
const temperatureRange   = document.getElementById("temperature");
const temperatureValue   = document.getElementById("temperatureValue");
const topPRange          = document.getElementById("topP");
const topPValue          = document.getElementById("topPValue");
const keepAliveSelect    = document.getElementById("keepAlive");

// Action buttons
const saveBtn             = document.getElementById("saveBtn");
const resetBtn            = document.getElementById("resetBtn");
const clearBrowserCacheBtn= document.getElementById("clearBrowserCacheBtn");
const clearServerCacheBtn = document.getElementById("clearServerCacheBtn");
const toast               = document.getElementById("toast");

// Preset buttons
const presetSubtitle  = document.getElementById("presetSubtitle");
const presetBalanced  = document.getElementById("presetBalanced");
const presetQuality   = document.getElementById("presetQuality");

const SETTINGS_KEY = "marsTranslatorSettings";
const CACHE_KEY    = "marsTranslationCacheV1";

// ---- Preset definitions ----
const PRESETS = {
  subtitle: {
    numCtx: 512,
    numPredict: 64,
    temperature: 0.0,
    topP: 0.8,
    keepAlive: "30m",
    label: "Subtitle Video",
  },
  balanced: {
    numCtx: 2048,
    numPredict: 128,
    temperature: 0.0,
    topP: 0.8,
    keepAlive: "30m",
    label: "Seimbang",
  },
  quality: {
    numCtx: 4096,
    numPredict: 256,
    temperature: 0.1,
    topP: 0.9,
    keepAlive: "1h",
    label: "Kualitas Tinggi",
  },
};

const DEFAULTS = {
  apiBaseUrl:   "http://127.0.0.1:8000",
  maxBatchSize: 20,
  autoTranslate: true,
  selectedModel: "",
  // Ollama inference params
  numCtx:      2048,
  numPredict:  128,
  temperature: 0.0,
  topP:        0.8,
  keepAlive:   "30m",
};

// ---- Toast ----
function showToast(message, ok = true) {
  toast.textContent = message;
  toast.style.background = ok
    ? "rgba(139, 92, 246, 0.9)"
    : "rgba(220, 38, 38, 0.85)";
  toast.classList.add("visible");
  setTimeout(() => toast.classList.remove("visible"), 2800);
}

// ---- Live-update display values for sliders ----
function updateNumPredictDisplay() {
  numPredictValue.textContent = numPredictRange.value;
}
function updateTemperatureDisplay() {
  temperatureValue.textContent = parseFloat(temperatureRange.value).toFixed(2);
}
function updateTopPDisplay() {
  topPValue.textContent = parseFloat(topPRange.value).toFixed(2);
}
function updateNumCtxBadge() {
  numCtxBadge.textContent = `${numCtxSelect.value} token`;
}

numPredictRange.addEventListener("input", updateNumPredictDisplay);
temperatureRange.addEventListener("input", updateTemperatureDisplay);
topPRange.addEventListener("input", updateTopPDisplay);
numCtxSelect.addEventListener("change", updateNumCtxBadge);

// ---- Apply preset ----
function applyPreset(key) {
  const p = PRESETS[key];
  if (!p) return;
  numCtxSelect.value      = String(p.numCtx);
  numPredictRange.value   = p.numPredict;
  temperatureRange.value  = p.temperature;
  topPRange.value         = p.topP;
  keepAliveSelect.value   = p.keepAlive;
  updateNumCtxBadge();
  updateNumPredictDisplay();
  updateTemperatureDisplay();
  updateTopPDisplay();
  // Mark active preset button
  [presetSubtitle, presetBalanced, presetQuality].forEach(btn =>
    btn.classList.toggle("active", btn.dataset.preset === key)
  );
  showToast(`✓ Preset "${p.label}" diterapkan`);
}

presetSubtitle.addEventListener("click", () => applyPreset("subtitle"));
presetBalanced.addEventListener("click", () => applyPreset("balanced"));
presetQuality.addEventListener("click",  () => applyPreset("quality"));

// ---- Load Ollama model list ----
async function loadModels(baseUrl) {
  try {
    const response = await fetch(`${baseUrl}/api/v1/models/`);
    if (!response.ok) return;
    const data = await response.json();
    modelSelectInput.innerHTML = "";
    data.models.forEach((m) => {
      const opt = document.createElement("option");
      opt.value       = m;
      opt.textContent = m;
      if (m === data.active_model) opt.selected = true;
      modelSelectInput.appendChild(opt);
    });
  } catch {
    modelSelectInput.innerHTML = `<option value="">Gagal memuat model (server offline?)</option>`;
  }
}

// ---- Load settings from storage ----
async function loadSettings() {
  const data     = await chrome.storage.sync.get(SETTINGS_KEY);
  const settings = { ...DEFAULTS, ...(data[SETTINGS_KEY] || {}) };

  apiBaseUrlInput.value    = settings.apiBaseUrl;
  maxBatchSizeInput.value  = settings.maxBatchSize;
  autoTranslateInput.checked = settings.autoTranslate;

  // Ollama params
  numCtxSelect.value     = String(settings.numCtx    ?? DEFAULTS.numCtx);
  numPredictRange.value  = settings.numPredict        ?? DEFAULTS.numPredict;
  temperatureRange.value = settings.temperature       ?? DEFAULTS.temperature;
  topPRange.value        = settings.topP              ?? DEFAULTS.topP;
  keepAliveSelect.value  = settings.keepAlive         ?? DEFAULTS.keepAlive;

  // Update display values
  updateNumCtxBadge();
  updateNumPredictDisplay();
  updateTemperatureDisplay();
  updateTopPDisplay();

  await loadModels(settings.apiBaseUrl);
}

// ---- Save settings ----
saveBtn.addEventListener("click", async () => {
  const baseUrl      = apiBaseUrlInput.value.trim() || DEFAULTS.apiBaseUrl;
  const selectedModel = modelSelectInput.value;

  const settings = {
    apiBaseUrl:    baseUrl,
    maxBatchSize:  parseInt(maxBatchSizeInput.value, 10) || DEFAULTS.maxBatchSize,
    autoTranslate: autoTranslateInput.checked,
    selectedModel,
    // Ollama inference params
    numCtx:      parseInt(numCtxSelect.value, 10)       || DEFAULTS.numCtx,
    numPredict:  parseInt(numPredictRange.value, 10)    || DEFAULTS.numPredict,
    temperature: parseFloat(temperatureRange.value)     ?? DEFAULTS.temperature,
    topP:        parseFloat(topPRange.value)            ?? DEFAULTS.topP,
    keepAlive:   keepAliveSelect.value                  || DEFAULTS.keepAlive,
  };

  await chrome.storage.sync.set({ [SETTINGS_KEY]: settings });

  if (selectedModel) {
    try {
      await fetch(`${baseUrl}/api/v1/models/active`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: selectedModel }),
      });
    } catch {
      // Ignored if server is offline
    }
  }

  showToast("✓ Pengaturan disimpan");
});

// ---- Reset to defaults ----
resetBtn.addEventListener("click", async () => {
  await chrome.storage.sync.set({ [SETTINGS_KEY]: DEFAULTS });

  apiBaseUrlInput.value    = DEFAULTS.apiBaseUrl;
  maxBatchSizeInput.value  = DEFAULTS.maxBatchSize;
  autoTranslateInput.checked = DEFAULTS.autoTranslate;

  numCtxSelect.value     = String(DEFAULTS.numCtx);
  numPredictRange.value  = DEFAULTS.numPredict;
  temperatureRange.value = DEFAULTS.temperature;
  topPRange.value        = DEFAULTS.topP;
  keepAliveSelect.value  = DEFAULTS.keepAlive;

  updateNumCtxBadge();
  updateNumPredictDisplay();
  updateTemperatureDisplay();
  updateTopPDisplay();

  [presetSubtitle, presetBalanced, presetQuality].forEach(btn =>
    btn.classList.remove("active")
  );
  presetBalanced.classList.add("active"); // default == balanced

  await loadModels(DEFAULTS.apiBaseUrl);
  showToast("↺ Pengaturan di-reset ke default");
});

// ---- Cache actions ----
clearBrowserCacheBtn.addEventListener("click", async () => {
  await chrome.storage.local.remove(CACHE_KEY);
  showToast("🗑️ Cache browser dihapus");
});

clearServerCacheBtn.addEventListener("click", async () => {
  try {
    const data    = await chrome.storage.sync.get(SETTINGS_KEY);
    const baseUrl = data[SETTINGS_KEY]?.apiBaseUrl || DEFAULTS.apiBaseUrl;
    const response = await fetch(`${baseUrl}/api/v1/cache/clear`, { method: "DELETE" });
    if (response.ok) {
      showToast("🗑️ Cache server dihapus");
    } else {
      showToast("Gagal menghapus cache server", false);
    }
  } catch {
    showToast("Tidak bisa terhubung ke server", false);
  }
});

// ---- Init ----
loadSettings();
