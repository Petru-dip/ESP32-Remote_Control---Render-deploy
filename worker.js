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

    // --- Healthcheck ---
    if (method === "GET" && path === "/ping") {
      return new Response("pong", { status: 200, headers });
    }

    return new Response("Not found", { status: 404, headers });
  }
};
