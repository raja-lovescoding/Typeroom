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
