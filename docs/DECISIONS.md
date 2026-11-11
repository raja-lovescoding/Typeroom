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

## Phase 2–3 decisions

10. **Modes are a server-side config, not client options.** The host picks a `RaceConfig`; the server generates the text and time limit, so every racer gets the same race and nothing about the mode is trusted from guests.
11. **Time mode "finishes" everyone at the bell.** Ranking by correct characters over the same duration is fair, and keeps finish-time semantics consistent across modes.
12. **Licence-clean content only.** The word list and many quotes are written for Typeroom; the rest are public-domain works (pre-1900, authors dead > 100 years). Quote buckets are computed from length so they can't be mislabelled.
13. **Synthesised sounds.** Web Audio generates clicks at runtime: no audio assets to license, nothing extra to download.
14. **Hand-rolled router.** Eight flat routes don't justify a routing dependency; ~50 lines cover it.
15. **Server-only profanity list.** It isn't shipped to browsers; the shared schema only enforces length and allow-list so the client can give instant feedback.
16. **Legal pages describe reality.** Operator facts are env-driven placeholders that are loudly visible when missing; the policy file carries a re-review warning for when accounts or analytics arrive.

## Quick Race decisions

17. **Matchmaking hands off to a normal room.** The queue only decides the line-up; countdown, scoring, progress, results and disconnect grace are the existing room code. One race engine means one set of anti-cheat rules.
18. **Bands from a server-side rolling average.** Players never state their band. An EMA re-bands newcomers after one race but isn't swung by a single outlier. Only that number is stored, never keystrokes.
19. **Ghosts are labelled.** Every ghost carries `isGhost` in the contract and a visible "ghost" badge; nobody should think they beat a person when they didn't.
20. **Ghosts type through the human path.** No shortcuts: the ghost submits keystrokes to the same handler as a human, so its position, WPM and finish are computed the same way and it can't break the burst cap.
21. **Ghost races never count.** They are excluded at the single `recordRace` seam, so stats, rankings and future persistence can't be farmed by queueing alone. They still update the player's own matchmaking average, since that WPM is measured from the human's keystrokes.
22. **No per-second lobby broadcasts.** `queue:update` is event-driven and carries `msLeft`; clients count down locally. That keeps lobby traffic proportional to joins and leaves, not to time.
23. **In-memory behind interfaces.** `MatchmakingQueue` and `RatingStore` keep queue state out of PostgreSQL and make a Redis swap a contained change when the server scales past one process.
