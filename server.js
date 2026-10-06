// Web server and WebSocket relay for Splatter League. Run with: npm install && npm start
const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');
const port = Number(process.env.PORT) || 8080;
const page = path.join(__dirname, 'paintball.html');
const server = http.createServer((req, res) => {
  let pathname;
  try { pathname = decodeURIComponent(new URL(req.url, `http://${req.headers.host || 'localhost'}`).pathname); }
  catch { res.writeHead(400); res.end('Bad request'); return; }
  if (pathname === '/.netlify/functions/turn-ice') {
    if (req.method !== 'GET') {
      res.writeHead(405, { 'Content-Type': 'application/json; charset=utf-8', Allow: 'GET' });
      res.end(JSON.stringify({ error: 'Method not allowed.' }));
      return;
    }
    const keyId = process.env.CLOUDFLARE_TURN_KEY_ID;
    const keyToken = process.env.CLOUDFLARE_TURN_KEY_API_TOKEN;
    const reply = (status, body, headers = {}) => {
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...headers });
      res.end(JSON.stringify(body));
    };
    if (!keyId || !keyToken) {
      reply(503, { error: 'Cloudflare TURN credentials are not configured.' });
      return;
    }
    if (!/^[a-f\d]{32}$/i.test(keyId)) {
      reply(500, { error: 'Cloudflare TURN key ID is invalid.' });
      return;
    }
    void (async () => {
      try {
        const response = await fetch(
          `https://rtc.live.cloudflare.com/v1/turn/keys/${keyId}/credentials/generate-ice-servers`,
          {
            method: 'POST',
            headers: {
              authorization: `Bearer ${keyToken}`,
              'content-type': 'application/json',
              accept: 'application/json',
            },
            body: JSON.stringify({ ttl: 86400 }),
          },
        );
        if (!response.ok) {
          reply(502, { error: `Cloudflare TURN returned ${response.status}. Check the key ID and key token.` });
          return;
        }
        const result = await response.json();
        const iceServers = result.iceServers;
        const hasTurnServer = Array.isArray(iceServers) && iceServers.some(item => {
          const urls = Array.isArray(item.urls) ? item.urls : [item.urls];
          return urls.some(url => typeof url === 'string' && /^(turn|turns):/i.test(url));
        });
        if (!hasTurnServer) {
          reply(502, { error: 'Cloudflare returned no TURN relay servers.' });
          return;
        }
        reply(200, iceServers, { 'Cache-Control': 'no-store, max-age=0' });
      } catch {
        reply(502, { error: 'Could not reach Cloudflare TURN.' });
      }
    })();
    return;
  }
  if (req.method !== 'GET') {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('Not found'); return;
  }
  if (pathname.startsWith('/models/')) {
    const assetDir = path.join(__dirname, 'models');
    const asset = path.resolve(__dirname, `.${pathname}`);
    if (!asset.startsWith(`${assetDir}${path.sep}`)) { res.writeHead(403); res.end('Forbidden'); return; }
    fs.readFile(asset, (error, data) => {
      if (error) { res.writeHead(error.code === 'ENOENT' ? 404 : 500, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('Could not load model'); return; }
      const type = path.extname(asset).toLowerCase() === '.glb' ? 'model/gltf-binary' : 'model/gltf+json';
      res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache' }); res.end(data);
    });
    return;
  }
  if (pathname !== '/' && pathname !== '/paintball.html') {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('Not found'); return;
  }
  fs.readFile(page, (error, html) => {
    if (error) { res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('Could not load game page'); return; }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' }); res.end(html);
  });
});
const wss = new WebSocket.Server({ server });
const rooms = new Map();
let nextId = 1;
function send(ws, data) { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data)); }
function playerData(p) { return { id:p.id, team:p.team, x:p.x, z:p.z, yaw:p.yaw||0, pitch:p.pitch||0 }; }
wss.on('connection', ws => {
  ws.id = `p${nextId++}`;
  ws.on('message', raw => {
    let m; try { m = JSON.parse(raw); } catch { return; }
    if (m.type === 'join') {
      if (ws.room) return;
      const room = String(m.room || 'backyard').trim().slice(0, 32);
      let list = rooms.get(room); if (!list) rooms.set(room, list = []);
      if (list.length >= 8) return send(ws, { type: 'error', message: 'Room is full' });
      ws.room = room; ws.team = list.filter(p => p.team === 0).length <= list.filter(p => p.team === 1).length ? 0 : 1;
      ws.x = ws.team ? -4 : 4; ws.z = ws.team ? -21 : 21; ws.yaw = ws.team ? Math.PI : 0; ws.pitch = 0;
      const player = playerData(ws);
      send(ws, { type: 'welcome', id: ws.id, team:ws.team, players: list.map(playerData), scores: rooms.get(`${room}:scores`) || [0,0] });
      list.forEach(p => send(p, { type: 'joined', player })); list.push(ws); rooms.set(room, list); return;
    }
    if (!ws.room) return;
    const list = rooms.get(ws.room) || [];
    if (m.type === 'state' && m.player && Number.isFinite(m.player.x) && Number.isFinite(m.player.z)) {
      ws.x = Math.max(-25, Math.min(25, m.player.x)); ws.z = Math.max(-23, Math.min(23, m.player.z));
      ws.yaw = Number(m.player.yaw)||0; ws.pitch = Number(m.player.pitch)||0;
      list.forEach(p => { if (p !== ws) send(p, { type:'state', player:playerData(ws) }); });
    } else if (m.type === 'shot' && Array.isArray(m.origin) && Array.isArray(m.direction) && m.origin.concat(m.direction).every(Number.isFinite)) {
      list.forEach(p => { if (p !== ws) send(p, { type:'shot', id:ws.id, team:ws.team, origin:m.origin, direction:m.direction }); });
    } else if (m.type === 'hit' && typeof m.target === 'string') {
      const target=list.find(p=>p.id===m.target);
      if (target && target.team!==ws.team) {
        target.hp=(target.hp||100)-34;
        if (target.hp<=0) {
          target.hp=100;
          const scores=rooms.get(`${ws.room}:scores`)||[0,0]; scores[ws.team]++; rooms.set(`${ws.room}:scores`,scores);
          list.forEach(p=>send(p,{type:'score',scores}));
          send(target,{type:'respawn'});
        } else send(target,{type:'damage',hp:target.hp});
      }
    }
  });
  ws.on('close', () => {
    if (!ws.room) return; const list = rooms.get(ws.room); if (!list) return;
    const remaining = list.filter(p => p !== ws); if (remaining.length) { rooms.set(ws.room, remaining); remaining.forEach(p => send(p, { type:'left', id:ws.id })); } else { rooms.delete(ws.room); rooms.delete(`${ws.room}:scores`); }
  });
});
server.listen(port, '0.0.0.0', () => console.log(`Splatter League website listening on http://0.0.0.0:${port}`));
