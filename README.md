# Side by Side — YouTube watch rooms

A private, two-person YouTube room with shared playback and text chat. The original planning document is preserved in `WATCH_TOGETHER_PRD.md`; this implementation deliberately supports **YouTube only**.

The laptop installation is now published at **https://watch.chaigallery.in** through a named Cloudflare Tunnel. Both the app and tunnel are configured to start at this Windows user's sign-in. The laptop must remain awake and online. See [TUNNEL_SETUP.md](./TUNNEL_SETUP.md) for setup, start/stop controls, credential handling and verification limits.

## Run locally

Requires Node.js 22.12+ (tested on Node 24).

```powershell
npm install
npm run build
npm start
```

Open **http://localhost:3001**. Create a room, choose a nickname, paste an embeddable YouTube video URL, and copy the invite. The friend opens the invite in another browser/device, chooses a nickname, and activates their player. Both press Ready, then either presses Play. Until your friend joins you can preview alone; a new join pauses the room while their player prepares.

Each room also displays an **8-character invitation code** (for example `ABCD-2345`) with a Copy code button. Your friend can open the app's home page, choose **Join with code**, and enter their nickname and code. Codes accept lowercase, spaces and the displayed hyphen. Share codes privately: possession permits taking the second seat. Locking the invitation blocks both entry methods. **Replace link & code** rotates both; existing participant credentials continue working. Codes expire with the room and are deleted on room end/server restart. Codes use 40 bits of cryptographic randomness with collision checking, and code entry is limited to 10 attempts per minute per observed source address in addition to the ordinary HTTP limits. The existing long invite links retain their 192-bit tokens.

For development, `npm run dev` serves the UI at http://localhost:5173 and proxies room traffic to port 3001. Stop the production server first to free port 3001.

## Friends on different networks

**Your friend cannot reach your machine using your localhost URL.** Deploy this app as a long-running Node service behind HTTPS, or configure a secure HTTPS tunnel forwarding to port 3001. Use the public address to create/open the room and copy the invite; both browsers must use that address. No external deployment or tunnel is created automatically.

```powershell
$env:PUBLIC_ORIGIN = "https://your-app.example.com"
$env:PORT = "3001"
npm start
```

`PUBLIC_ORIGIN` is a comma-separated exact allowlist of browser origins (scheme + hostname + optional port, no trailing slash). Set it to the public HTTPS URL when behind a reverse proxy/tunnel. The proxy must preserve WebSocket upgrades at `/socket` and forward HTTP to the same service. `PORT` defaults to 3001. Without `PUBLIC_ORIGIN`, origins must exactly match the request Host over HTTP/HTTPS, which works for local development and direct LAN access. Do not expose an HTTP server publicly; terminate TLS with your hosting service or reverse proxy. A static-only host or short-lived serverless function cannot run the room service.

The Dockerfile is an optional deployment package. Use one instance; rooms are in memory, so restarting the service erases them. Multiple replicas need a shared room store and pub/sub first. Rooms expire after 30 minutes with no connected people, or 24 hours total. Keep the process running for the entire session.

## Controls and recovery

