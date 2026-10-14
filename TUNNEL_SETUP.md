# Fixed watch address on a Windows laptop

The intended setup is `https://watch.chaigallery.in` → Cloudflare named tunnel → `http://127.0.0.1:3001`. This keeps the existing main domain and other apps separate. It needs no router port forwarding or fixed public IP. The laptop must stay awake and connected; this setup does not change Windows power settings.

## One-time setup

1. Install the official client: `winget install --id Cloudflare.cloudflared --exact`.
2. Build this app: `npm install` then `npm run build`.
3. In Cloudflare **Networking → Tunnels**, create `sidebyside-watch`. Install/run its connector on this laptop. Under Routes add a **Published application** with hostname `watch.chaigallery.in` and service `http://127.0.0.1:3001`. Do not add private network, SSH, desktop or whole-network routes. Confirm no existing DNS record uses that hostname before creating it.
4. In PowerShell from this project, run:

   ```powershell
   .\scripts\setup-watch.ps1 -Hostname watch.chaigallery.in -StartNow
   ```

   Paste **only the tunnel token** at the hidden prompt. Do not paste it into chat, source files, command arguments or GitHub. This token grants connection access to this tunnel. The setup stores it under the git-ignored `.local/` directory, with Windows file permissions restricted to the current user. This is an access-controlled plaintext file, not encrypted storage. Rotate the token in Cloudflare if it is exposed.

5. Open the public address, create a room, and share the room invitation. Both people should use the public address. Localhost is only for local diagnostics.

## Automatic startup and control

Setup adds `Side by Side Watch.lnk` to the **current user's Windows Startup folder**. It starts a supervisor at sign-in; the supervisor starts the Node server and tunnel and retries crashed processes with backoff. This works after you sign in, not before login. Restarting the server loses in-memory rooms and chat. A new room is needed after a laptop restart.

```powershell
.\scripts\control-watch.ps1 status
.\scripts\control-watch.ps1 start
.\scripts\control-watch.ps1 stop
.\scripts\control-watch.ps1 disable-startup
```

Logs are in `.local/logs/`. They are local diagnostics, never committed. Keep this project directory and installed Node/cloudflared paths unchanged; rerun setup after moving them. Stop the supervisor before `npm run dev` or manually running a second server on port 3001. Update the production bundle with `npm run build`, then stop/start the supervisor to apply server changes.

The supervisor binds Node to **127.0.0.1** and allows only the configured public origin plus localhost diagnostics. The tunnel forwards only this app, including `/socket` WebSockets. Public visitors can reach the landing page; room access uses private invite credentials. There is no Cloudflare Access login layer in this setup. YouTube sends media independently to each browser; the tunnel carries the app, room state and chat.

## Completion status

Configured on 14 October 2026 on this laptop: the `sidebyside-watch` named tunnel is connected, the `watch.chaigallery.in` published route and proxied DNS CNAME are created, the private local token is installed, and the current user's hidden startup launcher is enabled. The main domain's existing records were preserved.

Verified public HTTPS, WSS, room creation/join, origin rejection, shared control messages, chat and reconnect recovery with `node scripts/verify-public.mjs https://watch.chaigallery.in`. Real YouTube playback was checked in Chrome on the public hostname. The installed startup launcher was invoked after stopping the supervisor and restarted both processes. A real Windows reboot/sign-in cycle was not performed. Fourteen automated tests passed, including supervisor crash restart, duplicate-instance handling and clean shutdown. Two physical devices on different networks and differing ads still need a manual pilot.

For a fresh laptop, the scripts alone do not create the Cloudflare tunnel, DNS route or token, and do not enable startup until setup succeeds. Follow the one-time setup section rather than copying machine-private `.local/` files into Git.
