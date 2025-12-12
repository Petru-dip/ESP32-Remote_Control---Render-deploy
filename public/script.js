const WORKER_BASE = "https://christmas-tree.christmas-tree.workers.dev";
const WORKER_SET_URL = `${WORKER_BASE}/set`;
const WORKER_STATE_URL = `${WORKER_BASE}/state`;
const WORKER_HISTORY_URL = `${WORKER_BASE}/history`;
const WORKER_SCHEDULE_URL = `${WORKER_BASE}/schedule`;
const WORKER_SCHEDULE_LIST_URL = `${WORKER_BASE}/schedule/list`;

let statusEl, espStateEl;
let led1StateEl, led2StateEl, led3StateEl;
let led1IntensityInput, led2IntensityInput, led3IntensityInput;
let led1IntensityLabel, led2IntensityLabel, led3IntensityLabel;
let programSelect;
let playlistSelect, playlistStartBtn;
let scheduleTimeInput, scheduleModeSelect, scheduleSetBtn;
let historyCanvas, historyCtx, historyRefreshBtn, statsEl;

let led1Mode = "off";
let led2Mode = "off";
let led3Mode = "off";
let led1Intensity = 255;
let led2Intensity = 255;
let led3Intensity = 255;
let program = "none";

function updateIntensityLabels() {
  if (led1IntensityLabel) led1IntensityLabel.textContent = led1Intensity;
  if (led2IntensityLabel) led2IntensityLabel.textContent = led2Intensity;
  if (led3IntensityLabel) led3IntensityLabel.textContent = led3Intensity;
}

function updateActiveButtons() {
  const buttons = document.querySelectorAll("button[data-led][data-mode]");
  buttons.forEach((btn) => {
    const led = btn.getAttribute("data-led");
    const mode = btn.getAttribute("data-mode");
    const active =
      (led === "1" && mode === led1Mode) ||
      (led === "2" && mode === led2Mode) ||
      (led === "3" && mode === led3Mode);
    btn.classList.toggle("mode-active", active);
  });
}

function buildCommandString() {
  return `L1:${led1Mode}:${led1Intensity};L2:${led2Mode}:${led2Intensity};L3:${led3Mode}:${led3Intensity};P:${program}`;
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
      if (statusEl) statusEl.textContent = `Comanda trimisa: ${cmd}`;
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
    const l3m = data.led3_mode || "necunoscut";
    const l1i = data.led1_intensity ?? "n/a";
    const l2i = data.led2_intensity ?? "n/a";
    const l3i = data.led3_intensity ?? "n/a";
    const prog = data.program || "none";
    const time = data.updated_at
      ? new Date(data.updated_at).toLocaleTimeString()
      : "necunoscut";

    espStateEl.textContent = `Stare ESP -> LED1: ${l1m} (${l1i}) | LED2: ${l2m} (${l2i}) | LED3: ${l3m} (${l3i}) | Program: ${prog} | Ultima: ${time}`;

    if (led1StateEl) led1StateEl.textContent = `${l1m} (${l1i})`;
    if (led2StateEl) led2StateEl.textContent = `${l2m} (${l2i})`;
    if (led3StateEl) led3StateEl.textContent = `${l3m} (${l3i})`;
  } catch (e) {
    console.error(e);
    espStateEl.textContent = "Nu pot citi starea.";
  }
}

// ----------- HISTORY (timeline + statistici) -----------
async function fetchHistory() {
  try {
    const res = await fetch(`${WORKER_HISTORY_URL}?limit=200`);
    if (!res.ok) {
      if (statsEl) statsEl.textContent = "Nu pot citi istoricul.";
      return;
    }
    const data = await res.json();
    drawHistory(data);
    computeStats(data);
  } catch (e) {
    console.error(e);
    if (statsEl) statsEl.textContent = "Eroare la citirea istoricului.";
  }
}

function drawHistory(rows) {
  if (!historyCtx || !rows || !rows.length) return;

  const w = historyCanvas.width;
  const h = historyCanvas.height;
  historyCtx.clearRect(0, 0, w, h);

  const maxPoints = rows.length;
  const stepX = w / Math.max(1, maxPoints - 1);

  const modeColor = (mode) => {
    switch (mode) {
      case "on": return "#4ade80";
      case "blink": return "#f97316";
      case "fade": return "#38bdf8";
      case "sparkle": return "#eab308";
      default: return "#64748b";
    }
  };

  // LED1 sus, LED2 mijloc, LED3 jos
  const bands = [
    { key: "led1_mode", y: 0.05 },
    { key: "led2_mode", y: 0.38 },
    { key: "led3_mode", y: 0.71 },
  ];

  rows
    .slice()
    .reverse()
    .forEach((row, idx) => {
      const x = idx * stepX;
      const barW = Math.max(2, stepX * 0.6);
      const barH = h * 0.22;

      bands.forEach((band) => {
        const mode = row[band.key] || "unknown";
        historyCtx.fillStyle = modeColor(mode);
        historyCtx.fillRect(x, h * band.y, barW, barH);
      });
    });
}

