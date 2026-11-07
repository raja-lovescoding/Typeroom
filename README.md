# Typeroom

Production-grade multiplayer typing-race scaffold. Product features are intentionally not implemented yet.

## Run locally

1. Copy `.env.example` to `.env`.
2. Install Node.js 22 and pnpm 9.
3. Run `pnpm install`.
4. Run `pnpm db:migrate` with PostgreSQL available.
5. Run `pnpm dev`.
6. Open [http://localhost:5173](http://localhost:5173).

Or run the complete development stack with `docker compose up --build`, then open the same URL.

Useful checks: `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `docker compose -f docker-compose.prod.yml build`.

The server exposes `/health` and `/ready`. The browser skeleton connects through Socket.IO, creates or resumes a guest session, and displays its public player ID.
