# Goldilocks UI

Standalone frontend for [Goldilocks](https://github.com/FairwindsOps/goldilocks) — displays VPA resource recommendations per namespace.

Built with [Astro](https://astro.build) and [Bun](https://bun.sh), served by nginx.

## Prerequisites

- [Bun](https://bun.sh) v1.0+
- A running Goldilocks backend (for API data)

## Development

```bash
bun install
bun run dev
```

The dev server starts at `http://localhost:4321`. It proxies `/api/` requests to the backend defined in `astro.config.mjs` (default: `http://localhost:8081`).

> To point at a different backend during dev, set `GOLDILOCKS_API_URL`:
> ```bash
> GOLDILOCKS_API_URL=http://my-cluster:8081 bun run dev
> ```

## Commands

| Command           | Description                          |
|-------------------|--------------------------------------|
| `bun install`     | Install dependencies                 |
| `bun run dev`     | Start local dev server (port 4321)   |
| `bun run build`   | Build static output to `dist/`       |
| `bun run preview` | Preview the production build locally |

## Docker

Build and run the container locally (from repo root):

```bash
docker build -f ui/Dockerfile -t goldilocks-ui .
docker run -p 8080:8080 -e GOLDILOCKS_API_URL=http://host.docker.internal:8081 goldilocks-ui
```

Or use Docker Compose (also starts a local Goldilocks backend):

```bash
docker compose -f ui/docker-compose.yml up
```

The UI is available at `http://localhost:8080`.

## Project structure

```
src/
  components/
    Sidebar.astro     namespace navigation
    Topbar.astro      filter input and refresh button
  layouts/
    Layout.astro      HTML shell
  pages/
    index.astro       root page, composes components
  scripts/
    app.ts            client-side logic (API fetching, rendering, state)
  styles/
    global.css        global styles and CSS variables
ui/
  Dockerfile          multi-stage: bun build → nginx-unprivileged
  nginx.conf          nginx config template (GOLDILOCKS_API_URL injected at start)
  entrypoint.sh       injects GOLDILOCKS_API_URL into nginx config at container start
  docker-compose.yml  local dev stack
```

## Environment variables

| Variable              | Default                 | Description                        |
|-----------------------|-------------------------|------------------------------------|
| `GOLDILOCKS_API_URL`  | `http://localhost:8081` | Goldilocks backend base URL (container runtime) |
