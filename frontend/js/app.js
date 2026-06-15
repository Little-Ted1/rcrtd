// 🌐 CONFIGURACIÓN DEL SERVIDOR
const SERVER_URL = "wss://radio-comunitaria-backend.onrender.com/ws"; 

let socket;
let player;
let isInitialSync = true;
let blockNextEvent = false; // Evita bucles infinitos entre eventos de UI y WS

// 📺 1. INICIALIZAR LA API DE YOUTUBE
function onYouTubeIframeAPIReady() {
    player = new YT.Player('yt-player', {
        height: '100%',
        width: '100%',
        videoId: 'dQw4w9WgXcQ', // Video inicial por defecto (Rickroll)
        playerVars: {
            'playsinline': 1,
            'controls': 1,      // Dejamos los controles nativos visibles
            'disablekb': 0
        },
        events: {
            'onReady': onPlayerReady,
            'onStateChange': onPlayerStateChange
        }
    });
}

function onPlayerReady(event) {
    console.log("[📺 Player] API de YouTube lista. Conectando al backend...");
    initWebSocket();
    initUIListeners();
}

// 🔌 2. GESTIÓN DEL WEBSOCKET (TIEMPO REAL)
// REEMPLAZA ESTA FUNCIÓN EN js/app.js
function initWebSocket() {
    socket = new WebSocket(SERVER_URL);
    const statusBadge = document.getElementById("connection-status");

    socket.onopen = () => {
        statusBadge.textContent = "Conectado";
        statusBadge.className = "status-badge connected";
        console.log("[🔌 WS] Conexión establecida.");
    };

    socket.onclose = () => {
        statusBadge.textContent = "Desconectado";
        statusBadge.className = "status-badge disconnected";
        setTimeout(initWebSocket, 5000);
    };

    socket.onmessage = (event) => {
        const message = JSON.parse(event.data);
        console.log("[🔌 WS] Evento recibido:", message);

        switch (message.type) {
            case "SYNC":
                handleSyncEvent(message);
                break;
            case "PLAY":
                handlePlayEvent(message);
                break;
            case "PAUSE":
                handlePauseEvent();
                break;
            case "PLAYLIST_UPDATED": // 📥 NUEVO: Escucha cuando cambia la cola
                updatePlaylistUI(message.playlist);
                break;
            default:
                break;
        }
    };
}

// 🎼 3. LÓGICA DE ORQUESTACIÓN Y SINCRONIZACIÓN
function handleSyncEvent(data) {
    blockNextEvent = true;
    
    // Evitar romper la app si el reproductor no ha cargado los metadatos
    try {
        const currentVideoId = player.getVideoData() ? player.getVideoData()['video_id'] : null;
        if (currentVideoId !== data.video_id) {
            player.cueVideoById({
                videoId: data.video_id,
                startSeconds: data.seek_to
            });
        } else {
            player.seekTo(data.seek_to, true);
        }
    } catch (e) {
        console.log("[⚠️ Sincronización] Esperando inicialización completa del reproductor...");
    }

    if (data.status === "PLAYING") {
        player.playVideo();
    } else {
        player.pauseVideo();
    }
}

function handlePlayEvent(data) {
    blockNextEvent = true;
    player.seekTo(data.seek_to, true);
    player.playVideo();
}

function handlePauseEvent() {
    blockNextEvent = true;
    player.pauseVideo();
}

// 🕹️ 4. CAPTURA DE EVENTOS DEL REPRODUCTOR (Acciones del usuario)
function onPlayerStateChange(event) {
    if (blockNextEvent) {
        blockNextEvent = false;
        return;
    }

    const currentTime = player.getCurrentTime();

    if (event.data === YT.PlayerState.PLAYING) {
        console.log("[🕹️ UI] Usuario presionó PLAY. Notificando...");
        if (socket && socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({
                type: "PLAY",
                seek_to: currentTime
            }));
        }
    } 
    else if (event.data === YT.PlayerState.PAUSED) {
        console.log("[🕹️ UI] Usuario presionó PAUSA. Notificando...");
        if (socket && socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({
                type: "PAUSE",
                seek_to: currentTime
            }));
        }
    }
}

// 🎛️ 5. INTERFAZ DE USUARIO (UI CONTROLS)
function initUIListeners() {
    document.getElementById("btn-sync").addEventListener("click", () => {
        console.log("[🎛️ UI] Solicitando resincronización manual...");
        if (socket && socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ type: "PLAY", seek_to: player.getCurrentTime() })); 
        }
    });

    document.getElementById("btn-play-pause").addEventListener("click", () => {
        const state = player.getPlayerState();
        if (state === YT.PlayerState.PLAYING) {
            player.pauseVideo();
        } else {
            player.playVideo();
        }
    });

    document.getElementById("btn-add-track").addEventListener("click", () => {
        const urlInput = document.getElementById("youtube-url");
        const url = urlInput.value.trim();
        
        if (url) {
            const videoId = extractYouTubeId(url);
            if (videoId) {
                console.log("[🎛️ UI] Enviando nuevo video a la playlist:", videoId);
                if (socket && socket.readyState === WebSocket.OPEN) {
                    socket.send(JSON.stringify({
                        type: "ADD_TO_PLAYLIST",
                        video_id: videoId
                    }));
                    urlInput.value = "";
                } else {
                    alert("⚠️ No estás conectado al servidor en tiempo real.");
                }
            } else {
                alert("⚠️ Por favor, ingresa una URL de YouTube válida.");
            }
        }
    });
}


// 🛠️ UTILIDAD: Extractor de IDs de YouTube mediante Regex seguro
function extractYouTubeId(url) {
    const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/;
    const match = url.match(regExp);
    return (match && match[2].length === 11) ? match[2] : null;
}
function updatePlaylistUI(playlist) {
    const queueList = document.getElementById("playlist-queue");
    queueList.innerHTML = ""; // Limpia la lista actual

    if (!playlist || playlist.length === 0) {
        queueList.innerHTML = '<li class="empty-msg">No hay canciones en la cola</li>';
        return;
    }

    // Inyecta dinámicamente cada video en el HTML de la barra lateral
    playlist.forEach((videoId, index) => {
        const li = document.createElement("li");
        li.className = "queue-item";
        li.style.padding = "10px";
        li.style.marginBottom = "5px";
        li.style.backgroundColor = "var(--bg-card)";
        li.style.borderRadius = "6px";
        li.style.fontSize = "0.85rem";
        li.style.display = "flex";
        li.style.justifyContent = "space-between";
        li.innerHTML = `<span>🎵 Canción #${index + 1} (${videoId})</span>`;
        queueList.appendChild(li);
    });
}
