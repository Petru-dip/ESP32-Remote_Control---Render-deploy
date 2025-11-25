const TOKEN = "BtC_92fA7xP14_QmZ87Lw3vS4nHk";
const API_BASE = ""; // same origin

const tempEl = document.getElementById("temperature");
const relaySetEl = document.getElementById("relaySet");
const relayEspEl = document.getElementById("relayESP");
const browserTimeEl = document.getElementById("browserTime");
const espTimeEl = document.getElementById("espTime");
const lastUpdateEl = document.getElementById("lastUpdate");
const modeLabel = document.getElementById("modeLabel");

const onBtn = document.getElementById("onBtn");
const offBtn = document.getElementById("offBtn");
const manualBtn = document.getElementById("manualBtn");
const autoBtn = document.getElementById("autoBtn");
const minInput = document.getElementById("minTempInput");
const maxInput = document.getElementById("maxTempInput");
const saveRangeBtn = document.getElementById("saveRangeBtn");
const historyInfo = document.getElementById("historyInfo");
const historyCanvas = document.getElementById("historyChart");
const resetZoomBtn = document.getElementById("resetZoomBtn");
const rangeButtons = document.querySelectorAll(".range-btn");

let historyChart = null;
let currentRange = "24h";
let isLoadingHistory = false;
let gradients = null;
let cachedPoints24h = [];
let lastHistoryTs = 0;
let zoomRegistered = false;

function formatTime(ts) {
  if (!ts) return "--";
  const n = Number(ts);
  if (Number.isNaN(n)) return "--";
  return new Date(n).toLocaleString("ro-RO");
}

let isUpdating = false;

async function updateData(force = false) {
  // evităm flood
  if (isUpdating && !force) return;
  isUpdating = true;

  try {
    const res = await fetch(`${API_BASE}/api/temp?token=${TOKEN}`);
    const data = await res.json();

    const temp = parseFloat(data.temp ?? "0");
    tempEl.textContent = `${temp.toFixed(1)} °C`;

    modeLabel.textContent = (data.mode ?? "manual").toUpperCase();

    relaySetEl.textContent = (data.relaySet ?? "off").toUpperCase();
    relaySetEl.style.color = data.relaySet === "on" ? "#4caf50" : "#f44336";

    relayEspEl.textContent = (data.relayESP ?? "off").toUpperCase();
    relayEspEl.style.color = data.relayESP === "on" ? "#4caf50" : "#f44336";

    browserTimeEl.textContent = formatTime(data.lastBrowserUpdate);
    espTimeEl.textContent = formatTime(data.lastEspUpdate);
    lastUpdateEl.textContent = "Ultima actualizare ESP: " + formatTime(data.lastEspUpdate);

    if (data.minTemp) minInput.value = data.minTemp;
    if (data.maxTemp) maxInput.value = data.maxTemp;

  } catch (e) {
    console.error(e);
    lastUpdateEl.textContent = "Eroare la citire date";
  }

  isUpdating = false;
}

async function sendCommand(url) {
  try {
    await fetch(url);
    updateData(true); // 🔥 refresh instant după comenzi
    loadHistory(currentRange);
  } catch (e) {
    console.error("Command error:", e);
  }
}

function formatHistoryLabel(ts, range) {
  const d = new Date(Number(ts));
  if (range === "24h") {
    return d.toLocaleTimeString("ro-RO", { hour: "2-digit", minute: "2-digit" });
  }
  return d.toLocaleString("ro-RO", { month: "2-digit", day: "2-digit", hour: "2-digit" });
}

function destroyHistoryChart() {
  if (historyChart) {
    historyChart.destroy();
    historyChart = null;
  }
}

function ensureZoomRegistered() {
  if (zoomRegistered) return;
  const c = window.Chart;
  if (!c || !c.register) return;
  const already = c.registry?.plugins?.get?.("zoom");
  if (already) {
    zoomRegistered = true;
    return;
  }
  const z = c.Zoom || (window["chartjs-plugin-zoom"]);
  if (z) {
    c.register(z);
    zoomRegistered = true;
  }
}

// Minimal candlestick overlay drawn on top of an invisible bar dataset
const candlesOverlay = {
  id: "candlesOverlay",
  defaults: {
    color: "#1976d2",
    bodyHeight: 8,
    maxBodyWidth: 28,
    bodyWidthFactor: 0.9
  },
  afterDatasetsDraw(chart, args, opts) {
    const { ctx, scales } = chart;
    const ds = chart.data.datasets[0];
    if (!ds || !Array.isArray(ds.data)) return;
    const meta = chart.getDatasetMeta(0);
    ctx.save();
    ctx.strokeStyle = opts.color;
    ctx.fillStyle = opts.color;
    meta.data.forEach((elem, idx) => {
      const point = ds.data[idx];
      if (!point) return;
      const x = elem.x;
      const yMin = scales.y.getPixelForValue(point.l);
      const yMax = scales.y.getPixelForValue(point.h);
      const yAvg = scales.y.getPixelForValue(point.c);
      ctx.lineWidth = 2;
      // wick
      ctx.beginPath();
      ctx.moveTo(x, yMax);
      ctx.lineTo(x, yMin);
      ctx.stroke();
      // body (flat because open=close=avg)
      const bodyW = Math.min(elem.width * opts.bodyWidthFactor, opts.maxBodyWidth);
      const bodyH = opts.bodyHeight;
      ctx.fillRect(x - bodyW / 2, yAvg - bodyH / 2, bodyW, bodyH);
    });
    ctx.restore();
  }
};

