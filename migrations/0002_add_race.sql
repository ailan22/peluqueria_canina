-- Migración para bases ya existentes (schema.sql ya trae esta columna en instalaciones nuevas).
-- Ejecutar con: wrangler d1 execute db-turnos --remote --file=./migrations/0002_add_race.sql

ALTER TABLE bookings ADD COLUMN race TEXT;