function computeStats(rows) {
  if (!statsEl || !rows || !rows.length) return;

  const countModes = (rows, ledKey) => {
    const map = {};
    rows.forEach((row) => {
      const m = (row[ledKey] || "unknown").toString();
      map[m] = (map[m] || 0) + 1;
    });
    return map;
  };

  const topMode = (map) => {
    let best = null;
    let bestCount = -1;
    for (const [m, c] of Object.entries(map)) {
      if (c > bestCount) {
        best = m;
        bestCount = c;
      }
    }
    return { mode: best, count: bestCount };
  };

  const led1Stats = countModes(rows, "led1_mode");
  const led2Stats = countModes(rows, "led2_mode");
  const led3Stats = countModes(rows, "led3_mode");

  const top1 = topMode(led1Stats);
  const top2 = topMode(led2Stats);
  const top3 = topMode(led3Stats);

  statsEl.innerHTML = `
    <div><strong>LED1</strong> - cel mai folosit mod: <strong>${top1.mode}</strong> (${top1.count} inregistrari)</div>
    <div><strong>LED2</strong> - cel mai folosit mod: <strong>${top2.mode}</strong> (${top2.count} inregistrari)</div>
    <div><strong>LED3</strong> - cel mai folosit mod: <strong>${top3.mode}</strong> (${top3.count} inregistrari)</div>
  `;
}

// ----------- PLAYLIST-uri / programari auto -----------
function buildPlaylist(name) {
  const steps = [];
  const now = Date.now();
  const stepDuration = 3000; // 3 secunde per pas
  let t = now + 5000; // incepem peste 5 secunde

  if (name === "party") {
    const seq = [
      "L1:blink:255;L2:fade:180;L3:blink:200;P:none",
      "L1:fade:180;L2:blink:255;L3:sparkle:220;P:none",
      "L1:sparkle:255;L2:sparkle:200;L3:sparkle:255;P:none",
      "L1:on:255;L2:off:0;L3:on:180;P:none",
      "L1:off:0;L2:on:255;L3:fade:160;P:none",
      "L1:sparkle:255;L2:sparkle:255;L3:blink:255;P:none",
    ];
    seq.forEach((cmd, i) => {
      steps.push({ run_at: t + i * stepDuration, cmd, label: `Party step ${i + 1}` });
    });
  } else if (name === "calm") {
    const seq = [
      "L1:fade:120;L2:fade:80;L3:fade:60;P:none",
      "L1:fade:80;L2:fade:120;L3:fade:100;P:none",
      "L1:on:60;L2:on:60;L3:on:60;P:none",
    ];
    seq.forEach((cmd, i) => {
      steps.push({ run_at: t + i * stepDuration, cmd, label: `Calm step ${i + 1}` });
    });
  } else if (name === "crazy") {
    for (let i = 0; i < 8; i++) {
      const intens1 = Math.floor(Math.random() * 256);
      const intens2 = Math.floor(Math.random() * 256);
      const intens3 = Math.floor(Math.random() * 256);
      const modes = ["blink", "fade", "sparkle"];
      const m1 = modes[Math.floor(Math.random() * modes.length)];
      const m2 = modes[Math.floor(Math.random() * modes.length)];
      const m3 = modes[Math.floor(Math.random() * modes.length)];
      const cmd = `L1:${m1}:${intens1};L2:${m2}:${intens2};L3:${m3}:${intens3};P:none`;
      steps.push({
        run_at: t + i * (stepDuration / 2),
        cmd,
        label: `Crazy step ${i + 1}`,
      });
    }
  }

  return steps;
}

async function startPlaylist() {
  const name = playlistSelect.value;
  if (!name) {
    if (statusEl) statusEl.textContent = "Alege un playlist.";
    return;
  }

  const items = buildPlaylist(name);
  if (!items.length) {
    if (statusEl) statusEl.textContent = "Playlist gol.";
    return;
  }

  try {
    const res = await fetch(WORKER_SCHEDULE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items }),
    });

    if (res.ok) {
      if (statusEl) statusEl.textContent = `Playlist "${name}" programat.`;
    } else {
      if (statusEl) statusEl.textContent = "Eroare la programarea playlistului.";
    }
  } catch (e) {
    console.error(e);
    if (statusEl) statusEl.textContent = "Nu pot programa playlistul.";
  }
}

