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

## Frontend delivery to dev

Pull requests to `dev` run promotion-script tests, dependency installation,
dependency auditing and the frontend build. They do not publish to S3.

A push to `dev` publishes the build to an immutable release prefix:

    releases/<github.run_id>-<github.run_attempt>/

The publication job then:

1. Downloads the published release.
2. Validates non-empty HTML, assets and direct local HTML references.
3. Copies dependencies to `current/`, retaining previous objects.
4. Publishes `current/index.html` last.
5. Requests CloudFront invalidation for `/` and `/index.html`.

Promotion jobs use the `frontend-current-dev` concurrency group without
cancelling a running job. This prevents overlapping promotions but does
not guarantee chronological execution of all queued releases.

CloudFront must use `/current` as its S3 origin path for these promotions
to become active. During migration, copying to `current/` does not activate
a release while CloudFront still points to `releases/<id>/`.

## Promotion safety and limitations

`scripts/promote-release.sh` requires `BUCKET`, `RELEASE_ID` and
`DISTRIBUTION_ID`. Running it with a real AWS CLI writes to S3 and requests
an invalidation. It is not a dry-run command.

Copying multiple S3 objects is not atomic. A failed dependency upload
stops before publishing HTML; a failed HTML upload stops before invalidation.
Already copied objects are not automatically reverted.

Asset URLs must be content-hashed and immutable. Validation checks direct
HTML references, not transitive JavaScript or CSS dependencies.
Successful invalidation submission does not mean invalidation is complete.

Keep prior releases and assets for rollback and clients using older HTML.
## Manual rollback in dev

The `frontend-rollback.yml` workflow restores an existing release without
rebuilding the frontend or changing Terraform.

In GitHub Actions, select "Frontend rollback dev", choose the `dev` branch
and enter the release ID in `run_id-run_attempt` format.

The workflow validates the release, copies dependencies to `current/`,
publishes index.html last and requests selective CloudFront invalidation.
It shares the deployment concurrency group with normal promotions.

Rollback changes deployed S3 content, not Git history. A later deployment
can promote newer code again. Verify the workflow result and the deployed
UI after rollback. Staging and production rollback are not enabled yet.

## Local promotion checks

Run from this repository:

    bash -n scripts/promote-release.sh
    python3 scripts/tests/test_promote_release.py -v

The Python tests use a simulated AWS CLI and do not access AWS.