import { CONFIG } from "./_config.js";

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

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const date = url.searchParams.get("date"); // YYYY-MM-DD

  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return Response.json({ error: "Parámetro 'date' inválido (usar YYYY-MM-DD)" }, { status: 400 });
  }

  const dayOfWeek = new Date(date + "T00:00:00").getDay();
  const hours = CONFIG.businessHours[dayOfWeek];

  if (!hours) {
    return Response.json({ date, slots: [] }); // cerrado ese día
  }

  const allSlots = generateSlots(hours.start, hours.end, CONFIG.slotDurationMinutes);

  // Traer los turnos ya ocupados ese día
  const { results } = await env.DB.prepare(
    "SELECT time FROM bookings WHERE date = ? AND status = 'confirmed'"
  ).bind(date).all();

  const taken = new Set(results.map((r) => r.time));
  const available = allSlots.filter((s) => !taken.has(s));

  return Response.json({ date, slots: available });
}
