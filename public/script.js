const WORKER_BASE = "https://christmas-tree.christmas-tree.workers.dev";
const WORKER_SET_URL = `${WORKER_BASE}/set`;
const WORKER_STATE_URL = `${WORKER_BASE}/state`;

let statusEl = null;
let espStateEl = null;

async function sendCmd(cmd) {
  if (statusEl) statusEl.textContent = "Trimit comanda...";

  try {
    const res = await fetch(WORKER_SET_URL, {
      method: "POST",
      body: cmd
    });

    if (res.ok) {
      if (statusEl) statusEl.textContent = `Comandă trimisă: ${cmd}`;
      fetchState();
    } else {
      if (statusEl) statusEl.textContent = "Eroare la trimitere.";
    }
  } catch (e) {
    console.error(e);
    if (statusEl) statusEl.textContent = "Nu pot contacta serverul.";
  }
}

async function fetchState() {
  if (!espStateEl) return;
  try {
    const res = await fetch(WORKER_STATE_URL);
    if (!res.ok) {
      espStateEl.textContent = "Nu pot citi starea.";
      return;
    }
    const data = await res.json();
    const intensity = data.intensity === null || data.intensity === undefined ? "n/a" : data.intensity;
    const time = data.updated_at ? new Date(data.updated_at).toLocaleTimeString() : "necunoscut";
    const mode = data.mode || "necunoscut";
    espStateEl.textContent = `Stare ESP: ${mode} | Intensitate: ${intensity} | Ultima: ${time}`;
  } catch (e) {
    console.error(e);
    espStateEl.textContent = "Nu pot citi starea.";
  }
}

document.addEventListener("DOMContentLoaded", () => {
  statusEl = document.getElementById("status");
  espStateEl = document.getElementById("esp-state");
  fetchState();
  setInterval(fetchState, 5000);
});
