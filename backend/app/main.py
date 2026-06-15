import time
import json
from typing import List
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="Radio Comunitaria Streaming - Backend")

# 🔒 SEGURIDAD: CORS (Permite conexiones locales por ahora)
ORIGINS = [
    "http://localhost:5500",
    "http://127.0.0.1:5500",
    "http://localhost:3000",
    "https://little-ted1.github.io/rcrtd/" # GitHub Pages
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class ConnectionManager:
    def __init__(self):
        self.active_connections: List[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket):
        self.active_connections.remove(websocket)

    async def broadcast(self, message: dict):
        payload = json.dumps(message)
        for connection in self.active_connections:
            try:
                await connection.send_text(payload)
            except Exception:
                pass

manager = ConnectionManager()

room_state = {
    "current_video": "dQw4w9WgXcQ", # Rickroll por defecto
    "status": "PAUSED",
    "start_time": 0.0,
    "pause_offset": 0.0,
    "playlist": []
}

def get_current_video_position() -> float:
    if room_state["status"] == "PLAYING":
        return time.time() - room_state["start_time"]
    return room_state["pause_offset"]

@app.get("/")
def read_root():
    return {"status": "online", "message": "Director de Orquesta listo"}

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    
    initial_sync = {
        "type": "SYNC",
        "video_id": room_state["current_video"],
        "status": room_state["status"],
        "seek_to": get_current_video_position()
    }
    await websocket.send_text(json.dumps(initial_sync))

    try:
        while True:
            data = await websocket.receive_text()
            event = json.loads(data)
            event_type = event.get("type")

            if event_type == "PLAY":
                room_state["status"] = "PLAYING"
                room_state["start_time"] = time.time() - event.get("seek_to", 0.0)
                await manager.broadcast({
                    "type": "PLAY",
                    "seek_to": get_current_video_position()
                })

            elif event_type == "PAUSE":
                if room_state["status"] == "PLAYING":
                    room_state["status"] = "PAUSED"
                    room_state["pause_offset"] = time.time() - room_state["start_time"]
                await manager.broadcast({
                    "type": "PAUSE",
                    "seek_to": room_state["pause_offset"]
                })

    except WebSocketDisconnect:
        manager.disconnect(websocket)
    except Exception:
        manager.disconnect(websocket)
