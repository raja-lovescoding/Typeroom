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
- **Race config:** each room has a `RaceConfig` (shared Zod discriminated union: `time` / `words` / `quote` / `custom`). The host sets it at creation or with `set_race_config` (host only, `LOBBY` only, rate-limited); it's broadcast in `room_state`.
- **Start:** only the host can request `start_race` from `LOBBY`. The text comes from `services/textProvider.ts` (original word list in `content/words.ts`; public-domain and original quotes in `content/quotes.ts`, length bucket derived from character count), or is the host's normalised custom text. The gateway broadcasts text, config, quote source and time limit in `race_countdown`, then transitions to `RACING`.
- **Time limit:** time mode ends after its duration, and everyone still connected *finishes* with that duration; the most correct characters wins. Time-mode texts are longer than the 25 keys/s cap allows anyone to finish. Other modes get `max(raceLimitMs, time for the text at 20 WPM)`, and unfinished racers are DNF, ranked by progress.
- **Nicknames:** `usernameSchema` (shared) normalises whitespace and enforces 2–24 characters from an allow-list (letters/digits in any script, space `_ . -`). The server also runs `domain/nickname.ts`: a two-tier profanity blocklist (substring terms; whole-word terms for short words, to avoid the Scunthorpe problem) with leetspeak, accent and separator folding.
- **Keystroke:** the client sends only `{ char, index }`. The gateway validates the shared schema and passes the request with server arrival time to the same room-manager handler used by bots. Wrong indexes, pre-start input, finished players, and burst traffic are rejected.
- **Tick:** while racing, a 10Hz timer computes each player's position, WPM, accuracy, and status on the server and broadcasts `race_progress`. Results are emitted when all players finish/DNF or at the time limit.
- **Disconnect:** a socket close marks a racing player disconnected without stopping the clock. A 20-second timer marks them DNF unless their session token reconnects and reattaches the stored player state. When the race ends (everyone finished/DNF, or the time limit), any pending disconnect timers are cancelled so nothing fires into the results screen.
- **Cleanup:** when a room closes (the host or the last human leaves, idle for `ROOM_IDLE_MS`, or shutdown), everyone gets `room_closed { reason }`, sockets leave the room, and the room's countdown, tick, finish, disconnect and bot timers are all cleared. A once-a-minute sweep closes idle rooms, forgets detached sessions and prunes rate limiters. Players offline when a race starts get the normal disconnect grace window.
- **Lookup:** the gateway maps `socket.id -> session` (O(1) per keystroke); a socket only acts for its player while it is that player's current socket.

## Quick Race matchmaking

Quick Race puts players into public races of 2–5 racers, filling empty seats with ghosts when nobody else is around. It reuses the room/race machinery unchanged: matchmaking only decides *who* races; the race itself is a normal room.

**Constants** (shared, `packages/shared/src/constants.ts`): `QUICK_RACE_MIN_RACERS = 2`, `QUICK_RACE_MAX_RACERS = 5`, `QUICK_RACE_LOBBY_WAIT_MS = 15 000`, `QUICK_RACE_GHOSTS = { min: 1, max: 3 }`, `GHOST_WPM_SPREAD = 0.1`, `WPM_BANDS` (`0-40`, `40-70`, `70-100`, `100+`; lower bound inclusive) and `DEFAULT_WPM_BAND = '40-70'`.

**Flow**

