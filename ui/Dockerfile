# Goldilocks standalone UI container
#
# Build from the repo root:
#   docker build -f ui/Dockerfile -t goldilocks-ui .
#
# Run:
#   docker run -p 8080:8080 -e GOLDILOCKS_API_URL=http://goldilocks:8081 goldilocks-ui

FROM oven/bun:1-alpine AS build
WORKDIR /app
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile
COPY . .
RUN bun run build

FROM nginxinc/nginx-unprivileged:1.27-alpine

USER root

COPY ui/nginx.conf /etc/nginx/conf.d/default.conf.template
COPY --chmod=755 ui/entrypoint.sh /docker-entrypoint.d/40-goldilocks.sh
COPY --from=build /app/dist /usr/share/nginx/html

USER nginx

EXPOSE 8080
