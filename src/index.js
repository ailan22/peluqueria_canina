import { CONFIG, getDaySlots } from "./config.js";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// ---------- Notificación por email ----------

async function sendEmail(env, { to, subject, html, attachments }) {
  console.log("sendEmail: iniciando", { to, tieneApiKey: !!env.RESEND_API_KEY });

  if (!env.RESEND_API_KEY) {
    console.log("sendEmail: falta RESEND_API_KEY, se omite el envío");
    return;
  }

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: env.FROM_EMAIL || "Reservas <onboarding@resend.dev>",
        to: [to],
        subject,
        html,
        ...(attachments && attachments.length ? { attachments } : {}),
      }),
    });

    const responseBody = await res.text();
    console.log("sendEmail: respuesta de Resend", { to, status: res.status, body: responseBody });
  } catch (err) {
    console.error("Error enviando email:", err.message || err);
  }
}

async function sendBookingNotification(env, booking, cancelUrl, attachments) {
  if (!env.OWNER_EMAIL) {
    console.log("sendBookingNotification: falta OWNER_EMAIL, se omite el envío");
    return;
  }

  const { name, email, phone, race, service, date, time } = booking;

  await sendEmail(env, {
    to: env.OWNER_EMAIL,
    subject: `Nueva reserva: ${date} ${time} - ${name}`,
    html: `
      <h2>Nueva reserva de turno</h2>
      <p><strong>Cliente:</strong> ${name}</p>
      <p><strong>Email:</strong> ${email || "-"}</p>
      <p><strong>Teléfono:</strong> ${phone || "-"}</p>
      <p><strong>Raza:</strong> ${race || "-"}</p>
      <p><strong>Servicio:</strong> ${service || "-"}</p>
      <p><strong>Fecha:</strong> ${date}</p>
      <p><strong>Hora:</strong> ${time}</p>
      <p>Si el cliente avisa que no puede asistir, podés cancelar el turno acá:</p>
      <p><a href="${cancelUrl}">${cancelUrl}</a></p>
    `,
    attachments,
  });
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}
// ---------- Disponibilidad ----------

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

  const allSlots = getDaySlots(hours, CONFIG.slotDurationMinutes);

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

const MAX_PHOTO_BYTES = 5 * 1024 * 1024; // 5MB

async function handleBook(request, env) {
  let formData;
  try {
    formData = await request.formData();
  } catch {
    return json({ error: "Formulario inválido" }, 400);
  }

  const name = formData.get("name");
  const email = formData.get("email");
  const phone = formData.get("phone");
  const race = formData.get("race");
  const service = formData.get("service");
  const date = formData.get("date");
  const time = formData.get("time");

  if (!name || name.trim().length < 2) return json({ error: "Nombre inválido" }, 400);
  if (email && !isValidEmail(email)) return json({ error: "Email inválido" }, 400);
  if (!phone || !/^\d+$/.test(phone)) return json({ error: "Teléfono inválido" }, 400);
  if (service && service.length > 1000) return json({ error: "Descripción del servicio demasiado larga" }, 400);
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
  if (!hours || !getDaySlots(hours).includes(time)) {
    return json({ error: "Horario fuera de atención" }, 400);
  }

  const photos = [];
  for (const field of ["photo1", "photo2"]) {
    const file = formData.get(field);
    if (file && typeof file === "object" && file.size > 0) {
      if (!file.type.startsWith("image/")) {
        return json({ error: "Las fotos deben ser imágenes" }, 400);
      }
      if (file.size > MAX_PHOTO_BYTES) {
        return json({ error: "Cada foto debe pesar menos de 5MB" }, 400);
      }
      photos.push(file);
    }
  }

  const cancelToken = crypto.randomUUID();

  try {
    await env.DB.prepare(
      `INSERT INTO bookings (name, email, phone, race, service, date, time, cancel_token)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(name.trim(), email?.trim() || "", phone.trim(), race?.trim() || null, service?.trim() || "", date, time, cancelToken).run();
  } catch (err) {
    if (String(err.message).includes("UNIQUE")) {
      return json({ error: "Ese horario ya fue reservado, elegí otro" }, 409);
    }
    return json({ error: "Error al guardar la reserva" }, 500);
  }

  const bookingData = { name: name.trim(), email: email?.trim() || "", phone: phone.trim(), race: race?.trim() || "", service: service?.trim() || "", date, time };
  const cancelUrl = `${new URL(request.url).origin}/cancelar/?token=${cancelToken}`;

  const attachments = [];
  for (let i = 0; i < photos.length; i++) {
    const buffer = await photos[i].arrayBuffer();
    attachments.push({
      filename: photos[i].name || `foto${i + 1}.jpg`,
      content: arrayBufferToBase64(buffer),
    });
  }

  // No bloqueamos la respuesta al cliente si el email tarda o falla.
  await sendBookingNotification(env, bookingData, cancelUrl, attachments);

  return json({ ok: true, message: "Reserva confirmada", date, time });
}

// ---------- Cancelación por parte del cliente ----------

async function handleCancelInfo(request, env) {
  const url = new URL(request.url);
  const token = url.searchParams.get("token");
  if (!token) return json({ error: "Falta token" }, 400);

  const booking = await env.DB.prepare(
    "SELECT service, date, time, status FROM bookings WHERE cancel_token = ?"
  ).bind(token).first();

  if (!booking) return json({ error: "Reserva no encontrada" }, 404);

  return json(booking);
}

async function handleCancel(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "JSON inválido" }, 400);
  }

  const { token } = body;
  if (!token) return json({ error: "Falta token" }, 400);

  const booking = await env.DB.prepare(
    "SELECT status FROM bookings WHERE cancel_token = ?"
  ).bind(token).first();

  if (!booking) return json({ error: "Reserva no encontrada" }, 404);
  if (booking.status === "cancelled") {
    return json({ error: "Esa reserva ya estaba cancelada" }, 409);
  }

  await env.DB.prepare(
    "UPDATE bookings SET status = 'cancelled' WHERE cancel_token = ?"
  ).bind(token).run();

  return json({ ok: true });
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

    if (pathname === "/api/cancel" && method === "GET") {
      return handleCancelInfo(request, env);
    }

    if (pathname === "/api/cancel" && method === "POST") {
      return handleCancel(request, env);
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
