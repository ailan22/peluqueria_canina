-- Conversaciones en curso del bot de WhatsApp (ver src/whatsapp.js).
-- Ejecutar con: wrangler d1 execute db-turnos-dev --env dev --remote --file=./migrations/0007_add_whatsapp_sessions.sql

CREATE TABLE IF NOT EXISTS whatsapp_sessions (
  phone TEXT PRIMARY KEY,    -- número del cliente en formato internacional (ej: 59891234567)
  step TEXT NOT NULL,        -- en qué paso de la conversación está
  data TEXT NOT NULL DEFAULT '{}', -- JSON con lo que fue respondiendo
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