function renderHistory(points, range) {
  destroyHistoryChart();
  ensureZoomRegistered();

  if (!gradients) {
    const ctx = historyCanvas.getContext("2d");
    const tempGrad = ctx.createLinearGradient(0, 0, 0, historyCanvas.height);
    tempGrad.addColorStop(0, "rgba(25, 118, 210, 0.28)");
    tempGrad.addColorStop(1, "rgba(25, 118, 210, 0.04)");

    const relayGrad = ctx.createLinearGradient(0, 0, 0, historyCanvas.height);
    relayGrad.addColorStop(0, "rgba(67, 160, 71, 0.28)");
    relayGrad.addColorStop(1, "rgba(67, 160, 71, 0.05)");

    gradients = { tempGrad, relayGrad };
  }

  const labels = points.map((p) => formatHistoryLabel(p.ts, range));
  const temps = points.map((p) => Number(p.temp ?? 0));
  const relay = points.map((p) => (p.relay === "on" ? 1 : 0));

  const data = {
    labels,
    datasets: [
      {
        label: "Temperatură (°C)",
        data: temps,
        borderColor: "#1976d2",
        backgroundColor: gradients.tempGrad,
        tension: 0.2,
        yAxisID: "yTemp",
        pointRadius: 0,
        // decimation dinamic: doar când există multe puncte
        decimation: {
          enabled: true,
          algorithm: "lttb",
          threshold: 4000
        }
      },
      {
        label: "Releu ON",
        data: relay,
        borderColor: "#43a047",
        backgroundColor: gradients.relayGrad,
        stepped: "middle",
        yAxisID: "yRelay",
        pointRadius: 0
      }
    ]
  };

  const options = {
    animation: false,
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { position: "bottom" },
      zoom: {
        zoom: {
          wheel: { enabled: true },
          pinch: { enabled: true, modifierKey: null },
          drag: { enabled: true, modifierKey: null },
          mode: "x"
        },
        pan: {
          enabled: true,
          mode: "x",
          modifierKey: null
        },
        limits: {
          x: { min: "original", max: "original" }
        }
      },
      tooltip: {
        callbacks: {
          label(ctx) {
            if (ctx.datasetIndex === 1) {
              return ctx.parsed.y === 1 ? "Releu: ON" : "Releu: OFF";
            }
            return `Temp: ${ctx.parsed.y.toFixed(1)} °C`;
          }
        }
      }
    },
    scales: {
      yTemp: {
        type: "linear",
        position: "left",
        title: { display: true, text: "Temperatură" },
        grid: { color: "rgba(0,0,0,0.04)" },
        ticks: { maxTicksLimit: 6 }
      },
      yRelay: {
        type: "linear",
        position: "right",
        min: -0.1,
        max: 1.1,
        ticks: {
          stepSize: 1,
          callback: (v) => (v === 1 ? "ON" : "OFF")
        },
        grid: { drawOnChartArea: false },
        title: { display: true, text: "Releu" }
      },
      x: {
        display: true,
        ticks: { maxTicksLimit: 8, color: "#333" },
        grid: { color: "rgba(0,0,0,0.03)" }
      }
    }
  };

  historyChart = new Chart(historyCanvas, {
    type: "line",
    data,
    options
  });
}

