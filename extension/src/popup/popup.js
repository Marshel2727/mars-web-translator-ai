const resultEl = document.getElementById("result");

document.getElementById("translateVisibleBtn").addEventListener("click", async () => {
  resultEl.textContent = "Menerjemahkan teks yang terlihat...";

  try {
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true
    });

    const response = await chrome.tabs.sendMessage(tab.id, {
      type: "TRANSLATE_VISIBLE_TEXT"
    });

    resultEl.textContent = response.message || response.error || JSON.stringify(response, null, 2);
  } catch (error) {
    resultEl.textContent = "Error: " + error.message + "\n\nCoba reload halaman web lalu klik lagi.";
  }
});

document.getElementById("restoreBtn").addEventListener("click", async () => {
  resultEl.textContent = "Mengembalikan teks asli...";

  try {
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true
    });

    const response = await chrome.tabs.sendMessage(tab.id, {
      type: "RESTORE_ORIGINAL_TEXT"
    });

    resultEl.textContent = response.message || response.error || JSON.stringify(response, null, 2);
  } catch (error) {
    resultEl.textContent = "Error: " + error.message + "\n\nCoba reload halaman web lalu klik lagi.";
  }
});

document.getElementById("testApiBtn").addEventListener("click", async () => {
  resultEl.textContent = "Mengirim request ke FastAPI...";

  try {
    const response = await fetch("http://127.0.0.1:8000/api/v1/translate/batch", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        mode: "translate",
        items: [
          {
            id: "1",
            text: "FastAPI is a modern web framework for building APIs with Python."
          }
        ]
      })
    });

    const data = await response.json();
    resultEl.textContent = JSON.stringify(data, null, 2);
  } catch (error) {
    resultEl.textContent = "Error: " + error.message;
  }
});