// ----------- PROGRAMARE PE ORE -----------
function computeTodayTimeMs(hhmm) {
  if (!hhmm || !hhmm.includes(":")) return null;
  const [hh, mm] = hhmm.split(":").map((v) => parseInt(v, 10));
  if (isNaN(hh) || isNaN(mm)) return null;

  const now = new Date();
  const d = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    hh,
    mm,
    0,
    0
  );
  if (d.getTime() < now.getTime()) {
    d.setDate(d.getDate() + 1);
  }
  return d.getTime();
}

async function setScheduledMode() {
  const hhmm = scheduleTimeInput.value;
  const mode = scheduleModeSelect.value || "on";

  const runAt = computeTodayTimeMs(hhmm);
  if (!runAt) {
    if (statusEl) statusEl.textContent = "Ora invalida.";
    return;
  }

  const cmd = `L1:${mode}:255;L2:${mode}:255;L3:${mode}:255;P:none`;
  const label = `Program ${mode} la ${hhmm}`;

  try {
    const res = await fetch(WORKER_SCHEDULE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items: [{ run_at: runAt, cmd, label }] }),
    });

    if (res.ok) {
      if (statusEl) statusEl.textContent = `Programare salvata: ${label}`;
    } else {
      if (statusEl) statusEl.textContent = "Eroare la salvarea programarii.";
    }
  } catch (e) {
    console.error(e);
    if (statusEl) statusEl.textContent = "Nu pot trimite programarea.";
  }
}

function wireIntensityControl(inputEl, onUpdate) {
  if (!inputEl) return;
  inputEl.addEventListener("input", (e) => {
    onUpdate(parseInt(e.target.value, 10) || 0);
    updateIntensityLabels();
  });
  inputEl.addEventListener("change", () => {
    sendConfig();
  });
}

// ----------- INIT -----------
document.addEventListener("DOMContentLoaded", () => {
  statusEl = document.getElementById("status");
  espStateEl = document.getElementById("esp-state");

  led1StateEl = document.getElementById("led1-state");
  led2StateEl = document.getElementById("led2-state");
  led3StateEl = document.getElementById("led3-state");

  led1IntensityInput = document.getElementById("led1-intensity");
  led2IntensityInput = document.getElementById("led2-intensity");
  led3IntensityInput = document.getElementById("led3-intensity");

  led1IntensityLabel = document.getElementById("led1-intensity-label");
  led2IntensityLabel = document.getElementById("led2-intensity-label");
  led3IntensityLabel = document.getElementById("led3-intensity-label");
  programSelect = document.getElementById("program-select");

  playlistSelect = document.getElementById("playlist-select");
  playlistStartBtn = document.getElementById("playlist-start-btn");

  scheduleTimeInput = document.getElementById("time-input");
  scheduleModeSelect = document.getElementById("schedule-mode-select");
  scheduleSetBtn = document.getElementById("schedule-set-btn");

  historyCanvas = document.getElementById("history-canvas");
  statsEl = document.getElementById("stats");
  historyRefreshBtn = document.getElementById("history-refresh-btn");
  if (historyCanvas) historyCtx = historyCanvas.getContext("2d");

  wireIntensityControl(led1IntensityInput, (val) => (led1Intensity = val));
  wireIntensityControl(led2IntensityInput, (val) => (led2Intensity = val));
  wireIntensityControl(led3IntensityInput, (val) => (led3Intensity = val));

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

      if (led === "1") led1Mode = mode;
      else if (led === "2") led2Mode = mode;
      else if (led === "3") led3Mode = mode;

      updateActiveButtons();
      sendConfig();
    });
  });

  const applyBtn = document.getElementById("apply-btn");
  if (applyBtn) {
    applyBtn.addEventListener("click", sendConfig);
  }

  if (playlistStartBtn) {
    playlistStartBtn.addEventListener("click", startPlaylist);
  }

  if (scheduleSetBtn) {
    scheduleSetBtn.addEventListener("click", setScheduledMode);
  }

  if (historyRefreshBtn) {
    historyRefreshBtn.addEventListener("click", fetchHistory);
  }

  updateIntensityLabels();
  updateActiveButtons();
  fetchState();
  fetchHistory();
  setInterval(fetchState, 5000);
});