- A brief socket interruption gets a 10-second reconnect grace period. An already-ready player reconnecting in the same page and to the same video preserves the current timeline without a forced seek/restart. A longer outage pauses the room; refreshes and video changes still require preparation. Reconnect never overrides a deliberate shared pause. Application keepalive messages count toward connection liveness as well as WebSocket pong frames.
- A shared playback revision now gets one bounded startup catch-up after the player reports stable progress. This compensates for a slower device taking extra time to start YouTube after the command arrives. It allows a 350 ms dead band, stops after one check/correction, expires after 12 seconds, and skips changed durations, waits/autoplay blocks and large ambiguous drift. It is not a continuous drift corrector or an ad-sync guarantee.
- Startup correction restores playback after its seek, with one guarded follow-up for an asynchronous provider pause. A player that remains paused while the room is playing reports needs-interaction and pauses the room, so one person is not silently left behind. Activate that player again, then press Play together.
- iPhone/iPad use a conservative path: readiness is sent only after an actual Playing event, automatic startup catch-up and native seek heuristics are disabled, and play-command alignment uses a wider tolerance. Use the shared slider for seeking and deliberate Resync for drift. If scripted activation is blocked, tap Play directly inside YouTube. Keep the tab visible. This may leave startup drift that needs manual recovery rather than risking an automatic mid-play seek on iOS.
- “Copy diagnostics” copies a bounded local playback trace (player states, timing, revisions, readiness and socket-close codes, plus browser user-agent and visibility). It excludes participant credentials, invite links, nicknames and chat. It is not uploaded automatically. Share it when troubleshooting an issue that cannot be reproduced locally.
- Either viewer can play, pause, seek with the shared slider / time input, change the video, or chat. Original YouTube controls, volume, captions, branding, and ads remain available; volume and captions are personal. Native play/pause/seek are reconciled after player activation. Ready starts no shared playback by itself.
- “Wait for me” pauses the room and marks that person unready. Confirmed buffering (1.5 seconds), autoplay blocks, errors, and disconnections also pause the room. After recovery, press Ready and deliberately resume; the app never silently resumes an intentional pause.
- “Resync my player” fetches a fresh server snapshot and aligns only your player. Reconnect fetches current room state and chat before controls enable. Existing activated players restore position; refreshing needs activation again.
- Timeline revisions serialize commands. Source revisions reject old-video events, event IDs deduplicate retries, and the client suppresses events caused by applying commands. A ping clock estimate compensates delivery delay. Conflicting stale commands show a notice; retry against the latest state.
- There are **no periodic automatic corrective seeks**: the documented YouTube API does not reliably expose ad lifecycle. A drift notice suggests manual resync. Use Wait during ads, wait until both see normal video, then Ready + Resync + Play. Different ads cannot be guaranteed synchronized. Do not use resync to skip an ad.
- The creator can lock the invite, replace it, remove the guest, or end the room. Removed credentials cannot reconnect; a new guest needs the current invite. Guests join directly via the private invite (no separate admission queue). Room ownership does not transfer. Leaving keeps your seat reserved until expiry; a creator can remove the guest seat.

## Checks

```powershell
npm test
npm run build
npm run test:ui
```

Unit tests cover parsing, capacity, credentials, timing, revisions, duplicate commands, waits, disconnect recovery, ownership and expiry. Integration tests use a real HTTP/WebSocket server and two authenticated sockets. UI tests run installed Chrome, with a **simulated YouTube player** so room behavior can be tested deterministically without provider ads or autoplay variability. Set `CHROME_PATH` if Chrome is elsewhere. Alternatively install Playwright Chromium and adjust `playwright.config.js`. Browser tests reuse a running local server, or start one after the build. Screenshots are written to `test-results/`.

Real YouTube playback across two devices/networks, different ads, autoplay policies, region restrictions, sleep/background tabs and a long viewing session still need a manual pilot. An API script/iframe loading locally is not proof of those scenarios.

Exact results and retained evidence are recorded in [VALIDATION.md](./VALIDATION.md). The implementation uses the [official IFrame API](https://developers.google.com/youtube/iframe_api_reference) and preserves the [required player functionality](https://developers.google.com/youtube/terms/required-minimum-functionality).

## Privacy and scope

The server receives only room membership, video IDs, playback state, and text messages. It never extracts, proxies, uploads, or redistributes video. YouTube independently serves video to each browser; using the embedded player shares browser information with YouTube under its terms/privacy policy. The page preserves origin/referrer identification. Restricted, private, age-gated, embedding-disabled, live content, playlists, and videos exceeding the seek limit of 24 hours are unsupported. A normal `/watch` URL may identify live content; the app cannot reliably detect that from the URL alone.

Invite and participant credentials use 192-bit random tokens. The invite is in the URL fragment to keep it out of ordinary HTTP request/referrer URLs; room IDs remain in paths. Participant credentials are stored in tab-scoped sessionStorage and sent in the initial WebSocket message, not query strings. Do not share browser session data. Nicknames are display labels, not accounts. Chat is rendered as escaped text, capped at 500 characters / 100 retained messages, limited to 6 messages per 10 seconds. HTTP creation/join and sockets are rate limited; commands are authorized per member, WebSocket origins validated, request sizes bounded, and empty-room state deleted on expiry. This pilot has no external analytics or application request logging. Chat is private to room participants and the running server, **not end-to-end encrypted**. The end-room action deletes state immediately.

Local files, other streaming providers, voice, billing, public discovery and video rebroadcast are out of scope. No YouTube API key is needed for the official IFrame Player API.
