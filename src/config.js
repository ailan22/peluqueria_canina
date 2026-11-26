// Configuración del negocio. Ajustá esto a tu caso.

export const CONFIG = {
  // Horario de atención por día de la semana (0 = domingo ... 6 = sábado)
  //
  // Cada día admite dos formatos:
  //  - { start: "09:00", end: "18:00" }  → genera turnos automáticamente
  //    cada `slotDurationMinutes` minutos entre start y end.
  //  - { slots: ["09:30", "11:00", "12:30", "13:30", "14:00", "14:30", "15:00", "15:30", "16:00"] } → usa exactamente
  //    esos horarios, ignorando slotDurationMinutes.
  businessHours: {
    1: { slots: ["09:30", "10:30", "11:00", "11:30", "12:30", "13:30", "14:00", "14:30", "15:00", "15:30", "16:00"] }, // lunes
    2: { slots: ["09:30", "10:30", "11:00", "11:30", "12:30", "13:30", "14:00", "14:30", "15:00", "15:30", "16:00"] }, // martes
    3: { slots: ["09:30", "10:30", "11:00", "11:30", "12:30", "13:30", "14:00", "14:30", "15:00", "15:30", "16:00"] }, // miércoles
    4: { slots: ["09:30", "10:30", "11:00", "11:30", "12:30", "13:30", "14:00", "14:30", "15:00", "15:30", "16:00"] }, // jueves
    5: { slots: ["09:30", "10:30", "11:00", "11:30", "12:30", "13:30", "14:00", "14:30", "15:00", "15:30", "16:00"] }, // viernes
    6: { slots: ["09:30", "10:00", "11:00", "11:30", "12:30", "13:30", "14:00", "14:30", "15:00", "15:30", "16:00"] }, // sábado
    // 0 (domingo) no existe = cerrado
  },
  slotDurationMinutes: 30,
  services: ["Corte", "Coloración", "Consulta"],
  // Cuántos días para adelante se puede reservar
  maxDaysAhead: 30,
  // Además de los `maxDaysAhead`, se puede reservar como mínimo hasta esta fecha
  // (YYYY-MM-DD). Sirve para abrir la agenda de un mes entero (ej: diciembre).
  bookableUntil: "2026-12-31",
  // Feriados: esos días no se atiende y no se puede reservar (YYYY-MM-DD → nombre).
  holidays: {
    "2026-12-25": "Navidad",
    "2027-01-01": "Año Nuevo",
  },
  // Anticipación mínima para reservar por la web. Los horarios libres que empiezan
  // antes de esto no se pueden reservar online (el cliente tiene que consultar por WhatsApp).
  minNoticeMinutes: 60,
  // Clave simple para proteger el endpoint de administración.
  // Configurala como secret real en producción (ver README).
  adminKeyEnvVar: "ADMIN_KEY",
};

// Nombre del feriado si la fecha (YYYY-MM-DD) es feriado, o null.
export function getHoliday(date) {
  return CONFIG.holidays[date] || null;
}

// Última fecha reservable (YYYY-MM-DD): la mayor entre hoy + maxDaysAhead y
// `bookableUntil`. `today` es la fecha de hoy en Argentina (YYYY-MM-DD).
export function getMaxBookingDate(today) {
  const d = new Date(today + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + CONFIG.maxDaysAhead);
  const byDays = d.toISOString().slice(0, 10);
  return CONFIG.bookableUntil && CONFIG.bookableUntil > byDays ? CONFIG.bookableUntil : byDays;
}

// Devuelve la lista de horarios disponibles para un día, ya sea que esté
// definido con start/end (auto-generado) o con una lista fija de `slots`.
export function getDaySlots(hours, slotDurationMinutes = CONFIG.slotDurationMinutes) {
  if (!hours) return [];
  if (Array.isArray(hours.slots)) {
    return [...hours.slots].sort();
  }

  const slots = [];
  let [h, m] = hours.start.split(":").map(Number);
  const [endH, endM] = hours.end.split(":").map(Number);
  while (h < endH || (h === endH && m < endM)) {
    slots.push(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
    m += slotDurationMinutes;
    if (m >= 60) {
      h += Math.floor(m / 60);
      m = m % 60;
    }
  }
  return slots;
}
