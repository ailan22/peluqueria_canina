# Sistema de reservas de turnos — Hugo + Cloudflare Workers (Static Assets) + D1

Nota: este proyecto usa el modelo actual de **Workers con Static Assets**, no el Pages clásico. Es lo que Cloudflare configura por defecto hoy en día. La diferencia principal: la lógica de la API no vive en una carpeta `functions/` con routing automático (eso es exclusivo de Pages) — acá hay un **Worker script real** (`src/index.js`) que actúa de router para `/api/*`, y todo lo demás se sirve directo como archivo estático sin pasar por el Worker.

## 1. Copiar los archivos a tu proyecto Hugo

Copiá estas carpetas/archivos a la raíz de tu repo (donde ya tenés `hugo.toml`):

```
src/                   -> raíz del repo (Worker script + config del negocio)
layouts/partials/booking-form.html
static/js/booking.js
static/css/booking.css
schema.sql             -> raíz del repo
wrangler.jsonc          -> raíz del repo
```

Importante: nada de esto va dentro del theme (`themes/tu-theme/...`) ni dentro de `public/` (esa carpeta la genera Hugo en cada build, no se toca a mano).

## 2. Crear la base de datos D1

Necesitás tener `wrangler` instalado (`npm install -g wrangler`) y estar logueado (`wrangler login`).

```bash
wrangler d1 create db-turnos
```

Esto te va a dar un `database_id`. El binding se configura desde el dashboard:

1. Ve a **Workers & Pages > tu proyecto > Settings > Bindings**
2. Agregá un binding tipo **D1 database**:
   - Variable name: `DB`
   - D1 database: `db-turnos`

## 3. Aplicar el esquema

```bash
wrangler d1 execute db-turnos --remote --file=./schema.sql
```

(Usá `--local` primero si querés probar en tu máquina con `wrangler pages dev`.)

## 4. Configurar la clave de administrador (opcional pero recomendado)

Para poder consultar `/api/bookings`, agregá una variable de entorno secreta:

- Dashboard > tu proyecto > Settings > Environment variables > Add variable
  - Name: `ADMIN_KEY`
  - Value: una clave larga y random
  - Marcarla como "Encrypt" / secreta

Luego para consultar reservas:
```bash
curl -H "x-admin-key: TU_CLAVE" \
  "https://tusitio.com/api/bookings?from=2026-08-01&to=2026-08-31"
```

## 5. Insertar el formulario en una página de Hugo

En cualquier `.md` o layout donde quieras el formulario:

```
{{ partial "booking-form.html" . }}
```

Y agregá el CSS en tu `<head>` (por ejemplo en tu layout base):

```html
<link rel="stylesheet" href="/css/booking.css">
```

## 6. Ajustar horarios y servicios

Todo lo relacionado al negocio (horario de atención, duración de los turnos, lista de servicios, cuántos días para adelante se puede reservar) está centralizado en:

```
src/config.js
```

Si cambiás la lista de `services` ahí, actualizá también las `<option>` en `layouts/partials/booking-form.html`.

## 7. Probar localmente

```bash
hugo                          # genera /public
npx wrangler pages dev public --d1=DB=db-turnos
```

## 8. Deploy

Si ya tenés el repo conectado a Cloudflare Pages vía Git, con hacer push alcanza — Cloudflare corre el build de Hugo y despliega las Functions automáticamente.

---

## Cómo funciona (resumen)

- `GET /api/availability?date=YYYY-MM-DD` → devuelve los horarios libres de ese día, calculados a partir del horario laboral (`_config.js`) menos lo que ya está reservado en D1.
- `POST /api/book` → valida los datos, chequea que el horario esté dentro de lo permitido, y hace un `INSERT` en D1. Un índice único en `(date, time)` evita que dos personas reserven el mismo turno aunque se manden al mismo tiempo (condición de carrera).
- `GET/DELETE /api/bookings` → panel simple de administración, protegido por una clave (`ADMIN_KEY`), para listar o cancelar turnos. Podés armarle una página propia después si querés algo más visual, o simplemente consultarlo con `curl`/Postman por ahora.

## Límites del plan FREE a tener en cuenta

- 100.000 requests/día en Pages Functions — de sobra para un negocio chico/mediano.
- D1: 5 GB de almacenamiento, 5M filas leídas/día, 100.000 filas escritas/día — cada reserva es 1 fila escrita, así que soporta miles de turnos/día sin problema.
- Si en algún momento agregás envío de emails de confirmación, usá un servicio externo (Resend, MailChannels) ya que Cloudflare no tiene SMTP propio gratis integrado.

## Próximos pasos posibles

- Enviar email de confirmación al reservar (Resend tiene un free tier generoso).
- Cancelación por parte del cliente vía link único con token.
- Panel de administración visual en vez de curl/Postman.
- Reglas de anticipación mínima (ej: no reservar con menos de 2 horas de anticipación).
