# Splatter League 3D

A browser based first person paintball game. The menu opens in online mode by default. One player hosts a room and shares the four-character room code; other players enter it to join over PeerJS WebRTC. Practice vs bots remains available from the menu.

## Publish on Netlify

1. Put the project in a GitHub repository, including `index.html`, `_redirects`, `paintball.html`, and the complete `models` folder.
2. In Netlify, choose **Add new project → Import an existing project**, connect GitHub, and select the repository.
3. Leave the build command empty and set the publish directory to the repository root (`.`). The included `_redirects` rule serves the game at the root URL; `index.html` is a fallback redirect.
4. Deploy. Open the resulting Netlify HTTPS URL.
5. To play online, one player selects **Play Online → Host a Room → Host Match** and presses **C** to copy the **ROOM CODE** shown at the top, then shares it. Other players select **Play Online → Join a Room**, enter that code, and choose **Join Match**. The host waits in the lobby without moving; the timer starts when the first guest joins. The host must keep the game open for the room to stay available.

PeerJS Cloud provides signaling by default. The game gets short-lived Cloudflare TURN credentials from the Netlify Function at `/.netlify/functions/turn-ice`. Set it up like this:

1. Sign in to [Cloudflare](https://dash.cloudflare.com/) or create an account. Open **Calls → TURN** and create a TURN key. Copy its **Key ID** and **Key token/secret** when Cloudflare shows them. The key token is a server secret; do not put it in `paintball.html` or another public file.
2. In Netlify, open your site’s **Project configuration → Environment variables**. Add these two variables:
   - `CLOUDFLARE_TURN_KEY_ID` = the Cloudflare TURN key ID.
   - `CLOUDFLARE_TURN_KEY_API_TOKEN` = the TURN key's token/secret (not a general Cloudflare API token).
3. If you previously added `METERED_TURN_CREDENTIAL_URL`, remove it. This version uses Cloudflare.
4. Trigger a new Netlify deploy so the function can read the variables.
5. Open `https://YOUR-SITE/.netlify/functions/turn-ice`. It should return a JSON array containing `turn:` or `turns:` server URLs and temporary credentials. These credentials expire after 24 hours.
6. Reload the game for both players, then host a fresh room and join with its new code.

The Netlify Function keeps the long-lived TURN key on the server and returns only expiring ICE credentials to the browser. Cloudflare currently lists 1,000 GB per month free for Realtime TURN/SFU usage, then $0.05 per GB; TURN traffic counts toward this allowance. Netlify hosts the static page and function; it does not run the old WebSocket server. Peer hosted rooms are casual and do not provide trusted server-side hit validation.

Three.js and PeerJS are loaded from public CDNs, so browsers need internet access. For local development, run `python3 server.py` and open [http://localhost:8080](http://localhost:8080).

## Controls

- **WASD** move
- **Mouse** aim
- **Hold left mouse button** fire
- **R** refill paint
- **Esc** return to the menu

Practice matches let you select 1v1 through 4v4. Online rooms support up to eight players. The first team to 15 splats wins, or the team ahead when three minutes expire.
