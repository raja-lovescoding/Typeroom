# Typeroom

Real-time multiplayer typing races. Make a room, share the link, and race friends on the same text, or warm up against a bot. The server is authoritative: browsers send single keystrokes, and the server scores everything.

- **Modes:** time (15/30/60/120 s), words (10/25/50/100), quote (short/medium/long), and custom text. Time and words can add punctuation.
- **Pages:** play, settings, about (with credits), privacy policy, terms of use, contact, 404, and an error page.
- **No accounts, no cookies, no analytics.** See [the privacy page source](apps/web/src/pages/Privacy.tsx).

## Run locally

Docker is only used for the database; the app itself runs natively.

1. Install Node.js 22 and pnpm 9.
2. Copy `apps/web/.env.example` to `apps/web/.env` (at least `VITE_SOCKET_URL=http://localhost:3000`).
3. Run `pnpm install`.
4. Run `docker compose up -d` to start PostgreSQL (published on `localhost:5433`).
5. Run `pnpm db:migrate`.
6. Run `pnpm dev` (or `pnpm dev` inside `apps/server` and `apps/web` in two terminals).
7. Open [http://localhost:5173](http://localhost:5173).

To run the whole stack in Docker instead, use `docker compose --profile full up --build`. Run `pnpm install` again afterwards before going back to native `pnpm dev`, since the containers overwrite `node_modules`.

Useful checks: `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `docker compose -f docker-compose.prod.yml build`.

## Before deploying

The legal pages need operator details that only you can supply. Until they're set they render as highlighted `[[PLACEHOLDERS]]`, and `vite build` prints a warning. Set them as build-time variables (see `.env.example` / `apps/web/.env.example`):

| Variable | Used for |
| --- | --- |
| `VITE_CONTACT_EMAIL` | Contact page mailto, privacy requests |
| `VITE_OPERATOR_NAME` | Who runs the service (Privacy, Terms) |
| `VITE_JURISDICTION` | Governing law (Terms) |
| `VITE_LOG_RETENTION_DAYS` | How long logs are kept (Privacy); must match your real retention |
| `VITE_HOSTING_PROVIDER` | Who hosts the servers (Privacy) |

See [docs/OPERATIONS.md](docs/OPERATIONS.md) for log retention, proxies and rate limits.

The server exposes `/health` and `/ready`.
