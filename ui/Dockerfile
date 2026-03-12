# Goldilocks standalone UI container
#
# Build from the repo root:
#   docker build -f ui/Dockerfile -t goldilocks-ui .
#
# Run:
#   docker run -p 8080:8080 -e GOLDILOCKS_API_URL=http://goldilocks:8081 goldilocks-ui

FROM nginxinc/nginx-unprivileged:1.27-alpine

# Nginx config template — __GOLDILOCKS_API_URL__ is replaced at container start
COPY ui/nginx.conf /etc/nginx/conf.d/default.conf.template

# Startup script: runs before nginx starts, injects GOLDILOCKS_API_URL into the nginx config
COPY ui/entrypoint.sh /docker-entrypoint.d/40-goldilocks.sh
RUN chmod +x /docker-entrypoint.d/40-goldilocks.sh

# Process the SPA: replace the Go-template placeholder with "/" since nginx
# handles all routing — the SPA uses relative API paths (/api/...) which
# nginx proxies to the goldilocks backend.
COPY pkg/dashboard/assets/v2/index.html /tmp/index.tpl
RUN sed 's|{{BASE_PATH}}|/|g' /tmp/index.tpl > /usr/share/nginx/html/index.html \
    && rm /tmp/index.tpl

EXPOSE 8080
