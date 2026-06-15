const SERVER_URL = "wss://radio-comunitaria-backend.onrender.com/ws"; 

let socket;
let player;
let blockNextEvent = false;
let lastKnownTime = 0;
let seekCheckInterval;

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
    console.log("[📺 Player] API de YouTube lista.");
    initWebSocket();
    initUIListeners();
    
    // Monitoreo constante para detectar si el usuario arrastra la barra de reproducción (Seek)
    setInterval(() => {
        if (!player || typeof player.getCurrentTime !== 'function') return;
        const currentTime = player.getCurrentTime();
        
        // Si el reproductor está sonando y el tiempo salta bruscamente más de 2 segundos...
        if (player.getPlayerState() === YT.PlayerState.PLAYING && !blockNextEvent) {
            if (Math.abs(currentTime - lastKnownTime) > 2.5) {
                console.log("[🕹️ Local] Salto detectado (Seek) hacia el segundo:", currentTime);
                if (socket && socket.readyState === WebSocket.OPEN) {
                    socket.send(JSON.stringify({ type: "SEEK_GLOBAL", seek_to: currentTime }));
                }
            }
        }
        lastKnownTime = currentTime;
    }, 500);
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
        console.log("[🔌 WS] Comando recibido:", message);

        switch (message.type) {
            case "SYNC":
                if (message.playlist) updatePlaylistUI(message.playlist);
                executeRemoteCommand(message);
                break;
            case "FORCE_PLAY":
                executeRemoteCommand(message);
                break;
            case "FORCE_PAUSE":
                blockNextEvent = true;
                player.pauseVideo();
                break;
            case "FORCE_SEEK":
                blockNextEvent = true;
                player.seekTo(message.seek_to, true);
                break;
            case "PLAYLIST_UPDATED":
                updatePlaylistUI(message.playlist);
                break;
        }
    };
}

// Ejcutor central de comandos remotos (Evita bucles de retroalimentación)
function executeRemoteCommand(data) {
    blockNextEvent = true;
    
    try {
        const currentVideoId = player.getVideoData() ? player.getVideoData()['video_id'] : null;
        
        // Cambiar canción de ser necesario
        if (data.video_id && currentVideoId !== data.video_id) {
            player.loadVideoById({
                videoId: data.video_id,
                startSeconds: data.seek_to || 0
            });
            return;
        }

        // Sincronizar segundo exacto si hay desfase
        if (typeof data.seek_to !== 'undefined') {
            const currentPos = player.getCurrentTime();
            if (Math.abs(currentPos - data.seek_to) > 3) {
                player.seekTo(data.seek_to, true);
            }
        }

        player.playVideo();
    } catch (e) {
        console.error("Error en comando remoto:", e);
    }
}

function onPlayerStateChange(event) {
    // Si la acción fue gatillada por órdenes del servidor, la consumimos e ignoramos
    if (blockNextEvent) {
        if (event.data === YT.PlayerState.PLAYING || event.data === YT.PlayerState.PAUSED) {
            blockNextEvent = false;
        }
        return;
    }

    if (!socket || socket.readyState !== WebSocket.OPEN) return;

    if (event.data === YT.PlayerState.ENDED) {
        console.log("[🕹️ Local] Video finalizado de forma natural.");
        socket.send(JSON.stringify({ type: "NEXT_TRACK" }));
    } 
    else if (event.data === YT.PlayerState.PLAYING) {
        // REGLA 2: Cuando el usuario reanuda (Play), le pide al servidor la hora exacta en vivo
        console.log("[🕹️ Local] Usuario solicita acoplarse al tiempo en vivo de la sala.");
        socket.send(JSON.stringify({ type: "REQUEST_LIVE_TIME" }));
    }
    // REGLA 1 INVISBLE: Si presiona PAUSA, no enviamos nada al WebSocket. Sus amigos siguen escuchando en paz.
}

function initUIListeners() {
    // Forzar resincronización manual (Botón de auxilio)
    document.getElementById("btn-sync").addEventListener("click", () => {
        if (socket && socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ type: "REQUEST_LIVE_TIME" })); 
        }
    });

    // Botón Play/Pause de la UI
    document.getElementById("btn-play-pause").addEventListener("click", () => {
        const state = player.getPlayerState();
        if (state === YT.PlayerState.PLAYING) {
            player.pauseVideo(); // Pausa local, no afecta al resto
        } else {
            player.playVideo();  // Solicita tiempo en vivo y se acopla
        }
    });

    // Añadir pista
    document.getElementById("btn-add-track").addEventListener("click", () => {
        const urlInput = document.getElementById("youtube-url");
        const videoId = extractYouTubeId(urlInput.value.trim());
        
        if (videoId && socket && socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ type: "ADD_TO_PLAYLIST", video_id: videoId }));
            urlInput.value = "";
        } else {
            alert("Enlace inválido o error de red.");
        }
    });

    // Saltar pista manual
    document.getElementById("btn-next").addEventListener("click", () => {
        if (socket && socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ type: "NEXT_TRACK" }));
        }
    });

    // Vaciar cola
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
