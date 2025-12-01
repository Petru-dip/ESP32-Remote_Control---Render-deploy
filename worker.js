export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    const headers = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    // CORS preflight
    if (method === "OPTIONS") {
      return new Response(null, { status: 204, headers });
    }

    // --- /set = primește comanda de la site ---
    if (method === "POST" && path === "/set") {
      const body = await request.text();
      const cmd = body.trim();

      const allowed = ["on", "off", "blink", "fade"];
      if (!allowed.includes(cmd)) {
        return new Response("Invalid command", { status: 400, headers });
      }

      await env.BRAD_KV.put("CMD", cmd);
      return new Response("OK", { status: 200, headers });
    }

    // --- /cmd = ESP32 cere ultima comandă ---
    if (method === "GET" && path === "/cmd") {
      const cmd = (await env.BRAD_KV.get("CMD")) || "none";

      // Ștergem comanda după ce o dăm ESP-ului (opțional)
      if (cmd !== "none") {
        await env.BRAD_KV.delete("CMD");
      }

      return new Response(cmd, { status: 200, headers });
    }

    // --- /state = ESP raportează stare (POST) / UI citește ultima stare (GET) ---
    if (path === "/state") {
      // asigurăm tabelul
      await ensureStateTable(env.DB);

      if (method === "POST") {
        try {
          const body = await request.json();
          const rawMode = (body.mode || "unknown").toString().trim();
          const mode = rawMode === "" ? "unknown" : rawMode;
          const hasIntensity = Number.isFinite(Number(body.intensity));
          const intensity = hasIntensity
            ? Math.max(0, Math.min(255, Math.floor(Number(body.intensity))))
            : null;
          const ts = Date.now();

          await env.DB.prepare(
            "INSERT INTO state (mode, intensity, updated_at) VALUES (?, ?, ?)"
          )
            .bind(mode, intensity, ts)
            .run();

          return json({ ok: true, mode, intensity, updated_at: ts }, headers);
        } catch (err) {
          return new Response("Bad JSON", { status: 400, headers });
        }
      }

      if (method === "GET") {
        const row = await env.DB.prepare(
          "SELECT mode, intensity, updated_at FROM state ORDER BY updated_at DESC LIMIT 1"
        ).first();

        const payload = row || {
          mode: "unknown",
          intensity: null,
          updated_at: null,
        };
        return json(payload, headers);
      }
    }

    // --- Healthcheck ---
    if (method === "GET" && path === "/ping") {
      return new Response("pong", { status: 200, headers });
    }

    return new Response("Not found", { status: 404, headers });
  }
};

function json(obj, headers) {
  return new Response(JSON.stringify(obj), {
    status: 200,
    headers: { ...headers, "Content-Type": "application/json" },
  });
}

async function ensureStateTable(db) {
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS state (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        mode TEXT,
        intensity INTEGER,
        updated_at INTEGER
      )`
    )
    .run();
}
