-- Esquema para el sistema de reservas de turnos
-- Ejecutar con: wrangler d1 execute DB_TURNOS --file=./schema.sql

CREATE TABLE IF NOT EXISTS bookings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  service TEXT NOT NULL,
  date TEXT NOT NULL,        -- formato YYYY-MM-DD
  time TEXT NOT NULL,        -- formato HH:MM (24h)
  status TEXT NOT NULL DEFAULT 'confirmed', -- confirmed | cancelled
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Evita que se pueda reservar dos veces el mismo día+hora
CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_slot
  ON bookings (date, time)
  WHERE status = 'confirmed';

CREATE INDEX IF NOT EXISTS idx_date ON bookings (date);
