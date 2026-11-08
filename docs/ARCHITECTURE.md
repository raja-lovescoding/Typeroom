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

## Web client

- **Layout:** `apps/web/src/app/App.tsx` owns the socket wiring, the screen (home, lobby, race, results), the keyboard flow and the command palette. Features live in `features/{lobby,race,results}`; shared UI lives in `components/`.
- **Design system:** every colour is a CSS variable from `styles/themes.css` (14 original themes). Theme blocks use `[data-theme]` selectors, so a picker swatch only needs `data-theme` to show its real colours. `settings/themes.ts` is the catalogue used for pickers and validation.
- **Visual settings** (theme, typing font, font size, caret style, smooth caret, name labels, error highlighting, focus mode) are client-only. They live in `settings/settings.ts`, are stored in localStorage under `typeroom.settings`, are sanitised on load, and are never sent to the server. An inline script in `index.html` applies the saved theme before first paint. The site sets no cookies.
- **Fonts:** Lexend for the UI; Roboto Mono, JetBrains Mono, Fira Code, Source Code Pro and IBM Plex Mono for typing. All are OFL-1.1, self-hosted through Fontsource packages (bundled into `dist/`, latin and latin-ext subsets, `font-display: swap`). The browser never contacts a font CDN.
- **Typing display (stop-on-error, matching the server):** a wrong key never moves the caret. Wrong keys at a letter blink that letter (*incorrect*). Wrong keys where a space is expected are shown inserted after the word (*extra*). Backspace clears only that local display, because the server has no backward movement. Corrected characters stay marked when "highlight errors" is on.
- **Authoritative vs local numbers:** ranking, net WPM, accuracy and finish time on the results screen come from the server. Raw WPM, consistency (100 × (1 − coefficient of variation) of per-second raw speed), the correct/incorrect/extra/missed breakdown and the WPM chart are computed in `features/race/typingStats.ts` from the player's own keystroke log, for display only.
- **Keyboard flow:** Esc opens the command palette (fuzzy search in `lib/fuzzy.ts`, with nested menus and live theme preview). Tab then Enter runs the screen's quick action: race again on results, start race in the lobby (host only). Racing again against only bots starts the next countdown straight away. During a race Tab never moves focus off the text.
- **Identity colours:** you are the theme accent; other players get `--ghost-1..4` in join order, consistent across lobby, race and results (never by rank).

## Testing

- `apps/server/tests/domain.test.ts`: unit tests for the pure domain and room manager.
- `apps/server/tests/realtime.integration.test.ts`: boots the real gateway in-process on an ephemeral port (no Express, no PostgreSQL) and drives it with real `socket.io-client` connections. It covers the full lifecycle (create, join, countdown, race, results, race again), rejection of inflated or malformed positions and keystroke bursts, reconnect within and after the grace window, and timer cleanup, both through `inspect()` and through Node's active-timer count.
- `apps/server/tests/harness/` is the reusable harness. `RaceClient` (client.ts) only needs a URL, so the planned load-test script can point it at a deployed server. `startTestServer` (server.ts) boots an in-process server with fast timings and fixed texts.
- `apps/web/src/**/*.test.ts`: unit tests for the local typing stats and the palette's fuzzy matcher.
- `tsconfig.test.json` typechecks the tests as part of `pnpm typecheck`.

Live rooms and timers are intentionally process-local in this first playable version. Persistence, accounts, custom text, and multi-process scaling remain TODOs.