1. The client emits `queue:join { username, token?, config? }`. The schema is strict, and `config` may be time, words or quote (never custom text). Any band, rating or role field is rejected. Requests are rate-limited per socket and per client address (shared by `queue:join` and `queue:leave`).
2. The gateway binds the guest session and enforces one queue *or* race per player. If the player is in a COUNTDOWN/RACING room, a dead old socket is reattached to that race (the ack carries `room`); a live one is refused. A finished room is left first. A seat still held by a dead socket is taken over, so nobody is queued twice.
3. The server looks up the player's rolling average WPM (`services/ratingStore.ts`) and derives the band (`bandForWpm`; no history means `40-70`). The player joins the open lobby for *band + mode*, or a new one is created and its 15 s timer starts.
4. Every change (join, leave, disconnect, reconnect) broadcasts `queue:update { lobbyId, band, config, racers, seatsFilled, maxSeats, msLeft, secondsLeft }` to the lobby's connected members. There is no per-second traffic: the client counts down locally from `msLeft`.
5. When the timer ends, or immediately once 5 humans are seated (locked at once, handed off on the next event-loop turn so the join ack goes out first), the lobby is **locked** and removed from the open index. Later queuers get a new lobby. At hand-off:
   - 2+ humans race each other with no ghosts.
   - A lone human gets 1–3 ghosts (never above 5 racers in total).
   - If nobody is connected, no race starts; members get `queue:closed { reason: 'expired' }`.
6. Hand-off (`launchQuickRace` in the gateway) creates a `kind: 'quick'` room with `RoomManager.createRoom`/`joinRoom`/`addGhost`, joins each member's socket to it, emits `queue:matched { lobbyId, playerId, room }`, and calls the same `startRoomRace` that `start_race` uses: countdown, authoritative scoring, 10 Hz progress, results and disconnect grace are all unchanged.
7. `queue:leave` removes the player (ack `{ ok }`, then `queue:closed { reason: 'left' }`). A lobby that drops to 0 humans is destroyed with its timer. If it drops to 1 human, the 2-racer minimum is re-evaluated at the timer and ghosts fill in. `create_room`/`join_room` while queued drops the queue seat (`replaced`). Server shutdown sends `shutdown`.
8. **Disconnects in a lobby:** the seat is kept for `queueGraceMs` (5 s) and shown as reconnecting. A `queue:join` from the same session reattaches to the same seat. After the grace window the member is removed (`expired`). If the lobby starts during the grace window, the member is seated as disconnected and the room's normal disconnect grace applies; they get back in with `queue:join` or `join_room`.

