# Splatter League 3D

A browser based first person paintball game. The menu opens in online mode by default. One player hosts a room and shares the displayed Peer ID; other players enter it to join over PeerJS WebRTC. Practice vs bots remains available from the menu.

## Publish on Netlify

1. Put the project in a GitHub repository, including `index.html`, `_redirects`, `paintball.html`, and the complete `models` folder.
2. In Netlify, choose **Add new project → Import an existing project**, connect GitHub, and select the repository.
3. Leave the build command empty and set the publish directory to the repository root (`.`). The included `_redirects` rule serves the game at the root URL; `index.html` is a fallback redirect.
4. Deploy. Open the resulting Netlify HTTPS URL.
5. To play online, one player selects **Play Online → Host a Room → Host Match** and presses **C** to copy the **ROOM CODE** shown at the top, then shares it. Other players select **Play Online → Join a Room**, enter that code, and choose **Join Match**. The host must keep the game open for the room to stay available.

PeerJS Cloud provides signaling by default. Peer-to-peer connections can fail on restrictive networks that require a TURN relay. Netlify hosts the static page and model assets; it does not run the old WebSocket server. Peer hosted rooms are casual and do not provide trusted server-side hit validation.

Three.js and PeerJS are loaded from public CDNs, so browsers need internet access. For local development, run `python3 server.py` and open [http://localhost:8080](http://localhost:8080).

## Controls

- **WASD** move
- **Mouse** aim
- **Hold left mouse button** fire
- **R** refill paint
- **Esc** return to the menu

Practice matches let you select 1v1 through 4v4. Online rooms support up to eight players. The first team to 15 splats wins, or the team ahead when three minutes expire.
