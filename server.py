#!/usr/bin/env python3
"""Splatter League HTTP and WebSocket server. Uses only Python's standard library."""
import base64
import hashlib
import json
import math
import os
import struct
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parent
PORT = int(os.environ.get("PORT", "8080"))
ROOMS = {}
SCORES = {}
LOCK = threading.RLock()
NEXT_ID = 1
GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"


def player_data(client):
    return {"id": client.id, "team": client.team, "x": client.x, "z": client.z,
            "yaw": client.yaw, "pitch": client.pitch}


class Client:
    def __init__(self, handler, player_id):
        self.handler = handler
        self.id = player_id
        self.room = None
        self.team = 0
        self.x = self.z = self.yaw = self.pitch = 0
        self.hp = 100
        self.send_lock = threading.Lock()

    def send(self, message):
        payload = json.dumps(message, separators=(",", ":")).encode("utf-8")
        size = len(payload)
        if size < 126:
            header = bytes((0x81, size))
        elif size < 65536:
            header = bytes((0x81, 126)) + struct.pack("!H", size)
        else:
            header = bytes((0x81, 127)) + struct.pack("!Q", size)
        try:
            with self.send_lock:
                self.handler.wfile.write(header + payload)
                self.handler.wfile.flush()
        except (BrokenPipeError, ConnectionResetError, OSError):
            pass


