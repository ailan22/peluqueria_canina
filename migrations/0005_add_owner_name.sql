-- Migración para bases ya existentes (schema.sql ya trae esta columna en instalaciones nuevas).
-- Ejecutar con: wrangler d1 execute db-turnos --remote --file=./migrations/0005_add_owner_name.sql

ALTER TABLE bookings ADD COLUMN owner_name TEXT;
