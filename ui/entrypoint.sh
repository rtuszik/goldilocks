#!/bin/sh
# This script runs as part of the nginx /docker-entrypoint.d/ sequence,
# before nginx starts. It injects GOLDILOCKS_API_URL into the nginx config.
set -e

: "${GOLDILOCKS_API_URL:=http://localhost:8081}"

echo "[goldilocks-ui] API backend: ${GOLDILOCKS_API_URL}"

sed "s|__GOLDILOCKS_API_URL__|${GOLDILOCKS_API_URL}|g" \
    /etc/nginx/conf.d/default.conf.template \
    > /etc/nginx/conf.d/default.conf
