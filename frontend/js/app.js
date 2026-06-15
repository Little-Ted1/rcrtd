const SERVER_URL = "wss://radio-comunitaria-backend.onrender.com/ws"; 

let socket;
let player;
let blockNextEvent = false;
let lastKnownTime = 0;
let userIsSeeking = false; // Candado para evitar el bucle de rebote en los saltos de barra

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
    console.log("[📺 Player] API de YouTube lista. Optimizada para red.");
    initWebSocket();
    initUIListeners();
    
    // Detector de arrastre de barra de tiempo (Seek) con candado anti-rebote
    setInterval(() => {
        if (!player || typeof player.getCurrentTime !== 'function') return;
        const currentTime = player.getCurrentTime();
        
        if (player.getPlayerState() === YT.PlayerState.PLAYING && !blockNextEvent && !userIsSeeking) {
            // Si el salto es mayor a 2 segundos, es una acción humana real en la barra
            if (Math.abs(currentTime - lastKnownTime) > 2.0) {
                console.log("[🕹️ Local] Salto detectado. Bloqueando ruidos de red...");
                userIsSeeking = true;
                
                if (socket && socket.readyState === WebSocket.OPEN) {
                    socket.send(JSON.stringify({ type: "SEEK_GLOBAL", seek_to: currentTime }));
                }
                
                // Desbloqueamos el candado después de 1200ms para dar tiempo a que la API asiente el búfer
                setTimeout(() => { userIsSeeking = false; }, 1200);
            }
        }
        lastKnownTime = currentTime;
    }, 400);
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
        console.log("[🔌 WS] Comando:", message);

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

function executeRemoteCommand(data) {
    blockNextEvent = true;
    
    try {
        const currentVideoId = player.getVideoData() ? player.getVideoData()['video_id'] : null;
        
        // 🔄 Si cambia el video, forzamos carga limpia
        if (data.video_id && currentVideoId !== data.video_id) {
            player.loadVideoById({
                videoId: data.video_id,
                startSeconds: data.seek_to || 0
            });
            return;
        }

        // 🎯 AJUSTE DE PRECISIÓN SENIOR: Reducimos el margen a solo 1.2 segundos.
        // Si el desfase de red supera un segundo, reajustamos el reproductor de inmediato.
        if (typeof data.seek_to !== 'undefined') {
            const currentPos = player.getCurrentTime();
            if (Math.abs(currentPos - data.seek_to) > 1.2) {
                console.log("[🎯 Ajuste Fino] Aplicando seek corrector a:", data.seek_to);
                player.seekTo(data.seek_to, true);
            }
        }

        player.playVideo();
    } catch (e) {
        console.error("Error en comando remoto:", e);
    }
}

function onPlayerStateChange(event) {
    if (blockNextEvent) {
        if (event.data === YT.PlayerState.PLAYING || event.data === YT.PlayerState.PAUSED) {
            blockNextEvent = false;
        }
        return;
    }

    if (!socket || socket.readyState !== WebSocket.OPEN) return;

    if (event.data === YT.PlayerState.ENDED) {
        socket.send(JSON.stringify({ type: "NEXT_TRACK" }));
    } 
    else if (event.data === YT.PlayerState.PLAYING) {
        // Al dar play, si no estamos haciendo un seek manual, pedimos la hora exacta en vivo
        if (!userIsSeeking) {
            console.log("[🕹️ Local] Reanudando y acoplándose a la sala en vivo.");
            socket.send(JSON.stringify({ type: "REQUEST_LIVE_TIME" }));
        }
    }
}

function initUIListeners() {
    // El botón manual ahora ejecuta una petición directa de tiempo en vivo libre de caché
    document.getElementById("btn-sync").addEventListener("click", () => {
        if (socket && socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ type: "REQUEST_LIVE_TIME" })); 
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
        const videoId = extractYouTubeId(urlInput.value.trim());
        
        if (videoId && socket && socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ type: "ADD_TO_PLAYLIST", video_id: videoId }));
            urlInput.value = "";
        } else {
            alert("Enlace inválido o error de red.");
        }
    });

    document.getElementById("btn-next").addEventListener("click", () => {
        if (socket && socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ type: "NEXT_TRACK" }));
        }
    });

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
