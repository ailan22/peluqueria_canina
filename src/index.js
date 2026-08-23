import { CONFIG } from "./config.js";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// ---------- Notificación por email ----------

async function sendBookingNotification(env, booking) {
  if (!env.RESEND_API_KEY || !env.OWNER_EMAIL) return; // no configurado, se omite silenciosamente

  const { name, email, phone, service, date, time } = booking;

  try {
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "Reservas <onboarding@resend.dev>",
        to: [env.OWNER_EMAIL],
        subject: `Nueva reserva: ${date} ${time} - ${name}`,
        html: `
          <h2>Nueva reserva de turno</h2>
          <p><strong>Cliente:</strong> ${name}</p>
          <p><strong>Email:</strong> ${email}</p>
          <p><strong>Teléfono:</strong> ${phone || "-"}</p>
          <p><strong>Servicio:</strong> ${service}</p>
          <p><strong>Fecha:</strong> ${date}</p>
          <p><strong>Hora:</strong> ${time}</p>
        `,
      }),
    });
  } catch (err) {
    // Si falla el email, no queremos que falle la reserva ya guardada.
    console.error("Error enviando email de notificación:", err);
  }
}

// ---------- Disponibilidad ----------

function generateSlots(start, end, durationMin) {
  const slots = [];
  let [h, m] = start.split(":").map(Number);
  const [endH, endM] = end.split(":").map(Number);
  while (h < endH || (h === endH && m < endM)) {
    slots.push(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
    m += durationMin;
    if (m >= 60) {
      h += Math.floor(m / 60);
      m = m % 60;
    }
  }
  return slots;
}

async function handleAvailability(request, env) {
  const url = new URL(request.url);
  const date = url.searchParams.get("date");

  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return json({ error: "Parámetro 'date' inválido (usar YYYY-MM-DD)" }, 400);
  }

  const dayOfWeek = new Date(date + "T00:00:00").getDay();
  const hours = CONFIG.businessHours[dayOfWeek];

  if (!hours) {
    return json({ date, slots: [] });
  }

  const allSlots = generateSlots(hours.start, hours.end, CONFIG.slotDurationMinutes);

  const { results } = await env.DB.prepare(
    "SELECT time FROM bookings WHERE date = ? AND status = 'confirmed'"
  ).bind(date).all();

  const taken = new Set(results.map((r) => r.time));
  const available = allSlots.filter((s) => !taken.has(s));

  return json({ date, slots: available });
}

// ---------- Crear reserva ----------

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

async function handleBook(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "JSON inválido" }, 400);
  }

  const { name, email, phone, service, date, time } = body;

  if (!name || name.trim().length < 2) return json({ error: "Nombre inválido" }, 400);
  if (!email || !isValidEmail(email)) return json({ error: "Email inválido" }, 400);
  if (!CONFIG.services.includes(service)) return json({ error: "Servicio inválido" }, 400);
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return json({ error: "Fecha inválida" }, 400);
  if (!time || !/^\d{2}:\d{2}$/.test(time)) return json({ error: "Hora inválida" }, 400);

  const requestedDateTime = new Date(`${date}T${time}:00`);
  if (requestedDateTime < new Date()) {
    return json({ error: "No se puede reservar en el pasado" }, 400);
  }

  const maxDate = new Date();
  maxDate.setDate(maxDate.getDate() + CONFIG.maxDaysAhead);
  if (requestedDateTime > maxDate) {
    return json({ error: "Fecha fuera del rango permitido" }, 400);
  }

  const dayOfWeek = requestedDateTime.getDay();
  const hours = CONFIG.businessHours[dayOfWeek];
  if (!hours || time < hours.start || time >= hours.end) {
    return json({ error: "Horario fuera de atención" }, 400);
  }

  try {
    await env.DB.prepare(
      `INSERT INTO bookings (name, email, phone, service, date, time)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).bind(name.trim(), email.trim(), phone?.trim() || null, service, date, time).run();
  } catch (err) {
    if (String(err.message).includes("UNIQUE")) {
      return json({ error: "Ese horario ya fue reservado, elegí otro" }, 409);
    }
    return json({ error: "Error al guardar la reserva" }, 500);
  }

  // No bloqueamos la respuesta al cliente si el email tarda o falla.
  await sendBookingNotification(env, { name: name.trim(), email: email.trim(), phone, service, date, time });

  return json({ ok: true, message: "Reserva confirmada", date, time });
}

// ---------- Administración ----------

function checkAuth(request, env) {
  const key = request.headers.get("x-admin-key");
  return key && key === env[CONFIG.adminKeyEnvVar];
}

async function handleBookingsList(request, env) {
  if (!checkAuth(request, env)) return json({ error: "No autorizado" }, 401);

  const url = new URL(request.url);
  const from = url.searchParams.get("from") || "0000-01-01";
  const to = url.searchParams.get("to") || "9999-12-31";

  const { results } = await env.DB.prepare(
    `SELECT * FROM bookings WHERE date BETWEEN ? AND ? ORDER BY date, time`
  ).bind(from, to).all();

  return json({ bookings: results });
}

async function handleBookingsDelete(request, env) {
  if (!checkAuth(request, env)) return json({ error: "No autorizado" }, 401);

  const { id } = await request.json();
  if (!id) return json({ error: "Falta id" }, 400);

  await env.DB.prepare(`UPDATE bookings SET status = 'cancelled' WHERE id = ?`).bind(id).run();

  return json({ ok: true });
}

// ---------- Router ----------

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const { pathname } = url;
    const method = request.method;

    if (pathname === "/api/availability" && method === "GET") {
      return handleAvailability(request, env);
    }

    if (pathname === "/api/book" && method === "POST") {
      return handleBook(request, env);
    }

    if (pathname === "/api/bookings" && method === "GET") {
      return handleBookingsList(request, env);
    }

    if (pathname === "/api/bookings" && method === "DELETE") {
      return handleBookingsDelete(request, env);
    }

    // Cualquier otra ruta bajo /api/* que no matchee: 404 JSON
    if (pathname.startsWith("/api/")) {
      return json({ error: "Ruta no encontrada" }, 404);
    }

    // No debería llegar acá si run_worker_first está bien configurado
    // (todo lo que no es /api/* se sirve directo como asset estático),
    // pero como fallback de seguridad servimos los assets igual.
    return env.ASSETS.fetch(request);
  },
};
