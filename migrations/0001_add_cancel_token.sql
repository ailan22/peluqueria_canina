-- Migración para bases ya existentes (schema.sql ya trae esta columna en instalaciones nuevas).
-- Ejecutar con: wrangler d1 execute db-turnos --remote --file=./migrations/0001_add_cancel_token.sql

ALTER TABLE bookings ADD COLUMN cancel_token TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_cancel_token ON bookings (cancel_token);
