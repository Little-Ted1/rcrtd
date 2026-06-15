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
        "seek_to": get_current_video_position(),
        "playlist": room_state["playlist"]
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
                
                # Si el evento PLAY trae un video_id nuevo (desde la playlist), lo actualizamos
                if event.get("video_id"):
                    room_state["current_video"] = event.get("video_id")

                await manager.broadcast({
                    "type": "PLAY",
                    "video_id": room_state["current_video"], # Enviamos siempre el video activo
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

            elif event_type == "ADD_TO_PLAYLIST":
                video_id = event.get("video_id")
                if video_id:
                    # REGLA SENIOR: Si la lista está vacía, esta canción toma el control de inmediato,
                    # sin importar si el video por defecto se estaba reproduciendo o no.
                    if len(room_state["playlist"]) == 0 and room_state["current_video"] == "dQw4w9WgXcQ":
                        room_state["current_video"] = video_id
                        room_state["status"] = "PLAYING"
                        room_state["start_time"] = time.time()
                        
                        # Transmitimos la orden de reproducir el nuevo video al instante
                        await manager.broadcast({
                            "type": "PLAY",
                            "video_id": video_id,
                            "seek_to": 0.0
                        })
                    else:
                        # Si ya había canciones en espera o ya se estaba reproduciendo música real,
                        # simplemente se acumula en la cola
                        room_state["playlist"].append(video_id)
                    
                    # Actualizamos la lista visual en la barra lateral para todos
                    await manager.broadcast({
                        "type": "PLAYLIST_UPDATED",
                        "playlist": room_state["playlist"]
                    })

    except WebSocketDisconnect:
        manager.disconnect(websocket)
    except Exception:
        manager.disconnect(websocket)
