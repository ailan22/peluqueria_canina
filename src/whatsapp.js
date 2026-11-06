// Bot de reservas por WhatsApp (WhatsApp Cloud API de Meta).
//
// Se configura con (por ahora solo en el ambiente DEV, ver wrangler.jsonc):
//  - WHATSAPP_TOKEN (secret): token de acceso de la app de Meta.
//  - WHATSAPP_VERIFY_TOKEN (secret): texto que se pega en "Verify token" al configurar el webhook.
//  - WHATSAPP_APP_SECRET (secret, opcional): "App secret" de la app, para validar la firma
//    de los mensajes que llegan. Sin esto se aceptan sin validar (solo aceptable en DEV).
//  - WHATSAPP_PHONE_NUMBER_ID (var): id del número que envía los mensajes.
//
// El webhook es /api/whatsapp. La conversación de cada cliente se guarda en la tabla
// whatsapp_sessions (migrations/0007_add_whatsapp_sessions.sql) y vence a los 30 minutos.

import { CONFIG } from "./config.js";
import { deleteCalendarEvent } from "./google-calendar.js";

const GRAPH_API_VERSION = "v23.0";
const SESSION_MINUTES = 30;
const DAY_NAMES = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
// Palabras que en cualquier momento vuelven al menú principal.
const MENU_WORDS = ["hola", "menu", "menú", "inicio", "salir", "volver"];

// ---------- Verificación del webhook (GET que hace Meta al configurarlo) ----------

