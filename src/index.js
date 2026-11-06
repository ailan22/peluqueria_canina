import { CONFIG, getDaySlots } from "./config.js";
import { createCalendarEvent, deleteCalendarEvent } from "./google-calendar.js";
import { handleWhatsAppVerify, handleWhatsAppWebhook } from "./whatsapp.js";

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

// ---------- Teléfonos ----------

// Convierte el teléfono del formulario (ej: 091234567) al formato internacional
// de WhatsApp (ej: 59891234567). Lo usa el bot de WhatsApp. Asume números de
// Uruguay salvo que ya vengan con el 598 adelante.
function toWhatsAppNumber(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  if (!digits) return null;
  if (digits.startsWith("598")) return digits;
  return `598${digits.replace(/^0+/, "")}`;
}

async function sendBookingNotification(env, booking, cancelUrl, attachments) {
  if (!env.OWNER_EMAIL) {
    console.log("sendBookingNotification: falta OWNER_EMAIL, se omite el envío");
    return;
  }

  const { ownerName, name, phone, race, pickupMethod, service, notes, date, time } = booking;
  const pickupMethodLabel =
    pickupMethod === "retiro_domicilio" ? "Solicita retiro a domicilio" : "La lleva personalmente";

  await sendEmail(env, {
    to: env.OWNER_EMAIL,
    subject: `Nueva reserva: ${date} ${time} - ${name}`,
    html: `
      <h2>Nueva reserva de turno</h2>
      <p><strong>Nombre de la persona:</strong> ${ownerName || "-"}</p>
      <p><strong>Mascota:</strong> ${name}</p>
      <p><strong>Teléfono:</strong> ${phone || "-"}</p>
      <p><strong>Raza:</strong> ${race || "-"}</p>      
      <p><strong>Servicio:</strong> ${service || "-"}</p>
      <p><strong>Sobre la mascota:</strong> ${notes || "-"}</p>
      <p><strong>Fecha:</strong> ${date}</p>
      <p><strong>Hora:</strong> ${time}</p>
      <p><strong>¿Cómo llega la mascota?:</strong> ${pickupMethodLabel}</p>
      <p>Si el cliente avisa que no puede asistir, podés cancelar el turno acá:</p>
      <p>
        <a href="${cancelUrl}" style="display:inline-block;background:#c81e1e;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:bold;">
          Cancelar reserva
        </a>
      </p>
    `,
    attachments,
  });
}

// ---------- Google Calendar ----------

function buildCalendarEvent(booking) {
  const { ownerName, name, phone, race, pickupMethod, service, notes, date, time } = booking;
  const start = new Date(`${date}T${time}:00${ARGENTINA_UTC_OFFSET}`);
  const end = new Date(start.getTime() + CONFIG.slotDurationMinutes * 60 * 1000);
  const pickupMethodLabel =
    pickupMethod === "retiro_domicilio" ? "Solicita retiro a domicilio" : "La lleva personalmente";

  const description = [
    `Persona: ${ownerName || "-"}`,
    `Teléfono: ${phone || "-"}`,
    `Raza: ${race || "-"}`,
    `Servicio: ${service || "-"}`,
    `¿Cómo llega?: ${pickupMethodLabel}`,
    `Sobre la mascota: ${notes || "-"}`,
  ].join("\n");

  return {
    summary: `🐶 ${name} (${ownerName})`,
    description,
    start: { dateTime: start.toISOString() },
    end: { dateTime: end.toISOString() },
  };
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
// ---------- Zona horaria ----------

// Argentina usa UTC-3 fijo (sin horario de verano). El Worker corre en UTC,
// así que centralizamos acá la conversión para no repetir el offset a mano.
const ARGENTINA_UTC_OFFSET = "-03:00";

// Date cuyos getters UTC (getUTCHours, toISOString, etc.) reflejan la hora
// de pared en Argentina, sin depender de la zona horaria del runtime.
function nowInArgentina() {
  return new Date(Date.now() - 3 * 60 * 60 * 1000);
}

// ---------- Disponibilidad ----------

function todayInArgentina() {
  return nowInArgentina().toISOString().slice(0, 10);
}

// Horarios libres de un día (YYYY-MM-DD). La usan la web y el bot de WhatsApp.
async function getAvailableSlots(env, date) {
  const slots = await getSlotsStatus(env, date);
  return slots.filter((s) => s.available).map((s) => s.time);
}

// Todos los horarios del día con su estado:
//  - status "free": libre y se puede reservar online.
//  - status "busy": ya reservado.
//  - status "past": ya pasó (solo pasa si la fecha es hoy).
//  - status "soon": libre, pero empieza en menos de CONFIG.minNoticeMinutes; no se
//    reserva online (la web le sugiere al cliente consultar por WhatsApp).
// Ej: [{ time: "09:30", available: true, status: "free" }, ...]
async function getSlotsStatus(env, date) {
  const dayOfWeek = new Date(date + "T00:00:00Z").getUTCDay();
  const hours = CONFIG.businessHours[dayOfWeek];

  if (!hours) return [];

  const allSlots = getDaySlots(hours, CONFIG.slotDurationMinutes);

  const { results } = await env.DB.prepare(
    "SELECT time FROM bookings WHERE date = ? AND status = 'confirmed'"
  ).bind(date).all();

  const taken = new Set(results.map((r) => r.time));
  const now = new Date();
  const minStart = new Date(now.getTime() + CONFIG.minNoticeMinutes * 60 * 1000);

  return allSlots.map((time) => {
    if (taken.has(time)) return { time, available: false, status: "busy" };
    const start = new Date(`${date}T${time}:00${ARGENTINA_UTC_OFFSET}`);
    if (start <= now) return { time, available: false, status: "past" };
    if (start < minStart) return { time, available: false, status: "soon" };
    return { time, available: true, status: "free" };
  });
}

async function handleAvailability(request, env) {
  const url = new URL(request.url);
  const date = url.searchParams.get("date");

  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return json({ error: "Parámetro 'date' inválido (usar YYYY-MM-DD)" }, 400);
  }

  const allSlots = await getSlotsStatus(env, date);
  return json({
    date,
    slots: allSlots.filter((s) => s.available).map((s) => s.time),
    allSlots,
  });
}