**Quick rooms** differ from private rooms only in policy: they skip LOBBY (straight to COUNTDOWN), so nobody can join mid-race. There are no host controls, and `race_again` is refused, so players queue again (the UI's "Find another race"). The room stays open for the remaining humans when its first player leaves. `room_state.kind` tells the client which it is.

**Interfaces for scaling out:** queue and lobby state live only in process memory behind `MatchmakingQueue` (`services/matchmakingQueue.ts`), and ratings behind `RatingStore`. Nothing about queueing is written to PostgreSQL. A Redis implementation would replace `InMemoryMatchmakingQueue` and `InMemoryRatingStore`. The queue interface is synchronous today, so a networked store would make `join`/`leave` async and the lobby timer would need a distributed owner.

**Ratings:** an exponential moving average (weight 0.3) of net WPM per player id. The first finished race sets it outright, so newcomers are re-banded after one race. It is updated from every finished race except custom text, including ghost races (the WPM is the human's own, measured by the server). Only that one number is kept, never keystrokes. Entries are LRU-capped at 100 000 and pruned after 7 days idle. Guest ids live as long as the guest session, so a forgotten session starts again in the default band.

### Ghost racers

- **Contract:** every racer in `room_state`, `race_progress` and `race_results` carries `isGhost`. Ghosts are also `isBot: true`. The server alone decides this. The UI shows an outlined **ghost** badge in the lobby, standings and results, adds "· ghost" to caret labels, and shows a note on results that the race doesn't count. Names are bot-style (`Wisp-42`) and distinct within the room.
- **Speed:** each ghost's target is sampled uniformly within ±10 % of the human's rolling average, or the band's typical speed (30/55/85/115) for newcomers, and clamped to 15–180 WPM.
- **Typing model** (`domain/ghost.ts`, `GhostTypist`): a per-word pace (0.8–1.2×, longer words slower), ±25 % per-key jitter, a 30–130 ms gap after each space plus an occasional 220–650 ms hesitation, a warm-up over the first 10 % and fatigue over the second half, and a 2.5 % chance per letter of a wrong neighbouring key followed by a 180–420 ms correction at the same index. These overheads are budgeted out of the per-key time, so the race average stays within about 10 % of the target (unit-tested on a virtual clock).
- **Same rules as humans:** the gateway's existing bot scheduler drives the ghost (a `Typist`, like the practice `BotPlayer`) and submits every key through `RoomManager.handleKeystroke`, with the same index check, burst cap, scoring and finish logic. Ghost timers are room-scoped and cleared when the race ends.
- **Never counted:** `finishRace` passes a race to the optional `recordRace` hook (the persistence seam) only when no ghost took part, and strips bot results. Ghost races therefore never reach stats, rankings or PostgreSQL, so queueing repeatedly to farm ghost races gains nothing.

## Realtime gateway configuration

`createRealtimeServer(httpServer, overrides?)` takes optional `RealtimeOptions` (countdown, race limit, disconnect grace, tick interval, join rate limit, CORS origin, text provider, Quick Race wait and grace, queue rate limits, rating store, `recordRace` hook, randomness for ghosts). Production passes none, so the defaults above apply. It returns `{ io, inspect(), close() }`: `inspect()` reports live room, session, queue and timer counts (including lobby and queue-grace timers), and `close()` empties the queue, closes every room and shuts down Socket.IO.

## Web client

- **Layout and routing:** `lib/router.tsx` is a small History API router (`usePathname`, `navigate`, `<Link>`). `app/App.tsx` maps routes (`/`, `/r/:code`, `/settings`, `/about`, `/privacy`, `/terms`, `/contact`, else 404) inside a shared header/footer, with an `ErrorBoundary` around the page (reset on navigation) and another around the whole app in `main.tsx`. Socket wiring, room state and Quick Race queue state live in `features/game/useGame.ts`, above the router, so browsing other pages keeps you in your room; a starting countdown navigates back. Text pages live in `pages/`; operator details come from `config/site.ts` (VITE_* variables, shown as `[[PLACEHOLDERS]]` when unset).
- **Design system:** every colour is a CSS variable from `styles/themes.css` (14 original themes). Theme blocks use `[data-theme]` selectors, so a picker swatch only needs `data-theme` to show its real colours. `settings/themes.ts` is the catalogue used for pickers and validation.
- **Visual settings** (theme, typing font, font size, caret style, smooth caret, name labels, error highlighting, focus mode, live stats, sound and volume, motion: system/reduce/full) are client-only, edited on `/settings` or the in-room overlay (both render `components/SettingsForm.tsx`). Motion is applied as `data-motion` on `<html>`. Key sounds are synthesised with Web Audio in `lib/sound.ts`; there are no audio files. They live in `settings/settings.ts`, are stored in localStorage under `typeroom.settings`, are sanitised on load, and are never sent to the server. An inline script in `index.html` applies the saved theme before first paint. The site sets no cookies.
- **Fonts:** Lexend for the UI; Roboto Mono, JetBrains Mono, Fira Code, Source Code Pro and IBM Plex Mono for typing. All are OFL-1.1, self-hosted through Fontsource packages (bundled into `dist/`, latin and latin-ext subsets, `font-display: swap`). The browser never contacts a font CDN.
- **Typing display (stop-on-error, matching the server):** a wrong key never moves the caret. Wrong keys at a letter blink that letter (*incorrect*). Wrong keys where a space is expected are shown inserted after the word (*extra*). Backspace clears only that local display, because the server has no backward movement. Corrected characters stay marked when "highlight errors" is on.
- **Authoritative vs local numbers:** ranking, net WPM, accuracy and finish time on the results screen come from the server. Raw WPM, consistency (100 × (1 − coefficient of variation) of per-second raw speed), the correct/incorrect/extra/missed breakdown and the WPM chart are computed in `features/race/typingStats.ts` from the player's own keystroke log, for display only.
- **Keyboard flow:** Esc opens the command palette (fuzzy search in `lib/fuzzy.ts`, with nested menus and live theme preview). Tab then Enter runs the screen's quick action: race again on results, start race in the lobby (host only). Racing again against only bots starts the next countdown straight away. During a race Tab never moves focus off the text.
- **Quick Race UI:** a "Quick race" card leads the home page (mode picker without custom text). While queued, `features/queue/Queue.tsx` replaces the play view: racers, open seats, `n/5` seats filled, band and mode, a local countdown and Cancel. On `queue:matched` it shows "Starting…" until the race countdown arrives, so there is no flash of a lobby screen. If the socket reconnects mid-queue, `useGame` re-sends `queue:join` for the same mode and retakes the seat, or is put straight into the race if the lobby already started. `queue:closed` (expired, replaced, shutdown) returns to home with a toast. On a quick race's results, the primary action (and Tab + Enter) is "Find another race".
- **Identity colours:** you are the theme accent; other players get `--ghost-1..4` in join order, consistent across lobby, race and results (never by rank).

## Testing

- `apps/server/tests/domain.test.ts`: unit tests for the pure domain and room manager.
- `apps/server/tests/realtime.integration.test.ts`: boots the real gateway in-process on an ephemeral port (no Express, no PostgreSQL) and drives it with real `socket.io-client` connections. It covers the full lifecycle (create, join, countdown, race, results, race again), rejection of inflated or malformed positions and keystroke bursts, reconnect within and after the grace window, and timer cleanup, both through `inspect()` and through Node's active-timer count.
- `apps/server/tests/harness/` is the reusable harness. `RaceClient` (client.ts) only needs a URL, so the planned load-test script can point it at a deployed server. `startTestServer` (server.ts) boots an in-process server with fast timings and fixed texts.
- `apps/web/src/**/*.test.ts`: unit tests for the local typing stats and the palette's fuzzy matcher.
- `tsconfig.test.json` typechecks the tests as part of `pnpm typecheck`.

- `apps/server/tests/modes.integration.test.ts`: race config permissions and validation, custom text, quote attribution, time limits, nickname rejection over the wire, `room_closed`, idle sweeping, lobby reconnects, and room switching.
- `apps/server/tests/{nickname,content}.test.ts`: nickname filter (including Scunthorpe cases), word list and quote invariants, text generation per mode.
- `packages/shared/tests/schemas.test.ts`: nickname, race config and custom text schemas, plus the Quick Race contracts (constants, strict `queue:join`, `isGhost`, seat cap).
- `apps/server/tests/matchmaking.test.ts`: unit tests on fake timers for the queue (band assignment, mode separation, timer start and fill, 1-human ghost fill, 2+ human start, 5-human cap and immediate start, leave during the timer, empty-lobby teardown, duplicate join, reconnect within and after grace, stale-socket disconnects, lobby lock, `close()`), the ghost typist (average WPM per target, non-constant rhythm, mistake then correction, word pauses, burst limit), the rating store and quick-room policy.
- `apps/server/tests/quickrace.integration.test.ts`: real Socket.IO clients against the in-process gateway. Covers two humans matched → raced → results → recorded; a ghost-filled race with server-driven ghost progress, labelled results, no recording and re-banding; a mid-lobby disconnect (seat kept, reconnect, a second racer dropped after grace); ghosts filling in when the other human never returns; rejoining a race that started while offline; 5-human immediate start and a fresh lobby for the 6th; duplicate rejection (same socket, other tab); cancel; leaving the queue by creating a room; payload validation and per-socket/per-address rate limits; shutdown notice; and queueing again after a quick race.

Live rooms and timers are intentionally process-local. Persistence of results, accounts, and multi-process scaling remain TODOs. **When any of them land, re-review `apps/web/src/pages/Privacy.tsx`.**
