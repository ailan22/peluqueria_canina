#!/usr/bin/env bash
# Genera el sitio y lo sube al ambiente DEV de Cloudflare.
# Uso: ./deploy-dev.sh
set -euo pipefail
cd "$(dirname "$0")"

URL="https://peluqueria-canina-dev.ailanquinteroh.workers.dev/"

rm -rf dev-build
# El build (hugo -d dev-build) lo corre wrangler, ver env.dev en wrangler.jsonc
npx wrangler deploy --env dev

echo
echo "Listo: $URL (si ves la versión anterior, esperá unos segundos y recargá)"
