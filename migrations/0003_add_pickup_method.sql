-- Migración para bases ya existentes (schema.sql ya trae esta columna en instalaciones nuevas).
-- Ejecutar con: wrangler d1 execute db-turnos --remote --file=./migrations/0003_add_pickup_method.sql

ALTER TABLE bookings ADD COLUMN pickup_method TEXT NOT NULL DEFAULT 'la_llevo';
