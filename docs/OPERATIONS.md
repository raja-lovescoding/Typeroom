# Operations

Things a deployment must get right so the site behaves the way the Privacy Policy and Terms say it does.

## Operator details

`VITE_CONTACT_EMAIL`, `VITE_OPERATOR_NAME`, `VITE_JURISDICTION`, `VITE_LOG_RETENTION_DAYS` and `VITE_HOSTING_PROVIDER` are baked into the static bundle at build time (`docker-compose.prod.yml` passes them as build args). Unset values render as highlighted `[[PLACEHOLDERS]]`, and `vite build` warns about them. Bump `SITE.legalLastUpdated` in `apps/web/src/config/site.ts` whenever the Privacy or Terms text changes.

## Logs and retention

- nginx access logs: client IP, time, request line (an invite link includes the room code), status, referrer, user agent.
- Server logs (pino, stdout): errors only. They don't include nicknames, custom text or keystrokes; keep it that way, or update the Privacy Policy.
- `docker-compose.prod.yml` rotates container logs by **size** (5 × 10 MB per service). Docker cannot delete by age, so if logs are shipped elsewhere or kept longer, enforce `VITE_LOG_RETENTION_DAYS` there. The number on the Privacy page must be true.

## Proxy and rate limiting

`create_room` + `join_room` are limited to 20 per minute per client address; mode changes to 20 per 10 s per socket. Behind nginx every socket comes from the proxy's address, so the server reads `X-Forwarded-For` **only** when `TRUST_PROXY=true`. That's safe only because:

1. nginx overwrites (never appends) `X-Forwarded-For` with `$remote_addr`, and
2. the server port is not published (`expose`, not `ports`), so nobody can bypass nginx.

If a CDN or load balancer sits in front of nginx, configure nginx's `real_ip` module so `$remote_addr` is the real client.

## Room lifetime

Rooms live in memory. A room closes when its host leaves, when no human has been connected for `ROOM_IDLE_MS` (default 10 minutes; the Privacy Policy says 10 minutes), or on restart. Players get a `room_closed` event. A sweep every minute also forgets sessions no longer attached to a room and prunes rate-limiter entries.

## Single page app and 404s

nginx serves `index.html` for every unknown path, so the SPA's 404 page is returned with HTTP status 200. Search engines handle this, but if you need real 404 status codes, add explicit nginx `location` blocks for the known routes.
