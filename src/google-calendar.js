// Integración con Google Calendar usando una cuenta de servicio.
//
// Se configura con:
//  - GOOGLE_SERVICE_ACCOUNT (secret): el JSON completo de la clave de la cuenta de servicio.
//  - GOOGLE_CALENDAR_ID (var): el calendario donde se crean los eventos (ej: el gmail de la dueña).
//    Ese calendario tiene que estar compartido con el client_email de la cuenta de servicio
//    con permiso "Hacer cambios en eventos".
//
// Si falta alguno, las funciones no hacen nada: la reserva funciona igual sin calendario.

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/calendar.events";

// El token dura 1 hora; lo reusamos mientras la instancia del Worker siga viva.
let cachedToken = null;

function isConfigured(env) {
  return !!(env.GOOGLE_SERVICE_ACCOUNT && env.GOOGLE_CALENDAR_ID);
}

function base64Url(input) {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : new Uint8Array(input);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function importPrivateKey(pem) {
  const body = pem.replace(/-----[^-]+-----/g, "").replace(/\s/g, "");
  const der = Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
  return crypto.subtle.importKey(
    "pkcs8",
    der,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );
}

async function getAccessToken(env) {
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && cachedToken.expiresAt - 60 > now) return cachedToken.value;

  const account = JSON.parse(env.GOOGLE_SERVICE_ACCOUNT);
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64Url(JSON.stringify({
    iss: account.client_email,
    scope: SCOPE,
    aud: TOKEN_URL,
    iat: now,
    exp: now + 3600,
  }));
  const unsigned = `${header}.${claims}`;
  const key = await importPrivateKey(account.private_key);
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned));

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${unsigned}.${base64Url(signature)}`,
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Google token: ${res.status} ${JSON.stringify(data)}`);

  cachedToken = { value: data.access_token, expiresAt: now + data.expires_in };
  return cachedToken.value;
}

function eventsUrl(env, eventId = "") {
  const calendar = encodeURIComponent(env.GOOGLE_CALENDAR_ID);
  return `https://www.googleapis.com/calendar/v3/calendars/${calendar}/events${eventId ? `/${encodeURIComponent(eventId)}` : ""}`;
}

// Crea el evento y devuelve su id (o null si no está configurado o falló).
export async function createCalendarEvent(env, event) {
  if (!isConfigured(env)) {
    console.log("createCalendarEvent: falta configurar Google Calendar, se omite");
    return null;
  }

  try {
    const token = await getAccessToken(env);
    const res = await fetch(eventsUrl(env), {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(event),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(`${res.status} ${JSON.stringify(data)}`);
    return data.id;
  } catch (err) {
    console.error("createCalendarEvent: error", err.message || err);
    return null;
  }
}

export async function deleteCalendarEvent(env, eventId) {
  if (!eventId || !isConfigured(env)) return;

  try {
    const token = await getAccessToken(env);
    const res = await fetch(eventsUrl(env, eventId), {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    // 410 = ya estaba borrado (por ejemplo, la dueña lo borró a mano desde el calendario).
    if (!res.ok && res.status !== 410 && res.status !== 404) {
      throw new Error(`${res.status} ${await res.text()}`);
    }
  } catch (err) {
    console.error("deleteCalendarEvent: error", err.message || err);
  }
}