export function handleWhatsAppVerify(request, env) {
  const url = new URL(request.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");

  if (mode === "subscribe" && env.WHATSAPP_VERIFY_TOKEN && token === env.WHATSAPP_VERIFY_TOKEN) {
    return new Response(challenge, { status: 200 });
  }
  return new Response("Forbidden", { status: 403 });
}

// ---------- Mensajes entrantes ----------

async function isValidSignature(env, request, rawBody) {
  if (!env.WHATSAPP_APP_SECRET) {
    console.log("whatsapp: falta WHATSAPP_APP_SECRET, no se valida la firma");
    return true;
  }
  const header = request.headers.get("x-hub-signature-256") || "";
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(env.WHATSAPP_APP_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
  const expected = "sha256=" + [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return header === expected;
}

// `api` trae las funciones de index.js que comparte con el formulario web
// (getAvailableSlots, createBooking, todayInArgentina, toWhatsAppNumber).
export async function handleWhatsAppWebhook(request, env, ctx, api) {
  const rawBody = await request.text();
  if (!(await isValidSignature(env, request, rawBody))) {
    return new Response("Firma inválida", { status: 401 });
  }

  let body;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return new Response("JSON inválido", { status: 400 });
  }

  const values = (body.entry || []).flatMap((e) => e.changes || []).map((c) => c.value || {});

  // Avisos de Meta sobre los mensajes que mandó el bot (enviado, entregado, leído o fallido).
  for (const status of values.flatMap((v) => v.statuses || [])) {
    if (status.status === "failed") {
      console.error("whatsapp: no se pudo entregar el mensaje", JSON.stringify({ to: status.recipient_id, errors: status.errors }));
    } else {
      console.log("whatsapp: estado del mensaje", { to: status.recipient_id, status: status.status });
    }
  }

  // Meta reintenta si no respondemos rápido, así que procesamos en segundo plano.
  const messages = values.flatMap((v) => v.messages || []);

  for (const message of messages) {
    ctx.waitUntil(
      handleMessage(env, new URL(request.url).origin, message, api).catch((err) =>
        console.error("whatsapp: error procesando mensaje", err.message || err)
      )
    );
  }

  return new Response("OK", { status: 200 });
}

// Lo que mandó el cliente: el id del botón/fila elegido, o el texto escrito.
function readInput(message) {
  if (message.type === "interactive") {
    const reply = message.interactive.button_reply || message.interactive.list_reply;
    return { choice: reply?.id || null, text: reply?.title || "" };
  }
  if (message.type === "text") {
    return { choice: null, text: message.text.body.trim() };
  }
  return { choice: null, text: "" };
}

// ---------- Sesiones ----------

async function loadSession(env, phone) {
  const row = await env.DB.prepare(
    `SELECT step, data FROM whatsapp_sessions
     WHERE phone = ? AND updated_at > datetime('now', ?)`
  ).bind(phone, `-${SESSION_MINUTES} minutes`).first();
  return row ? { step: row.step, data: JSON.parse(row.data) } : { step: "menu", data: {} };
}

async function saveSession(env, phone, step, data) {
  await env.DB.prepare(
    `INSERT INTO whatsapp_sessions (phone, step, data, updated_at) VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT(phone) DO UPDATE SET step = excluded.step, data = excluded.data, updated_at = excluded.updated_at`
  ).bind(phone, step, JSON.stringify(data)).run();
}

// ---------- Envío ----------

async function send(env, to, payload) {
  const res = await fetch(
    `https://graph.facebook.com/${GRAPH_API_VERSION}/${env.WHATSAPP_PHONE_NUMBER_ID}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.WHATSAPP_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ messaging_product: "whatsapp", to, ...payload }),
    }
  );
  if (!res.ok) {
    console.error("whatsapp: error enviando mensaje", { to, status: res.status, body: await res.text() });
  }
}

function sendText(env, to, body) {
  return send(env, to, { type: "text", text: { body } });
}

// Hasta 3 botones, títulos de hasta 20 caracteres.
function sendButtons(env, to, body, buttons) {
  return send(env, to, {
    type: "interactive",
    interactive: {
      type: "button",
      body: { text: body },
      action: {
        buttons: buttons.map((b) => ({ type: "reply", reply: { id: b.id, title: b.title } })),
      },
    },
  });
}

// Hasta 10 filas, títulos de hasta 24 caracteres.
function sendList(env, to, body, buttonText, rows) {
  return send(env, to, {
    type: "interactive",
    interactive: {
      type: "list",
      body: { text: body },
      action: { button: buttonText, sections: [{ title: "Opciones", rows }] },
    },
  });
}

// ---------- Formato ----------

// "2026-10-31" -> "Sáb 31/10"
function formatDay(date) {
  const [, month, day] = date.split("-");
  return `${DAY_NAMES[new Date(date + "T00:00:00Z").getUTCDay()]} ${day}/${month}`;
}

function addDays(date, days) {
  const d = new Date(date + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function pickupLabel(pickupMethod) {
  return pickupMethod === "retiro_domicilio" ? "Retiro a domicilio" : "La llevás vos";
}

// ---------- Pasos de la conversación ----------

function showMenu(env, phone) {
  return sendButtons(env, phone, "¡Hola! 🐶 Soy el asistente de la peluquería. ¿Qué querés hacer?", [
    { id: "menu:book", title: "Reservar turno" },
    { id: "menu:mine", title: "Mis turnos" },
  ]);
}

async function showDates(env, phone, api) {
  const today = api.todayInArgentina();
  const rows = [];
  for (let i = 0; i <= CONFIG.maxDaysAhead && rows.length < 10; i++) {
    const date = addDays(today, i);
    const slots = await api.getAvailableSlots(env, date);
    if (slots.length) {
      rows.push({
        id: `date:${date}`,
        title: formatDay(date),
        description: `${slots.length} horario${slots.length === 1 ? "" : "s"} libre${slots.length === 1 ? "" : "s"}`,
      });
    }
  }

  if (!rows.length) {
    await sendText(env, phone, "Por ahora no hay turnos libres 😔. Probá de nuevo en unos días.");
    return false;
  }
  await sendList(env, phone, "📅 ¿Qué día te queda bien?", "Ver días", rows);
  return true;
}

async function showTimes(env, phone, date, api) {
  const slots = await api.getAvailableSlots(env, date);
  if (!slots.length) {
    await sendText(env, phone, `Ya no quedan horarios libres el ${formatDay(date)}. Elegí otro día.`);
    return false;
  }
  await sendList(
    env,
    phone,
    `🕐 Horarios libres el ${formatDay(date)}:`,
    "Ver horarios",
    slots.slice(0, 10).map((time) => ({ id: `time:${time}`, title: time }))
  );
  return true;
}

function showSummary(env, phone, data) {
  const lines = [
    "Revisá que esté todo bien:",
    "",
    `👤 ${data.ownerName}`,
    `🐶 ${data.name}${data.race ? ` (${data.race})` : ""}`,
    `✂️ ${data.service}`,
    `📅 ${formatDay(data.date)} a las ${data.time}`,
    `🚗 ${pickupLabel(data.pickupMethod)}`,
  ];
  if (data.notes) lines.push(`📝 ${data.notes}`);
  return sendButtons(env, phone, lines.join("\n"), [
    { id: "confirm:yes", title: "Confirmar" },
    { id: "confirm:no", title: "Cancelar" },
  ]);
}

// Turnos futuros confirmados de este número. El formulario web guarda el teléfono
// como lo escribe la persona (ej: 091234567), así que comparamos normalizado.
async function findUpcomingBookings(env, phone, api) {
  const { results } = await env.DB.prepare(
    `SELECT id, name, date, time, phone FROM bookings
     WHERE status = 'confirmed' AND date >= ? ORDER BY date, time`
  ).bind(api.todayInArgentina()).all();
  return results.filter((b) => api.toWhatsAppNumber(b.phone) === phone);
}

async function handleMessage(env, origin, message, api) {
  const phone = message.from;
  const { choice, text } = readInput(message);
  const session = await loadSession(env, phone);
  const data = session.data;

  // Meta puede mandar el mismo mensaje más de una vez.
  if (data.lastMessageId === message.id) return;
  data.lastMessageId = message.id;

  const go = (step) => saveSession(env, phone, step, data);
  const reset = async () => {
    await saveSession(env, phone, "menu", { lastMessageId: message.id });
    await showMenu(env, phone);
  };

  if (!choice && MENU_WORDS.includes(text.toLowerCase())) return reset();

  switch (session.step) {
    case "menu": {
      if (choice === "menu:book") {
        await go("owner_name");
        return sendText(env, phone, "¡Genial! ¿Cuál es tu nombre?");
      }
      if (choice === "menu:mine") {
        const bookings = await findUpcomingBookings(env, phone, api);
        if (!bookings.length) {
          await sendText(env, phone, "No encontré turnos reservados con este número.");
          return showMenu(env, phone);
        }
        await go("mine");
        return sendList(
          env,
          phone,
          "Estos son tus próximos turnos. Si querés cancelar uno, elegilo:",
          "Ver turnos",
          bookings.slice(0, 10).map((b) => ({
            id: `cancel:${b.id}`,
            title: `${formatDay(b.date)} ${b.time}`,
            description: b.name,
          }))
        );
      }
      return showMenu(env, phone);
    }

    case "owner_name": {
      if (text.length < 2 || text.length > 80) return sendText(env, phone, "Escribí tu nombre, por favor.");
      data.ownerName = text;
      await go("name");
      return sendText(env, phone, `Gracias ${text}. ¿Cómo se llama tu mascota?`);
    }

    case "name": {
      if (text.length < 2 || text.length > 80) return sendText(env, phone, "Escribí el nombre de tu mascota, por favor.");
      data.name = text;
      await go("race");
      return sendButtons(env, phone, `¿De qué raza es ${text}?`, [{ id: "race:none", title: "No sé / mestizo" }]);
    }

    case "race": {
      if (choice === "race:none") data.race = "";
      else if (text && text.length <= 80) data.race = text;
      else return sendText(env, phone, "Escribí la raza, o tocá \"No sé / mestizo\".");
      await go("service");
      return sendText(env, phone, "¿Qué servicio necesita? (ej: baño y corte, solo baño, corte de uñas)");
    }

    case "service": {
      if (!text || text.length > 1000) return sendText(env, phone, "Contame qué servicio necesita.");
      data.service = text;
      await go("notes");
      return sendButtons(env, phone, `¿Hay algo que debamos saber sobre ${data.name}? (si es nervioso, alergias, etc.) Escribilo o tocá "Nada".`, [
        { id: "notes:none", title: "Nada" },
      ]);
    }

    case "notes": {
      if (choice === "notes:none") data.notes = "";
      else if (text && text.length <= 1000) data.notes = text;
      else return sendText(env, phone, "Escribí el comentario, o tocá \"Nada\".");
      await go("pickup");
      return sendButtons(env, phone, `¿Cómo llega ${data.name}?`, [
        { id: "pickup:la_llevo", title: "La llevo yo" },
        { id: "pickup:retiro_domicilio", title: "Retiro a domicilio" },
      ]);
    }

    case "pickup": {
      if (!choice?.startsWith("pickup:")) return sendText(env, phone, "Elegí una de las opciones de arriba 👆");
      data.pickupMethod = choice.slice("pickup:".length);
      await go("date");
      if (!(await showDates(env, phone, api))) return reset();
      return;
    }

    case "date": {
      if (!choice?.startsWith("date:")) return showDates(env, phone, api);
      data.date = choice.slice("date:".length);
      if (!(await showTimes(env, phone, data.date, api))) return showDates(env, phone, api);
      return go("time");
    }

    case "time": {
      if (!choice?.startsWith("time:")) return showTimes(env, phone, data.date, api);
      data.time = choice.slice("time:".length);
      await go("confirm");
      return showSummary(env, phone, data);
    }

    case "confirm": {
      if (choice === "confirm:no") {
        await sendText(env, phone, "Listo, no reservé nada.");
        return reset();
      }
      if (choice !== "confirm:yes") return showSummary(env, phone, data);

      const result = await api.createBooking(env, origin, { ...data, phone });
      if (result.error) {
        await sendText(env, phone, `No pude reservar: ${result.error}.`);
        if (result.status === 409 || result.status === 400) {
          await go("date");
          return showDates(env, phone, api);
        }
        return reset();
      }

      await saveSession(env, phone, "menu", { lastMessageId: message.id });
      return sendText(
        env,
        phone,
        `✅ ¡Turno reservado! Te esperamos con ${data.name} el ${formatDay(data.date)} a las ${data.time}.\n\nSi necesitás cancelar, escribí "hola" y elegí "Mis turnos".`
      );
    }

    case "mine": {
      if (!choice?.startsWith("cancel:")) return reset();
      data.cancelId = Number(choice.slice("cancel:".length));
      await go("cancel_confirm");
      return sendButtons(env, phone, `¿Seguro que querés cancelar el turno del ${text}?`, [
        { id: "cancel:yes", title: "Sí, cancelar" },
        { id: "cancel:no", title: "No" },
      ]);
    }

    case "cancel_confirm": {
      if (choice !== "cancel:yes") return reset();

      // Volvemos a chequear que el turno sea de este número antes de cancelarlo.
      const bookings = await findUpcomingBookings(env, phone, api);
      if (!bookings.some((b) => b.id === data.cancelId)) {
        await sendText(env, phone, "No encontré ese turno.");
        return reset();
      }

      const booking = await env.DB.prepare("SELECT google_event_id FROM bookings WHERE id = ?")
        .bind(data.cancelId).first();
      await env.DB.prepare("UPDATE bookings SET status = 'cancelled' WHERE id = ?").bind(data.cancelId).run();
      await deleteCalendarEvent(env, booking?.google_event_id);

      await saveSession(env, phone, "menu", { lastMessageId: message.id });
      return sendText(env, phone, "Turno cancelado. ¡Cuando quieras reservás de nuevo escribiendo \"hola\"! 🐾");
    }

    default:
      return reset();
  }
}
