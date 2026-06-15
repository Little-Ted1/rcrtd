// 🌐 CONFIGURACIÓN DEL SERVIDOR
// Reemplaza con tu URL de Render (Ej: 'radio-backend.onrender.com')
const SERVER_URL = "ws://localhost:8000/ws"; // En producción usa: wss://tu-app-en-render.onrender.com/ws

let socket;
let player;
let isInitialSync = true;
let blockNextEvent = false; // Evita bucles infinitos entre eventos de UI y WS

// 📺 1. INICIALIZAR LA API DE YOUTUBE
// Esta función la llama automáticamente el script de YouTube que cargamos en el HTML
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
function initWebSocket() {
    socket = new WebSocket(SERVER_URL);
    const statusBadge = document.getElementById("connection-status");

    socket.onopen = () => {
        statusBadge.textContent = "Conectado";
        statusBadge.className = "status-badge connected";
        console.log("[🔌 WS] Conexión establecida con el Director de Orquesta.");
    };

    socket.onclose = () => {
        statusBadge.textContent = "Desconectado";
        statusBadge.className = "status-badge disconnected";
        console.log("[🔌 WS] Conexión perdida. Reintentando en 5 segundos...");
        setTimeout(initWebSocket, 5000); // Auto-reconexión robusta
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
            default:
                break;
        }
    };
}

// 🎼 3. LÓGICA DE ORQUESTACIÓN Y SINCRONIZACIÓN
function handleSyncEvent(data) {
    // Si es un usuario nuevo o reconexión, sincroniza video y segundo exacto
    blockNextEvent = true;
    
    // Carga el video si es diferente al actual
    const currentVideoId = player.getVideoData()['video_id'];
    if (currentVideoId !== data.video_id) {
        player.cueVideoById({
            videoId: data.video_id,
            startSeconds: data.seek_to
        });
    } else {
        player.seekTo(data.seek_to, true);
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
    // Si el cambio de estado fue provocado por una orden del servidor, la ignoramos para no retransmitir
    if (blockNextEvent) {
        blockNextEvent = false;
        return;
