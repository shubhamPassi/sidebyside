# Implementation validation — 14 October 2026

Tested on Windows, Node.js 24.14.1, installed Google Chrome, against the production build at http://localhost:3001.

| Check | Result |
| --- | --- |
| `npm run build` | Passed: TypeScript check and Vite production bundle |
| `npm test` | 13 passed, 0 failed |
| `npm run test:ui` | 1 comprehensive browser scenario passed, 0 failed; two independent browser contexts plus a third capacity check |
| `npm audit --omit=dev` | 0 vulnerabilities reported |
| Real YouTube smoke check | Official API loaded; player activated and played; reported playhead 0:04, duration 22:23; 0 page errors |
| Desktop/mobile visual review | Reviewed desktop room, active real-player room and 390px-wide room; mobile test confirms no horizontal page overflow |

Server tests verify URL allowlisting, room capacity, credentials, delay-compensated timelines, conflicting/stale revisions, command deduplication, input limits, buffering/wait pauses, disconnect recovery, creator controls, removed credentials, expiry, late join, real HTTP/WebSocket transport, origin rejection, and client snapshot ordering. Rejected playback commands return a forced authoritative snapshot so an optimistic native player change is reconciled.

The browser scenario uses a deterministic **simulated YouTube player** and the real room server. It checks creation/invites, URL validation, solo preview, late-join readiness, shared playback/seek, native player seek/play/pause, autoplay-block recovery, escaped chat, reactions, waiting, WebSocket reconnection, retained chat, two-seat capacity, guest removal, mobile layout, and absence of page errors.

The separate real-provider smoke check (`node scripts/provider-smoke.mjs`) does not mock YouTube. It loads the official example video M7lc1UVf-VE and verifies an actual embed request with the page origin and `Referer: http://localhost:3001/`, API readiness, playback activation, and advancing playhead. Its evidence is in `artifacts/provider-smoke.json` and `artifacts/real-youtube.png`. This is a short, one-browser check, not a two-device synchronization or long-session measurement.

Browser screenshots are in `test-results/landing.png`, `room-empty.png`, `room-active.png`, and `room-mobile.png`. Playwright replaces that folder on future test runs. Provider smoke artifacts are stored separately.

## Still unverified

- Playback between two physical devices on different networks, real pairwise drift, latency/jitter profiles, and a 30–60 minute session.
- Different ads, ad-to-content transitions, restricted videos, region/account differences, background throttling, sleep/wake, and real mobile autoplay/fullscreen behavior.
- Any public hosting or secure tunnel configuration; none was deployed.

The app deliberately uses manual drift recovery instead of periodic corrective seeks, because the documented player API does not provide reliable ad lifecycle signals. Native seek detection is a position-discontinuity heuristic after activation; it is not a documented YouTube seek event and requires real-session validation around ads. Wait + Ready + Resync remains the recovery path.

Rooms are ephemeral on a single long-running server; restarting erases rooms/history. Guest admission is direct through the private invite; there is no admission queue or ownership transfer. Production scaling and durable storage are not implemented.
