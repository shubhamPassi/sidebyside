# Implementation validation — 14 October 2026

Tested on Windows, Node.js 24.14.1, installed Google Chrome, against the production build at http://localhost:3001.

| Check | Result |
| --- | --- |
| `npm run build` | Passed: TypeScript check and Vite production bundle |
| `npm test` | 27 passed, 0 failed, including play preparation, invitation code, reconnect grace and heartbeat-liveness tests |
| `npm run test:ui` | 4 browser scenarios passed, 0 failed: desktop flow, iPhone-mode playback/reconnect, code entry, and resync-before-play ordering |
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
- Actual Windows reboot/sign-in behavior (the installed hidden startup launcher was exercised directly).

The app deliberately uses manual drift recovery instead of periodic corrective seeks, because the documented player API does not provide reliable ad lifecycle signals. Native seek detection is a position-discontinuity heuristic after activation; it is not a documented YouTube seek event and requires real-session validation around ads. Wait + Ready + Resync remains the recovery path.

## Playback startup-delay fix

A report of another device starting roughly one second late and remaining behind exposed a gap in the initial implementation: command-arrival compensation did not cover the player's later startup delay. The client now calibrates its clock immediately on connection, uses a 350 ms command alignment threshold and performs at most one bounded catch-up after stable playback following a shared revision. Waiting, autoplay blocks, changed duration, elapsed recovery windows and large ambiguous drift skip recovery. Continuous corrective seeking remains disabled.

The browser regression introduces a full 1,000 ms startup delay into the second simulated player. It verifies drift below 350 ms after startup recovery and exactly one corrective seek, then checks that no repeated corrections follow. The full browser flow passed, all 17 unit/integration tests passed and the production build passed. Public HTTPS/WSS room verification passed again, and the public page was confirmed serving the updated asset bundle. These results demonstrate the simulated-delay fix; they do not measure the user's physical devices or establish ad synchronization.

### Asynchronous seek-pause follow-up

A subsequent device report revealed another missing behavior in the test double: an IFrame seek can leave playback paused, including through an asynchronous pause callback during the suppression window. Startup correction now issues play after seeking, with one revision-guarded follow-up 250 ms later only if the player is still paused/cued. A new room revision, source change, wait, disconnection or lack of readiness prevents that follow-up. There is no repeated seek/retry loop. If the player remains paused after suppression, it reports needs-interaction and pauses the shared room rather than leaving only that viewer stopped.

The browser regression now simulates both a one-second startup delay and a delayed pause after the corrective seek, verifies both players return to playing, and checks exactly one corrective seek. It also simulates a paused player with no state event during suppression; the room pauses for both viewers and reactivation restores readiness. Unit/integration tests remain 17 passing. The user's physical-device reproduction remains to be retried after both clients reload.

### iPhone readiness and conservative playback

After a report of a second-device pause after 10–15 seconds, the device was identified as iPhone Chrome. The root cause has not been established from actual phone traces. Readiness now waits for a confirmed player Playing event instead of the earlier immediate play/pause call sequence. The iPhone/iPad branch disables automatic startup seeks and native seek-discontinuity inference, preserves explicit shared-slider seeking and manual resync, and displays direct-player activation guidance. Desktop native seek detection also skips hidden pages and long sampling gaps. This prioritizes stable phone playback over automatic drift correction.

A second browser scenario uses an iPhone user-agent in Chromium with the simulated player (it is **not real iOS/WebKit**). It verifies that a one-second activation delay keeps the room unready until actual playback is reported, then both players stay playing for an 18-second observation window with no automatic phone seeks. Both browser scenarios, all 17 unit/integration tests and the build passed. The public bundle was updated. Physical-iPhone validation still requires a retry and, if the pause persists, its newly available local diagnostics trace.

Diagnostics retain only 180 local events and are copied on demand. They include timing/state/revision/status/socket-close information, browser user-agent and page visibility; they exclude credentials, invitations, nicknames and chat. No trace is automatically sent to the server.

### Evidence-based reconnect fix

The supplied physical-iPhone trace (`iphone-readiness-1`) reports abnormal WebSocket closures with code 1006 at 06:52:04.084 UTC and 06:52:07.614 UTC. During the gap its player stays in state 1 with progressing playback. At 06:52:11.748 UTC it receives room revision 42 paused, then the application applies that pause. The corresponding Windows trace also receives revision 42 paused while previously playing normally. These observations identify connection-loss/rejoin handling as the pause path for this incident; they do not establish the cause of the underlying abnormal socket closures.

The server now gives disconnected participants 10 seconds to reconnect. A previously ready, authenticated, same-page player on the same source resumes its connection without changing the timeline; fresh pages, changed sources and expired grace require preparation. This also handles replacement of an old half-open connection whose closure the server has not observed yet. Existing deliberate pauses remain authoritative. Valid application messages count as heartbeat liveness so a missing protocol pong alone cannot terminate an otherwise active client. The client no longer force-seeks an unchanged playing revision on reconnection.

