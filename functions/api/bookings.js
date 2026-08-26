import { CONFIG } from "./_config.js";

function checkAuth(request, env) {
  const key = request.headers.get("x-admin-key");
  return key && key === env[CONFIG.adminKeyEnvVar];
}

// GET /api/bookings?from=YYYY-MM-DD&to=YYYY-MM-DD
export async function onRequestGet({ request, env }) {
  if (!checkAuth(request, env)) {
    return Response.json({ error: "No autorizado" }, { status: 401 });
  }

  const url = new URL(request.url);
  const from = url.searchParams.get("from") || "0000-01-01";
  const to = url.searchParams.get("to") || "9999-12-31";

  const { results } = await env.DB.prepare(
    `SELECT * FROM bookings WHERE date BETWEEN ? AND ? ORDER BY date, time`
  ).bind(from, to).all();

  return Response.json({ bookings: results });
}

// DELETE /api/bookings  body: { id }
export async function onRequestDelete({ request, env }) {
  if (!checkAuth(request, env)) {
    return Response.json({ error: "No autorizado" }, { status: 401 });
  }

  const { id } = await request.json();
  if (!id) return Response.json({ error: "Falta id" }, { status: 400 });

  await env.DB.prepare(
    `UPDATE bookings SET status = 'cancelled' WHERE id = ?`
  ).bind(id).run();

  return Response.json({ ok: true });
}
