# Typeroom

Production-grade multiplayer typing-race scaffold. Product features are intentionally not implemented yet.

## Run locally

Docker is only used for the database; the app itself runs natively.

1. Install Node.js 22 and pnpm 9.
2. Create `apps/web/.env` containing `VITE_SOCKET_URL=http://localhost:3000`.
3. Run `pnpm install`.
4. Run `docker compose up -d` to start PostgreSQL (published on `localhost:5433`).
5. Run `pnpm db:migrate`.
6. Run `pnpm dev` (or `pnpm dev` inside `apps/server` and `apps/web` in two terminals).
7. Open [http://localhost:5173](http://localhost:5173).

To run the whole stack in Docker instead, use `docker compose --profile full up --build`. Run `pnpm install` again afterwards before going back to native `pnpm dev`, since the containers overwrite `node_modules`.

Useful checks: `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `docker compose -f docker-compose.prod.yml build`.

The server exposes `/health` and `/ready`. The browser skeleton connects through Socket.IO, creates or resumes a guest session, and displays its public player ID.
