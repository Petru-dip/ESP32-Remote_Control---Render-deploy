const WORKER_SET_URL = "https://nume-worker.tau.workers.dev/set";

async function sendCmd(cmd) {
  const status = document.getElementById("status");
  status.textContent = "Trimit comanda...";

  try {
    const res = await fetch(WORKER_SET_URL, {
      method: "POST",
      body: cmd
    });

    if (res.ok) {
      status.textContent = `Comandă trimisă: ${cmd}`;
    } else {
      status.textContent = "Eroare la trimitere.";
    }
  } catch (e) {
    console.error(e);
    status.textContent = "Nu pot contacta serverul.";
  }
}
