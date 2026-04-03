#!/bin/sh
set -eu

cat > /usr/share/nginx/html/env.js <<EOF
window.__PORTA_RUNTIME_ENV = {
  API_URL: "${API_URL:-}",
  WEB_URL: "${WEB_URL:-}"
};
EOF
