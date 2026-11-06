-- Migración para bases ya existentes (schema.sql ya trae esta columna en instalaciones nuevas).
-- Ejecutar con: wrangler d1 execute db-turnos --remote --file=./migrations/0006_add_google_event_id.sql

ALTER TABLE bookings ADD COLUMN google_event_id TEXT;
