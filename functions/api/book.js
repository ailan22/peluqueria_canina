import { CONFIG } from "./_config.js";

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export async function onRequestPost({ request, env }) {
  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "JSON inválido" }, { status: 400 });
  }

  const { name, email, phone, service, date, time } = body;

  // Validaciones básicas
  if (!name || name.trim().length < 2) {
    return Response.json({ error: "Nombre inválido" }, { status: 400 });
  }
  if (!email || !isValidEmail(email)) {
    return Response.json({ error: "Email inválido" }, { status: 400 });
  }
  if (!CONFIG.services.includes(service)) {
    return Response.json({ error: "Servicio inválido" }, { status: 400 });
  }
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return Response.json({ error: "Fecha inválida" }, { status: 400 });
  }
  if (!time || !/^\d{2}:\d{2}$/.test(time)) {
    return Response.json({ error: "Hora inválida" }, { status: 400 });
  }

  // No permitir reservar en el pasado
  const requestedDateTime = new Date(`${date}T${time}:00`);
  if (requestedDateTime < new Date()) {
    return Response.json({ error: "No se puede reservar en el pasado" }, { status: 400 });
  }

  // No permitir reservar más allá del límite configurado
  const maxDate = new Date();
  maxDate.setDate(maxDate.getDate() + CONFIG.maxDaysAhead);
  if (requestedDateTime > maxDate) {
    return Response.json({ error: "Fecha fuera del rango permitido" }, { status: 400 });
  }

  // Verificar que el horario esté dentro del horario laboral de ese día
  const dayOfWeek = requestedDateTime.getDay();
  const hours = CONFIG.businessHours[dayOfWeek];
  if (!hours || time < hours.start || time >= hours.end) {
    return Response.json({ error: "Horario fuera de atención" }, { status: 400 });
  }

  try {
    await env.DB.prepare(
      `INSERT INTO bookings (name, email, phone, service, date, time)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).bind(name.trim(), email.trim(), phone?.trim() || null, service, date, time).run();
  } catch (err) {
    // El índice UNIQUE salta si el horario ya fue tomado (carrera entre 2 usuarios)
    if (String(err.message).includes("UNIQUE")) {
      return Response.json({ error: "Ese horario ya fue reservado, elegí otro" }, { status: 409 });
    }
    return Response.json({ error: "Error al guardar la reserva" }, { status: 500 });
  }

  // Opcional: enviar email de confirmación (ver README para integrar Resend/MailChannels)

  return Response.json({ ok: true, message: "Reserva confirmada", date, time });
}
