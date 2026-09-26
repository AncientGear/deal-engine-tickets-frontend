# Ticket admin UI

## Local development with Docker Compose

From the parent directory containing `compose.yaml`, export the required values in the shell where you will run Compose (or place them in a local, ignored `.env`). Use a URL-safe (letters/digits) PostgreSQL password and a random token secret of at least 32 characters. Do not commit credentials. Compose enables one-time administrator registration only for local development; its web port is bound to loopback. Never expose this setup flow to the public Internet.

```sh
export POSTGRES_PASSWORD='your-url-safe-password'
export TOKEN_SECRET='paste-random-secret-of-at-least-32-characters-here'
docker compose up
```

Open http://localhost:5173 and create the first administrator with a password of 12–72 characters. Registration closes after the first account is saved. Compose waits for PostgreSQL's healthcheck before starting the Go API, then starts Vite after the API container starts. Container startup does not guarantee API readiness; check `/readyz` for readiness, and retry the UI if the API is still starting. The UI's `/api` requests are proxied internally to `api:8080`. The database is not exposed to the host. Stop with `docker compose down` (data remains in the named PostgreSQL volume). The `backend/001_tickets.sql` and `backend/002_admin.sql` initialization scripts run only when the database volume is first created. For an existing local volume, apply the second migration without deleting data: `docker compose exec -T db psql -U de -d de < backend/002_admin.sql`. Changing init scripts does not migrate an existing volume. Removing the volume with `docker compose down -v` permanently destroys local data; back up anything needed first.

## Without Compose

Requires Node.js 18+. Run `npm install`, then `npm run dev`; Vite proxies `/api` to `http://127.0.0.1:8080` by default. Start the backend separately. Set `VITE_API_PROXY_TARGET` to override the development proxy target. Run `npm run build` to produce `dist/`. Serve `dist/` as static assets and proxy `/api` to the backend on the same origin; use HTTPS in production. The login token stays in memory only, so refreshing the page logs out.