function renderWeeklyCandles(candles) {
  destroyHistoryChart();
  ensureZoomRegistered();

  const labels = candles.map((c) => c.day);
  const dataPoints = candles.map((c) => ({
    x: c.day,
    o: Number(c.avg ?? 0),
    h: Number(c.max ?? 0),
    l: Number(c.min ?? 0),
    c: Number(c.avg ?? 0)
  }));

  const data = {
    labels,
    datasets: [
      {
        label: "Temperatură zilnică",
        data: dataPoints,
        parsing: { xAxisKey: "x", yAxisKey: "c" },
        backgroundColor: "rgba(0,0,0,0)",
        borderColor: "rgba(0,0,0,0)",
        borderSkipped: false,
        barThickness: 14
      }
    ]
  };

  const options = {
    animation: false,
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { position: "bottom" },
      zoom: {
        zoom: {
          wheel: { enabled: true },
          pinch: { enabled: true, modifierKey: null },
          drag: { enabled: true, modifierKey: null },
          mode: "x"
        },
        pan: {
          enabled: true,
          mode: "x",
          modifierKey: null
        },
        limits: { x: { min: "original", max: "original" } }
      },
      tooltip: {
        callbacks: {
          label(ctx) {
            const v = ctx.raw;
            return `Min: ${v.l.toFixed(1)} °C • Max: ${v.h.toFixed(1)} °C • Medie: ${v.c.toFixed(1)} °C`;
          }
        }
      }
    },
    scales: {
      x: {
        ticks: { maxTicksLimit: 7 }
      },
      y: {
        title: { display: true, text: "°C" },
        grid: { color: "rgba(0,0,0,0.05)" }
      }
    }
  };

  const ctx = historyCanvas.getContext("2d");
  historyChart = new Chart(ctx, {
    type: "bar",
    data,
    options,
    plugins: [candlesOverlay]
  });
}

async function loadHistory(range = currentRange) {
  if (isLoadingHistory) return;
  isLoadingHistory = true;

  const incremental = range === "24h" && cachedPoints24h.length > 0 && lastHistoryTs > 0;
  if (!incremental) {
    historyInfo.textContent = "Se încarcă date...";
  }

  try {
    const params = new URLSearchParams({ token: TOKEN, range });
    if (incremental) params.set("since", String(lastHistoryTs));

    const res = await fetch(`${API_BASE}/api/history?${params.toString()}`);
    const data = await res.json();
    currentRange = data.range ?? range;

    if (currentRange === "7d" && data.candles) {
      renderWeeklyCandles(data.candles);
      const count = data.candles.length;
      historyInfo.textContent = count === 0
        ? "Nu există date pentru interval."
        : `Zile: ${count} • Interval: 7d (lumânări min/max/medie)`;
    } else {
      const incoming = data.points ?? [];
      const cutoff = data.cutoff ?? (Date.now() - 24 * 60 * 60 * 1000);

      if (incremental) {
        // doar puncte noi, evităm duplicate și curățăm ce e mai vechi decât cutoff
        const newOnes = incoming.filter((p) => Number(p.ts) > lastHistoryTs);
        cachedPoints24h = cachedPoints24h
          .concat(newOnes)
          .filter((p) => Number(p.ts) >= cutoff);
      } else {
        cachedPoints24h = incoming;
      }

      if (cachedPoints24h.length) {
        lastHistoryTs = Math.max(...cachedPoints24h.map((p) => Number(p.ts) || 0));
      }

      renderHistory(cachedPoints24h, "24h");
      historyInfo.textContent = cachedPoints24h.length === 0
        ? "Nu există date pentru intervalul selectat."
        : `Puncte: ${cachedPoints24h.length} • Interval: 24h (cache local + incremental)`;
    }

    rangeButtons.forEach((b) => {
      if (b.dataset.range === currentRange) b.classList.add("active");
      else b.classList.remove("active");
    });
  } catch (e) {
    console.error(e);
    historyInfo.textContent = "Eroare la încărcarea istoricului";
  }

  isLoadingHistory = false;
}

// ---------------- BUTTON ACTIONS ----------------
onBtn.addEventListener("click", () =>
  sendCommand(`${API_BASE}/api/relay?token=${TOKEN}&state=on`)
);

offBtn.addEventListener("click", () =>
  sendCommand(`${API_BASE}/api/relay?token=${TOKEN}&state=off`)
);

manualBtn.addEventListener("click", () =>
  sendCommand(`${API_BASE}/api/mode?token=${TOKEN}&value=manual`)
);

autoBtn.addEventListener("click", () =>
  sendCommand(`${API_BASE}/api/mode?token=${TOKEN}&value=auto`)
);

saveRangeBtn.addEventListener("click", () => {
  const min = parseFloat(minInput.value);
  const max = parseFloat(maxInput.value);
  if (!Number.isNaN(min) && !Number.isNaN(max)) {
    sendCommand(`${API_BASE}/api/auto-range?token=${TOKEN}&min=${min}&max=${max}`);
  }
});

if (resetZoomBtn) {
  resetZoomBtn.addEventListener("click", () => {
    if (historyChart) historyChart.resetZoom();
  });
}

rangeButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    const range = btn.dataset.range;
    rangeButtons.forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    if (range === "24h") {
      cachedPoints24h = [];
      lastHistoryTs = 0;
    }
    loadHistory(range);
  });
});

// ---------------- AUTO UPDATE ----------------

setInterval(() => updateData(false), 4000); // 🔥 anti-flood
setInterval(() => loadHistory(currentRange), 60000); // refresh rar pentru grafic (incremental pt 24h)

updateData(true); // prima încărcare
loadHistory(currentRange);
