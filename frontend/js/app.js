const SERVER_URL = "wss://radio-comunitaria-backend.onrender.com/ws"; 

let socket;
let player;
let blockNextEvent = false;

function onYouTubeIframeAPIReady() {
    player = new YT.Player('yt-player', {
        height: '100%',
        width: '100%',
        videoId: 'dQw4w9WgXcQ',
        playerVars: { 'playsinline': 1, 'controls': 1, 'disablekb': 0 },
        events: {
            'onReady': onPlayerReady,
            'onStateChange': onPlayerStateChange
        }
    });
}

function onPlayerReady(event) {
    console.log("[📺 Player] API Lista.");
    initWebSocket();
    initUIListeners();
}

function initWebSocket() {
    socket = new WebSocket(SERVER_URL);
    const statusBadge = document.getElementById("connection-status");

    socket.onopen = () => {
        statusBadge.textContent = "Conectado";
        statusBadge.className = "status-badge connected";
    };

    socket.onclose = () => {
        statusBadge.textContent = "Desconectado";
        statusBadge.className = "status-badge disconnected";
        setTimeout(initWebSocket, 4000);
    };

    socket.onmessage = (event) => {
        const message = JSON.parse(event.data);
        console.log("[🔌 WS] Recibido:", message);

        switch (message.type) {
            case "SYNC":
                if (message.playlist) updatePlaylistUI(message.playlist);
                handleRemoteControl(message);
                break;
            case "PLAY":
            case "PAUSE":
                handleRemoteControl(message);
                break;
            case "PLAYLIST_UPDATED":
                updatePlaylistUI(message.playlist);
                break;
        }
    };
}

// 🎼 CONTROL CENTRALIZADO: Procesa las órdenes del servidor sin generar bucles
function handleRemoteControl(data) {
    blockNextEvent = true; // Bloqueamos el próximo evento local para no retransmitir al servidor
    
    try {
        const currentVideoId = player.getVideoData() ? player.getVideoData()['video_id'] : null;
        
        // Si el servidor indica un video diferente, lo cambiamos a la fuerza
        if (data.video_id && currentVideoId !== data.video_id) {
            player.loadVideoById({
                videoId: data.video_id,
                startSeconds: data.seek_to || 0
            });
            if (data.status === "PAUSED") {
                setTimeout(() => { player.pauseVideo(); }, 500);
            }
            return;
        }

        // Ajustamos el segundo exacto
        if (typeof data.seek_to !== 'undefined') {
            const currentPos = player.getCurrentTime();
            if (Math.abs(currentPos - data.seek_to) > 2) { // Solo salta si el desfase es mayor a 2 segundos
                player.seekTo(data.seek_to, true);
            }
        }

        // Aplicamos Play o Pause según ordene el Director de Orquesta
        if (data.type === "PLAY" || data.status === "PLAYING") {
            player.playVideo();
        } else if (data.type === "PAUSE" || data.status === "PAUSED") {
            player.pauseVideo();
        }
    } catch (e) {
        console.error("Error en sincronización remota:", e);
    }
}

// MODIFICA ESTA FUNCIÓN EN TU js/app.js
function onPlayerStateChange(event) {
    if (blockNextEvent) {
        blockNextEvent = false;
        return;
    }

    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    const currentTime = player.getCurrentTime();

    if (event.data === YT.PlayerState.ENDED) {
        console.log("[🕹️ Local] Canción terminada.");
        socket.send(JSON.stringify({ type: "NEXT_TRACK" }));
    } 
    else if (event.data === YT.PlayerState.PLAYING) {
        // CORRECCIÓN: Al dar PLAY, mandamos un evento especial solicitando el tiempo real de la sala
        socket.send(JSON.stringify({ type: "REQUEST_CURRENT_TIME" }));
    } 
    else if (event.data === YT.PlayerState.PAUSED) {
        // Nota: Si quieres que tu pausa no detenga a tus amigos, puedes comentar esta línea.
        // Si la dejas, pausarás la sala completa para todos.
        socket.send(JSON.stringify({ type: "PAUSE", seek_to: currentTime }));
    }
}

function initUIListeners() {
    // Forzar sincronización manual
    document.getElementById("btn-sync").addEventListener("click", () => {
        console.log("[🎛️ UI] Forzando resincronización con el servidor...");
        if (socket && socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ type: "REQUEST_CURRENT_TIME" })); 
        }
    });

    // Botón Play/Pause alternativo
    document.getElementById("btn-play-pause").addEventListener("click", () => {
        const state = player.getPlayerState();
        if (state === YT.PlayerState.PLAYING) {
            player.pauseVideo();
        } else {
            player.playVideo();
        }
    });

    // Añadir canción
    document.getElementById("btn-add-track").addEventListener("click", () => {
        const urlInput = document.getElementById("youtube-url");
        const videoId = extractYouTubeId(urlInput.value.trim());
        
        if (videoId && socket && socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ type: "ADD_TO_PLAYLIST", video_id: videoId }));
            urlInput.value = "";
        } else {
            alert("URL inválida o sin conexión.");
        }
    });

    // ⏭️ NUEVO: Botón de Siguiente Canción Manual en el Panel de Controles
    document.getElementById("btn-next").addEventListener("click", () => {
        if (socket && socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ type: "NEXT_TRACK" }));
        }
    });

    // 🗑️ NUEVO: Botón de Vaciar Lista en el Panel de Controles
    document.getElementById("btn-clear").addEventListener("click", () => {
        if (socket && socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ type: "CLEAR_PLAYLIST" }));
        }
    });
}

function extractYouTubeId(url) {
    const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/;
    const match = url.match(regExp);
    return (match && match[2].length === 11) ? match[2] : null;
}

function updatePlaylistUI(playlist) {
    const queueList = document.getElementById("playlist-queue");
    queueList.innerHTML = "";

    if (!playlist || playlist.length === 0) {
        queueList.innerHTML = '<li class="empty-msg">No hay canciones en la cola</li>';
        return;
    }

    playlist.forEach((videoId, index) => {
        const li = document.createElement("li");
        li.style.padding = "10px";
        li.style.marginBottom = "5px";
        li.style.backgroundColor = "var(--bg-card)";
        li.style.borderRadius = "6px";
        li.style.fontSize = "0.85rem";
        li.innerHTML = `🎵 #${index + 1} (${videoId})`;
        queueList.appendChild(li);
    });
}
