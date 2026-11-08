# Architecture

1. Real-time traffic uses WebSockets via Socket.IO.
2. Server-authoritative: the client only sends keystroke events. The server holds the race text and computes position, WPM and accuracy. Never trust client-supplied position, WPM or timestamps.
3. The server clock is the source of truth. Stamp each keystroke on arrival; ignore any client timestamp for scoring.
4. Room is a state machine: LOBBY -> COUNTDOWN -> RACING -> RESULTS -> (LOBBY | CLOSED). The server validates every transition. Clients can only request transitions.
5. Disconnect: the player's position is kept, the race clock keeps running, there is a grace period, then DNF.
6. Each player has a public `playerId` (broadcast to others) and a secret session `token` (never broadcast). The server maps token -> player on reconnect.
7. Live race state lives in server memory (in-process). Only final race results are written to PostgreSQL. Never persist keystrokes or live state.
8. Room codes: 6 characters from an unambiguous alphabet (no 0/O/1/I), shared as `/r/<code>`. Check for collisions among active rooms. Rate-limit join attempts.
9. Guests first: a player enters a username and receives a session token. No login in v1 (accounts come in v1.1).

## Boundaries

`domain/` is pure logic and imports neither transport nor persistence code.

## Implemented v1 data flows

- **Join:** a client sends a validated username, optional room code, and optional session token. The gateway creates or reattaches the guest session, adds it to an in-memory room, and broadcasts a token-free `room_state`.
- **Start:** only the host can request `start_race` from `LOBBY`. The room manager picks a text and server start time (`now + 5000ms`); the gateway broadcasts both in `race_countdown`, then transitions to `RACING`.
- **Keystroke:** the client sends only `{ char, index }`. The gateway validates the shared schema and passes the request with server arrival time to the same room-manager handler used by bots. Wrong indexes, pre-start input, finished players, and burst traffic are rejected.
- **Tick:** while racing, a 10Hz timer computes each player's position, WPM, accuracy, and status on the server and broadcasts `race_progress`. Results are emitted when all players finish/DNF or at 120 seconds.
- **Disconnect:** a socket close marks a racing player disconnected without stopping the clock. A 20-second timer marks them DNF unless their session token reconnects and reattaches the stored player state. When the race ends (everyone finished/DNF, or the time limit), any pending disconnect timers are cancelled so nothing fires into the results screen.
- **Cleanup:** when a room closes (the host or the last player leaves), the room's countdown, tick, finish, disconnect and bot timers are all cleared. A non-host leaving does not stop the room's bot.

## Realtime gateway configuration

`createRealtimeServer(httpServer, overrides?)` takes optional `RealtimeOptions` (countdown, race limit, disconnect grace, tick interval, join rate limit, CORS origin, text provider). Production passes none, so the defaults above apply. It returns `{ io, inspect(), close() }`: `inspect()` reports live room, session and timer counts, and `close()` closes every room and shuts down Socket.IO.

## Testing

- `apps/server/tests/domain.test.ts`: unit tests for the pure domain and room manager.
- `apps/server/tests/realtime.integration.test.ts`: boots the real gateway in-process on an ephemeral port (no Express, no PostgreSQL) and drives it with real `socket.io-client` connections. It covers the full lifecycle (create, join, countdown, race, results, race again), rejection of inflated or malformed positions and keystroke bursts, reconnect within and after the grace window, and timer cleanup, both through `inspect()` and through Node's active-timer count.
- `apps/server/tests/harness/` is the reusable harness. `RaceClient` (client.ts) only needs a URL, so the planned load-test script can point it at a deployed server. `startTestServer` (server.ts) boots an in-process server with fast timings and fixed texts.
- `tsconfig.test.json` typechecks the tests as part of `pnpm typecheck`.

Live rooms and timers are intentionally process-local in this first playable version. Persistence, accounts, custom text, and multi-process scaling remain TODOs.