// ---------- Crear reserva ----------

const MAX_PHOTO_BYTES = 5 * 1024 * 1024; // 5MB

// Valida y guarda una reserva, avisa por email y la agenda en Google Calendar.
// La usan el formulario web y el bot de WhatsApp. Devuelve { ok: true } o { error, status }.
async function createBooking(env, origin, fields, attachments = []) {
  const { ownerName, name, phone, race, pickupMethod, service, notes, date, time } = fields;

  if (!ownerName || ownerName.trim().length < 2) return { error: "Nombre de la persona inválido", status: 400 };
  if (!name || name.trim().length < 2) return { error: "Nombre inválido", status: 400 };
  if (!phone || !/^\d+$/.test(phone)) return { error: "Teléfono inválido", status: 400 };
  if (!["retiro_domicilio", "la_llevo"].includes(pickupMethod)) {
    return { error: "Indicá cómo llegará tu mascota", status: 400 };
  }
  if (service && service.length > 1000) return { error: "Descripción del servicio demasiado larga", status: 400 };
  if (notes && notes.length > 1000) return { error: "El comentario sobre la mascota es demasiado largo", status: 400 };
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: "Fecha inválida", status: 400 };
  if (!time || !/^\d{2}:\d{2}$/.test(time)) return { error: "Hora inválida", status: 400 };

  // Se fija el offset de Argentina explícitamente: el Worker corre en UTC,
  // así que sin esto una hora local cercana a "ahora" se leía como ya pasada.
  const requestedDateTime = new Date(`${date}T${time}:00${ARGENTINA_UTC_OFFSET}`);
  if (requestedDateTime < new Date()) {
    return { error: "No se puede reservar en el pasado", status: 400 };
  }
  if (requestedDateTime < new Date(Date.now() + CONFIG.minNoticeMinutes * 60 * 1000)) {
    return {
      error: "Falta menos de 1 hora para ese turno, no se puede reservar online. Escribinos por WhatsApp y te confirmamos si está libre",
      status: 400,
    };
  }

  const maxDate = new Date();
  maxDate.setDate(maxDate.getDate() + CONFIG.maxDaysAhead);
  if (requestedDateTime > maxDate) {
    return { error: "Fecha fuera del rango permitido", status: 400 };
  }

  const dayOfWeek = new Date(date + "T00:00:00Z").getUTCDay();
  const hours = CONFIG.businessHours[dayOfWeek];
  if (!hours || !getDaySlots(hours).includes(time)) {
    return { error: "Horario fuera de atención", status: 400 };
  }

  const cancelToken = crypto.randomUUID();

  try {
    await env.DB.prepare(
      `INSERT INTO bookings (owner_name, name, email, phone, race, pickup_method, service, notes, date, time, cancel_token)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(ownerName.trim(), name.trim() || "", "", phone.trim(), race?.trim() || null, pickupMethod, service?.trim() || "", notes?.trim() || null, date, time, cancelToken).run();
  } catch (err) {
    if (String(err.message).includes("UNIQUE")) {
      return { error: "Ese horario ya fue reservado, elegí otro", status: 409 };
    }
    return { error: "Error al guardar la reserva", status: 500 };
  }

  const bookingData = { ownerName: ownerName.trim(), name: name.trim(), phone: phone.trim(), race: race?.trim() || "", pickupMethod, service: service?.trim() || "", notes: notes?.trim() || "", date, time };
  const cancelUrl = `${origin}/cancelar/?token=${cancelToken}`;

  // No bloqueamos la respuesta al cliente si el email tarda o falla.
  await sendBookingNotification(env, bookingData, cancelUrl, attachments);

  const eventId = await createCalendarEvent(env, buildCalendarEvent(bookingData));
  if (eventId) {
    await env.DB.prepare("UPDATE bookings SET google_event_id = ? WHERE cancel_token = ?")
      .bind(eventId, cancelToken).run();
  }

  return { ok: true };
}

async function handleBook(request, env) {
  let formData;
  try {
    formData = await request.formData();
  } catch {
    return json({ error: "Formulario inválido" }, 400);
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

  const attachments = [];
  for (let i = 0; i < photos.length; i++) {
    const buffer = await photos[i].arrayBuffer();
    attachments.push({
      filename: photos[i].name || `foto${i + 1}.jpg`,
      content: arrayBufferToBase64(buffer),
    });
  }

  const date = formData.get("date");
  const time = formData.get("time");
  const result = await createBooking(env, new URL(request.url).origin, {
    ownerName: formData.get("owner_name"),
    name: formData.get("name"),
    phone: formData.get("phone"),
    race: formData.get("race"),
    pickupMethod: formData.get("pickup_method"),
    // Los checkboxes mandan un "service" por cada uno marcado; se guardan juntos como texto.
    service: formData.getAll("service").map((s) => String(s).trim()).filter(Boolean).join(", "),
    notes: formData.get("notes"),
    date,
    time,
  }, attachments);

  if (result.error) return json({ error: result.error }, result.status);
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
    "SELECT status, google_event_id FROM bookings WHERE cancel_token = ?"
  ).bind(token).first();

  if (!booking) return json({ error: "Reserva no encontrada" }, 404);
  if (booking.status === "cancelled") {
    return json({ error: "Esa reserva ya estaba cancelada" }, 409);
  }

  await env.DB.prepare(
    "UPDATE bookings SET status = 'cancelled' WHERE cancel_token = ?"
  ).bind(token).run();

  await deleteCalendarEvent(env, booking.google_event_id);

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

// Agenda de un día para la dueña: todos los horarios de atención, con los datos
// del cliente en los que están reservados.
async function handleAgenda(request, env) {
  if (!checkAuth(request, env)) return json({ error: "No autorizado" }, 401);

  const url = new URL(request.url);
  const date = url.searchParams.get("date");
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return json({ error: "Parámetro 'date' inválido (usar YYYY-MM-DD)" }, 400);
  }

  const dayOfWeek = new Date(date + "T00:00:00Z").getUTCDay();
  const daySlots = getDaySlots(CONFIG.businessHours[dayOfWeek]);

  const { results } = await env.DB.prepare(
    `SELECT owner_name, name, phone, race, pickup_method, service, notes, time
     FROM bookings WHERE date = ? AND status = 'confirmed'`
  ).bind(date).all();

  const byTime = new Map(results.map((b) => [b.time, b]));
  // Incluimos también reservas en horarios que ya no están en la config.
  const times = [...new Set([...daySlots, ...byTime.keys()])].sort();

  const slots = times.map((time) => {
    const b = byTime.get(time);
    if (!b) return { time, booked: false };
    return {
      time,
      booked: true,
      ownerName: b.owner_name,
      name: b.name,
      phone: b.phone,
      race: b.race,
      pickupMethod: b.pickup_method,
      service: b.service,
      notes: b.notes,
    };
  });

  return json({ date, open: daySlots.length > 0, slots });
}

async function handleBookingsDelete(request, env) {
  if (!checkAuth(request, env)) return json({ error: "No autorizado" }, 401);

  const { id } = await request.json();
  if (!id) return json({ error: "Falta id" }, 400);

  const booking = await env.DB.prepare("SELECT google_event_id FROM bookings WHERE id = ?").bind(id).first();
  await env.DB.prepare(`UPDATE bookings SET status = 'cancelled' WHERE id = ?`).bind(id).run();
  await deleteCalendarEvent(env, booking?.google_event_id);

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

    if (pathname === "/api/agenda" && method === "GET") {
      return handleAgenda(request, env);
    }

    if (pathname === "/api/cancel" && method === "GET") {
      return handleCancelInfo(request, env);
    }

    if (pathname === "/api/cancel" && method === "POST") {
      return handleCancel(request, env);
    }

    // Bot de WhatsApp (webhook de Meta). Solo responde si WHATSAPP_TOKEN está
    // configurado, hoy únicamente en el ambiente DEV.
    if (pathname === "/api/whatsapp" && env.WHATSAPP_TOKEN) {
      if (method === "GET") return handleWhatsAppVerify(request, env);
      if (method === "POST") {
        return handleWhatsAppWebhook(request, env, ctx, {
          getAvailableSlots,
          createBooking,
          todayInArgentina,
          toWhatsAppNumber,
        });
      }
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
