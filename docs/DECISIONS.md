# Decision log

1. **Socket.IO WebSockets** — It provides the required bidirectional transport with reconnection primitives while keeping the initial gateway small.
2. **Server-authoritative scoring** — Preventing client-controlled race state is the simplest reliable anti-cheat boundary.
3. **Server arrival clock** — Arrival timestamps are independently observable and avoid trusting manipulated client clocks.
4. **Validated room state machine** — Explicit transitions make invalid lifecycle changes impossible to silently accept.
5. **Graceful disconnects** — Keeping position and allowing a grace period supports transient network loss without changing scoring authority.
6. **Public ID plus secret token** — This separates broadcast identity from reconnect credentials without requiring accounts.
7. **In-memory live state and final-only persistence** — It minimizes latency and avoids storing sensitive keystroke streams.
8. **Unambiguous six-character codes with rate limiting** — Codes are easy to share while collision and abuse risks are bounded.
9. **Guest-first identity** — It minimizes onboarding for v1 and leaves account support for v1.1.

## Bot design

The bot is an in-memory `BotPlayer`, not a Socket.IO client. It schedules humanlike delays around its configured WPM, pauses slightly after spaces, and occasionally submits a wrong character. Every submission calls the exact same room-manager keystroke handler as a human, so the normal index, timing, scoring, and burst-limit rules apply equally. Bot timers are scoped to the room and are cleared when the race ends.
