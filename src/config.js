// Configuración del negocio. Ajustá esto a tu caso.

export const CONFIG = {
  // Horario de atención por día de la semana (0 = domingo ... 6 = sábado)
  businessHours: {
    1: { start: "09:00", end: "18:00" }, // lunes
    2: { start: "09:00", end: "18:00" }, // martes
    3: { start: "09:00", end: "18:00" }, // miércoles
    4: { start: "09:00", end: "18:00" }, // jueves
    5: { start: "09:00", end: "18:00" }, // viernes
    6: { start: "09:00", end: "13:00" }, // sábado
    // 0 (domingo) no existe = cerrado
  },
  slotDurationMinutes: 30,
  services: ["Corte", "Coloración", "Consulta"],
  // Cuántos días para adelante se puede reservar
  maxDaysAhead: 30,
  // Clave simple para proteger el endpoint de administración.
  // Configurala como secret real en producción (ver README).
  adminKeyEnvVar: "ADMIN_KEY",
};