All 21 unit/integration tests passed, including a 7.5-second interruption with a controlled clock, long-outage pause, intentional-pause preservation, stale-source rejection, half-open replacement and application keepalives with protocol pongs disabled. Both browser scenarios passed, including continued iPhone-mode playback and no automatic seeks after a simulated connection drop. Public HTTPS/WSS verification additionally exercises an actual 7.5-second disconnected interval through Cloudflare and checks unchanged playing revision, advancing authoritative position and restored readiness. The updated server was restarted; previous in-memory rooms were cleared. The user's actual network still needs a retry, and outages lasting over 10 seconds intentionally pause the room.

## Invitation codes

The initial eight-character invitation codes supplemented the existing invite links; the current format is four numeric digits, as described below. Tests cover formatting, invalid inputs, two-seat capacity, creator locking/rotation, invalidated old codes, end/expiry index cleanup, HTTP origin validation and code-guess rate limiting. The browser scenario verifies home-page code entry, old-code rejection, locked-code rejection, successful joining after unlock and mobile layout without horizontal overflow. Desktop and mobile screenshots are retained locally in `test-results/invitation-code-room.png` and `test-results/invitation-code-mobile.png`.

All 24 unit/integration tests, three browser scenarios and the production build passed. `verify-public.mjs` now joins by code through the actual HTTPS endpoint before verifying WSS controls, chat and a 7.5-second reconnect. That public check passed and cleaned up its temporary room. The new server was restarted to apply the feature, so previous rooms were cleared. Short codes have 40 bits of entropy and stricter entry rate limits; they are a different access path from the original 192-bit invitation tokens.

## Resync before every shared start

Play now uses a server-controlled preparation stage: timeline paused → align each player to the fixed room position → authenticated acknowledgements from every participant → start the playing timeline. Acknowledgements include the play request ID, source/timeline revision and measured position, which must be within 500 ms of the requested position. The server refuses stale/misaligned acknowledgements and cancels preparation on pause, seek, source change, unreadiness, disconnect or a 10-second deadline. Timeout leaves the room paused and marks missing viewers as needing interaction. The UI shows the alignment stage and uses the same sequence for a ready player's I’m ready button.

Three added server tests verify ordering, both-party acknowledgement, repeated starts, stale/misaligned responses, deliberate pause cancellation, timeout, waiting, source change and disconnect. The fourth browser scenario starts one paused player at 20 seconds and the other at 5, with the shared room at 90 seconds, and delays the second seek by 1.5 seconds. It verifies neither player starts during the delay and each completed its seek to 90 seconds before its play call. All 27 unit/integration tests and four browser scenarios passed, as did the build and the updated public protocol check. Provider/device playback startup after the acknowledgement can still vary; this is sequencing verification with a simulated player, not proof of frame-perfect physical-device synchronization. The server restart cleared previous rooms.

## Four-digit numeric code update

Invitation codes now use cryptographic `randomInt(0, 10000)` and zero-padding to four digits, with active-code collision checking. Normalization accepts only four ASCII digits and preserves leading zeros; strings of the wrong length, letters, hyphens and numeric JSON values are rejected. The home-page input has `inputMode=numeric`, a four-digit pattern and a four-character limit. Rotation, locks, expiry, capacity and rate limiting still apply. This intentionally reduces the code space to 10,000 values; long-link invitation tokens retain 192-bit randomness.

All 27 unit/integration tests passed, including the `0047` preservation assertions. The production build passed. The invitation-code browser scenario was rerun and passed with the numeric format, old-code rejection, lock/unlock and mobile layout. Public code-based joining, alignment-before-play, WSS, chat and reconnect recovery were also checked. The server restart cleared old rooms and their previous-format codes; create a new room to obtain a four-digit code.

Rooms are ephemeral on a single long-running server; restarting erases rooms/history. Guest admission is direct through the private invite; there is no admission queue or ownership transfer. Production scaling and durable storage are not implemented.

## Named tunnel deployment validation

On 14 October 2026 the app was published at **https://watch.chaigallery.in** through a Cloudflare named tunnel from this laptop. The connector reported Healthy and the published application route points to `http://127.0.0.1:3001`. The app was confirmed listening only on 127.0.0.1. Existing domain records were inspected before adding the separate watch CNAME.

`node scripts/verify-public.mjs https://watch.chaigallery.in` passed checks for public HTTPS health, valid-origin creation, invalid-origin rejection, two authenticated WSS clients, joining, seek/play commands, room chat, disconnect/reconnect snapshot recovery and removal of the temporary verification room. These are actual requests through Cloudflare, not mocked network responses.

Chrome on the public domain loaded the official YouTube player with `origin=https://watch.chaigallery.in`, activated it, played approximately 35 seconds of the sample video and paused it. A screenshot is retained locally at `artifacts/public-watch.jpg`. This remains a one-device playback check; it does not prove real two-device drift or ad synchronization.

Startup was installed for the current Windows user, using a hidden WScript launcher in the user's Startup folder. After a clean supervisor stop, invoking that installed launcher restored both Node and cloudflared and local health passed. The scoped token file's permissions showed only the current Windows user, and Git confirmed `.local/tunnel-token.txt` and `.local/watch-config.json` are ignored. The real OS sign-in event was not exercised by logging the user out or rebooting.
