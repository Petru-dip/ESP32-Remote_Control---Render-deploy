const WORKER_BASE = "https://christmas-tree.christmas-tree.workers.dev";
const WORKER_SET_URL = `${WORKER_BASE}/set`;
const WORKER_STATE_URL = `${WORKER_BASE}/state`;

let statusEl = null;
let espStateEl = null;

let led1StateEl = null;
let led2StateEl = null;

let led1IntensityInput = null;
let led2IntensityInput = null;
let led1IntensityLabel = null;
let led2IntensityLabel = null;
let programSelect = null;

let led1Mode = "off";
let led2Mode = "off";
let led1Intensity = 255;
let led2Intensity = 255;
let program = "none";

function updateIntensityLabels() {
  if (led1IntensityLabel) led1IntensityLabel.textContent = led1Intensity;
  if (led2IntensityLabel) led2IntensityLabel.textContent = led2Intensity;
}

function updateActiveButtons() {
  const buttons = document.querySelectorAll("button[data-led][data-mode]");
  buttons.forEach((btn) => {
    const led = btn.getAttribute("data-led");
    const mode = btn.getAttribute("data-mode");
    const isActive =
      (led === "1" && mode === led1Mode) ||
      (led === "2" && mode === led2Mode);
    btn.classList.toggle("mode-active", isActive);
  });
}

function buildCommandString() {
  return `L1:${led1Mode}:${led1Intensity};L2:${led2Mode}:${led2Intensity};P:${program}`;
}

async function sendConfig() {
  const cmd = buildCommandString();
  if (statusEl) statusEl.textContent = "Trimit configurarea...";

  try {
    const res = await fetch(WORKER_SET_URL, {
      method: "POST",
      body: cmd,
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

    const l1m = data.led1_mode || "necunoscut";
    const l2m = data.led2_mode || "necunoscut";
    const l1i =
      data.led1_intensity === null || data.led1_intensity === undefined
        ? "n/a"
        : data.led1_intensity;
    const l2i =
      data.led2_intensity === null || data.led2_intensity === undefined
        ? "n/a"
        : data.led2_intensity;
    const prog = data.program || "none";
    const time = data.updated_at
      ? new Date(data.updated_at).toLocaleTimeString()
      : "necunoscut";

    espStateEl.textContent = `Stare ESP → LED1: ${l1m} (${l1i}) | LED2: ${l2m} (${l2i}) | Program: ${prog} | Ultima: ${time}`;

    if (led1StateEl) {
      led1StateEl.textContent = `${l1m} (${l1i})`;
    }
    if (led2StateEl) {
      led2StateEl.textContent = `${l2m} (${l2i})`;
    }
  } catch (e) {
    console.error(e);
    espStateEl.textContent = "Nu pot citi starea.";
  }
}

document.addEventListener("DOMContentLoaded", () => {
  statusEl = document.getElementById("status");
  espStateEl = document.getElementById("esp-state");

  led1StateEl = document.getElementById("led1-state");
  led2StateEl = document.getElementById("led2-state");

  led1IntensityInput = document.getElementById("led1-intensity");
  led2IntensityInput = document.getElementById("led2-intensity");
  led1IntensityLabel = document.getElementById("led1-intensity-label");
  led2IntensityLabel = document.getElementById("led2-intensity-label");
  programSelect = document.getElementById("program-select");

  if (led1IntensityInput) {
    led1IntensityInput.addEventListener("input", (e) => {
      led1Intensity = parseInt(e.target.value, 10) || 0;
      updateIntensityLabels();
    });
    led1IntensityInput.addEventListener("change", () => {
      sendConfig();
    });
  }

  if (led2IntensityInput) {
    led2IntensityInput.addEventListener("input", (e) => {
      led2Intensity = parseInt(e.target.value, 10) || 0;
      updateIntensityLabels();
    });
    led2IntensityInput.addEventListener("change", () => {
      sendConfig();
    });
  }

  if (programSelect) {
    programSelect.addEventListener("change", (e) => {
      program = e.target.value || "none";
      sendConfig();
    });
  }

  const modeButtons = document.querySelectorAll("button[data-led][data-mode]");
  modeButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const led = btn.getAttribute("data-led");
      const mode = btn.getAttribute("data-mode");

      if (led === "1") {
        led1Mode = mode;
      } else if (led === "2") {
        led2Mode = mode;
      }

      updateActiveButtons();
      sendConfig();
    });
  });

  const applyBtn = document.getElementById("apply-btn");
  if (applyBtn) {
    applyBtn.addEventListener("click", () => {
      sendConfig();
    });
  }

  updateIntensityLabels();
  updateActiveButtons();
  fetchState();
  setInterval(fetchState, 5000);
});
