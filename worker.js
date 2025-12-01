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

    if (method === "OPTIONS") {
      return new Response(null, { status: 204, headers });
    }

    // asigurăm tabelele
    await ensureTables(env.DB);

    // ---------------- /set (UI → comanda imediată) ----------------
    if (path === "/set" && method === "POST") {
      const cmd = (await request.text()).trim();
      if (!cmd || cmd.length < 3) {
        return new Response("Invalid CMD", { status: 400, headers });
      }

      // salvăm în KV ca „următoarea comandă” pentru ESP
      await env.BRAD_KV.put("CMD", cmd);

      // salvăm și în DB ca istoric de comenzi
      await env.DB.prepare(
        "INSERT INTO commands (command_text, created_at) VALUES (?, ?)"
      ).bind(cmd, Date.now()).run();

      return new Response("OK", { status: 200, headers });
    }

    // ---------------- /cmd (ESP → cere comandă) ----------------
    if (path === "/cmd" && method === "GET") {
      // 1. vezi dacă există comandă manuală în KV
      const cmdKV = (await env.BRAD_KV.get("CMD")) || "none";

      if (cmdKV !== "none") {
        await env.BRAD_KV.delete("CMD");
        return new Response(cmdKV, { status: 200, headers });
      }

      // 2. nu avem nimic în KV → verificăm programările din DB
      const now = Date.now();
      const schedRow = await env.DB.prepare(
        `SELECT id, command_text 
         FROM schedule
         WHERE run_at <= ? AND executed_at IS NULL
         ORDER BY run_at ASC
         LIMIT 1`
      ).bind(now).first();

      if (schedRow && schedRow.id) {
        // marcăm programarea ca executată
        await env.DB.prepare(
          "UPDATE schedule SET executed_at = ? WHERE id = ?"
        ).bind(now, schedRow.id).run();

        return new Response(schedRow.command_text, { status: 200, headers });
      }

      // 3. nimic de trimis
      return new Response("none", { status: 200, headers });
    }

    // ---------------- /state (ESP → POST, UI → GET) ----------------
    if (path === "/state" && method === "POST") {
      try {
        const body = await request.json();

        const led1_mode = cleanString(body.led1_mode, "off");
        const led2_mode = cleanString(body.led2_mode, "off");
        const program   = cleanString(body.program, "none");

        const led1_intensity = clampInt(body.led1_intensity);
        const led2_intensity = clampInt(body.led2_intensity);

        const ts = Date.now();

        await env.DB.prepare(
          `INSERT INTO state 
            (led1_mode, led1_intensity, led2_mode, led2_intensity, program, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)`
        )
          .bind(
            led1_mode,
            led1_intensity,
            led2_mode,
            led2_intensity,
            program,
            ts
          )
          .run();

        return json(
          {
            ok: true,
            led1_mode,
            led1_intensity,
            led2_mode,
            led2_intensity,
            program,
            updated_at: ts,
          },
          headers
        );
      } catch (e) {
        return new Response("Bad JSON", { status: 400, headers });
      }
    }

    if (path === "/state" && method === "GET") {
      const row = await env.DB.prepare(
        `SELECT led1_mode, led1_intensity,
                led2_mode, led2_intensity,
                program, updated_at
         FROM state
         ORDER BY updated_at DESC
         LIMIT 1`
      ).first();

      const payload =
        row ||
        {
          led1_mode: "unknown",
          led1_intensity: null,
          led2_mode: "unknown",
          led2_intensity: null,
          program: "none",
          updated_at: null,
        };

      return json(payload, headers);
    }

    // ---------------- /history (UI → timeline & statistici) ----------------
    if (path === "/history" && method === "GET") {
      // poți limita numărul cu un query param ?limit=200
      const limit = parseInt(url.searchParams.get("limit") || "200", 10);
      const safeLimit = isNaN(limit) ? 200 : Math.min(Math.max(limit, 10), 1000);

      const rows = await env.DB.prepare(
        `SELECT led1_mode, led1_intensity,
                led2_mode, led2_intensity,
                program, updated_at
         FROM state
         ORDER BY updated_at DESC
         LIMIT ?`
      ).bind(safeLimit).all();

      return json(rows.results || [], headers);
    }

    // ---------------- /schedule (POST) – creează programări ----------------
    // Body JSON:
    // { items: [ { run_at: 1735660800000, cmd: "L1:blink:255;L2:fade:128;P:none", label: "Party step 1" }, ...] }
    if (path === "/schedule" && method === "POST") {
      try {
        const body = await request.json();
        const items = Array.isArray(body.items) ? body.items : [];
        const now = Date.now();

        if (!items.length) {
          return new Response("No items", { status: 400, headers });
        }

        const stmt = await env.DB.prepare(
          `INSERT INTO schedule (command_text, run_at, created_at, label)
           VALUES (?, ?, ?, ?)`
        );

        for (const it of items) {
          const cmd = cleanString(it.cmd, "");
          const runAt = Number(it.run_at);
          const label = cleanString(it.label, "");

          if (!cmd || !Number.isFinite(runAt)) continue;

          await stmt.bind(cmd, runAt, now, label).run();
        }

        return new Response("OK", { status: 200, headers });
      } catch (e) {
        return new Response("Bad JSON", { status: 400, headers });
      }
    }

    // ---------------- /schedule/list – vezi programările ----------------
    if (path === "/schedule/list" && method === "GET") {
      const rows = await env.DB.prepare(
        `SELECT id, command_text, run_at, created_at, executed_at, label
         FROM schedule
         ORDER BY run_at ASC
         LIMIT 200`
      ).all();

      return json(rows.results || [], headers);
    }

    // ---------------- /ping ----------------
    if (path === "/ping" && method === "GET") {
      return new Response("pong", { status: 200, headers });
    }

    return new Response("Not found", { status: 404, headers });
  },
};

function json(obj, headers) {
  return new Response(JSON.stringify(obj), {
    status: 200,
    headers: { ...headers, "Content-Type": "application/json" },
  });
}

async function ensureTables(db) {
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS commands (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        command_text TEXT,
        created_at INTEGER
      )`
    )
    .run();

  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS state (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        led1_mode TEXT,
        led1_intensity INTEGER,
        led2_mode TEXT,
        program TEXT,
        program TEXT,
        updated_at INTEGER
      )`
    )
    .run()
    .catch(async () => {
      // fallback dacă există deja fără coloana program (în caz de upgrade)
      await db
        .prepare(
          "ALTER TABLE state ADD COLUMN program TEXT DEFAULT 'none'"
        )
        .run()
        .catch(() => {});
    });

  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS schedule (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        command_text TEXT,
        run_at INTEGER,
        created_at INTEGER,
        executed_at INTEGER,
        label TEXT
      )`
    )
    .run();
}

function cleanString(str, fallback) {
  if (str === undefined || str === null) return fallback;
  const s = String(str).trim();
  return s.length === 0 ? fallback : s;
}

function clampInt(val) {
  const num = Number(val);
  if (!Number.isFinite(num)) return 0;
  return Math.max(0, Math.min(255, Math.floor(num)));
}