class GameHandler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):
        print("%s - %s" % (self.address_string(), fmt % args))

    def do_GET(self):
        if self.headers.get("Upgrade", "").lower() == "websocket":
            self.handle_websocket()
            return
        pathname = unquote(urlsplit(self.path).path)
        relative = "paintball.html" if pathname in ("/", "/paintball.html") else pathname.lstrip("/")
        target = (ROOT / relative).resolve()
        if os.path.commonpath((str(ROOT), str(target))) != str(ROOT) or not target.is_file():
            self.send_error(404, "File not found")
            return
        content_type = {".html": "text/html; charset=utf-8", ".glb": "model/gltf-binary",
                        ".gltf": "model/gltf+json", ".js": "text/javascript; charset=utf-8",
                        ".css": "text/css; charset=utf-8"}.get(target.suffix.lower(), "application/octet-stream")
        try:
            body = target.read_bytes()
        except OSError:
            self.send_error(404, "File not found")
            return
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        self.wfile.write(body)

    def handle_websocket(self):
        global NEXT_ID
        key = self.headers.get("Sec-WebSocket-Key")
        if not key:
            self.send_error(400, "Missing WebSocket key")
            return
        accept = base64.b64encode(hashlib.sha1((key + GUID).encode("ascii")).digest()).decode("ascii")
        self.send_response(101, "Switching Protocols")
        self.send_header("Upgrade", "websocket")
        self.send_header("Connection", "Upgrade")
        self.send_header("Sec-WebSocket-Accept", accept)
        self.end_headers()
        with LOCK:
            player_id = f"p{NEXT_ID}"
            NEXT_ID += 1
        client = Client(self, player_id)
        try:
            while True:
                frame = self.read_frame()
                if frame is None:
                    break
                opcode, payload = frame
                if opcode == 8:
                    break
                if opcode == 9:
                    self.write_control_frame(10, payload)
                    continue
                if opcode != 1:
                    continue
                try:
                    message = json.loads(payload.decode("utf-8"))
                except (UnicodeDecodeError, json.JSONDecodeError):
                    continue
                if isinstance(message, dict):
                    self.handle_message(client, message)
        except (ConnectionResetError, BrokenPipeError, OSError):
            pass
        finally:
            self.remove_client(client)

    def read_frame(self):
        first = self.rfile.read(2)
        if len(first) != 2:
            return None
        opcode = first[0] & 0x0F
        masked = bool(first[1] & 0x80)
        length = first[1] & 0x7F
        if length == 126:
            data = self.rfile.read(2)
            if len(data) != 2:
                return None
            length = struct.unpack("!H", data)[0]
        elif length == 127:
            data = self.rfile.read(8)
            if len(data) != 8:
                return None
            length = struct.unpack("!Q", data)[0]
        if length > 1_048_576:
            return None
        mask = self.rfile.read(4) if masked else b""
        payload = self.rfile.read(length)
        if len(payload) != length or (masked and len(mask) != 4):
            return None
        if masked:
            payload = bytes(value ^ mask[i & 3] for i, value in enumerate(payload))
        return opcode, payload

    def write_control_frame(self, opcode, payload):
        try:
            self.wfile.write(bytes((0x80 | opcode, len(payload))) + payload)
            self.wfile.flush()
        except OSError:
            pass

    def handle_message(self, client, message):
        kind = message.get("type")
        if kind == "join":
            if client.room is not None:
                return
            room = str(message.get("room") or "backyard").strip()[:32] or "backyard"
            with LOCK:
                members = ROOMS.setdefault(room, [])
                if len(members) >= 8:
                    client.send({"type": "error", "message": "Room is full"})
                    return
                blue_count = sum(p.team == 0 for p in members)
                red_count = sum(p.team == 1 for p in members)
                client.room = room
                client.team = 0 if blue_count <= red_count else 1
                client.x = -4 if client.team else 4
                client.z = -21 if client.team else 21
                client.yaw = math.pi if client.team else 0
                peers = list(members)
                score = SCORES.setdefault(room, [0, 0])
                client.send({"type": "welcome", "id": client.id, "team": client.team,
                             "players": [player_data(p) for p in peers], "scores": list(score)})
                members.append(client)
            joined = {"type": "joined", "player": player_data(client)}
            for peer in peers:
                peer.send(joined)
            return

        if client.room is None:
            return
        with LOCK:
            members = list(ROOMS.get(client.room, []))
        if kind == "state":
            player = message.get("player")
            if not isinstance(player, dict):
                return
            x, z = player.get("x"), player.get("z")
            if not isinstance(x, (int, float)) or isinstance(x, bool) or not isinstance(z, (int, float)) or isinstance(z, bool):
                return
            client.x = max(-25, min(25, x))
            client.z = max(-23, min(23, z))
            client.yaw = player.get("yaw", 0) if isinstance(player.get("yaw", 0), (int, float)) else 0
            client.pitch = player.get("pitch", 0) if isinstance(player.get("pitch", 0), (int, float)) else 0
            event = {"type": "state", "player": player_data(client)}
            for peer in members:
                if peer is not client:
                    peer.send(event)
        elif kind == "shot":
            origin, direction = message.get("origin"), message.get("direction")
            if not (isinstance(origin, list) and isinstance(direction, list) and len(origin) == 3 and len(direction) == 3):
                return
            if not all(isinstance(v, (int, float)) and math.isfinite(v) for v in origin + direction):
                return
            event = {"type": "shot", "id": client.id, "team": client.team, "origin": origin, "direction": direction}
            for peer in members:
                if peer is not client:
                    peer.send(event)
        elif kind == "hit" and isinstance(message.get("target"), str):
            target = next((peer for peer in members if peer.id == message["target"]), None)
            if target is None or target.team == client.team:
                return
            target.hp -= 34
            if target.hp <= 0:
                target.hp = 100
                with LOCK:
                    score = SCORES.setdefault(client.room, [0, 0])
                    score[client.team] += 1
                    current_score = list(score)
                for peer in members:
                    peer.send({"type": "score", "scores": current_score})
                target.send({"type": "respawn"})
            else:
                target.send({"type": "damage", "hp": target.hp})

    @staticmethod
    def remove_client(client):
        if client.room is None:
            return
        with LOCK:
            members = ROOMS.get(client.room, [])
            remaining = [peer for peer in members if peer is not client]
            room = client.room
            if remaining:
                ROOMS[room] = remaining
            else:
                ROOMS.pop(room, None)
                SCORES.pop(room, None)
        for peer in remaining:
            peer.send({"type": "left", "id": client.id})


if __name__ == "__main__":
    server = ThreadingHTTPServer(("0.0.0.0", PORT), GameHandler)
    print(f"Splatter League is running at http://localhost:{PORT}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nServer stopped.")
        server.server_close()
