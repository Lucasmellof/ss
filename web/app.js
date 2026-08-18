(() => {
  "use strict";

  const $ = (selector) => document.querySelector(selector);
  const params = new URLSearchParams(window.location.search);

  const state = {
    mode: params.get("mode") === "watch" ? "watch" : "broadcast",
    room: params.get("room") || randomRoom(),
    ws: null,
    pc: null,
    localStream: null,
    remoteStream: null,
    stopping: false,
  };

  const setupCard = $("#setup-card");
  const stageCard = $("#stage-card");
  const form = $("#setup-form");
  const roomInput = $("#room-input");
  const frameRateSelect = $("#framerate-select");
  const startButton = $("#start-button");
  const copyButton = $("#copy-button");
  const stopButton = $("#stop-button");
  const unmuteButton = $("#unmute-button");
  const theaterButton = $("#theater-button");
  const fullscreenButton = $("#fullscreen-button");
  const localVideo = $("#local-video");
  const remoteVideo = $("#remote-video");
  const placeholder = $("#video-placeholder");
  const statusPill = $("#status-pill");
  const statusText = $("#status-text");
  const stageTitle = $("#stage-title");
  const modeKicker = $("#mode-kicker");
  const modeTitle = $("#mode-title");
  const modeDescription = $("#mode-description");
  const setupNotice = $("#setup-notice");

  roomInput.value = state.room;
  applyMode();

  document.querySelectorAll(".mode-button").forEach((button) => {
    button.addEventListener("click", () => {
      if (state.ws) return;
      state.mode = button.dataset.mode;
      applyMode();
    });
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    state.room = roomInput.value.trim();
		if (!/^[a-zA-Z0-9_-]{8,64}$/.test(state.room)) {
			setNotice("Use de 8 a 64 caracteres: letras, números, hífen ou sublinhado.", true);
      roomInput.focus();
      return;
    }

    if (state.mode === "broadcast") {
      await startBroadcast();
    } else {
      await startWatching();
    }
  });

  stopButton.addEventListener("click", () => stop("Conexão encerrada."));
  theaterButton.addEventListener("click", () => {
    $(".shell").classList.toggle("watching");
    theaterButton.textContent = $(".shell").classList.contains("watching") ? "Tamanho normal" : "Modo cinema";
  });
  fullscreenButton.addEventListener("click", async () => {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await $(".video-frame").requestFullscreen();
      }
    } catch (_) {
      setStageStatus("Não foi possível abrir a tela cheia", "error");
    }
  });
  document.addEventListener("fullscreenchange", () => {
    fullscreenButton.textContent = document.fullscreenElement ? "Sair da tela cheia" : "Tela cheia";
  });
  unmuteButton.addEventListener("click", async () => {
    try {
      await remoteVideo.play();
      remoteVideo.muted = false;
      unmuteButton.classList.add("hidden");
    } catch (error) {
      setStageStatus("O navegador bloqueou o áudio", "error");
    }
  });

  copyButton.addEventListener("click", async () => {
    const url = new URL(window.location.href);
    url.search = "";
    url.searchParams.set("room", state.room);
    url.searchParams.set("mode", "watch");
    try {
      await navigator.clipboard.writeText(url.toString());
      copyButton.textContent = "Link copiado";
      setTimeout(() => { copyButton.textContent = "Copiar link da sala"; }, 1800);
    } catch (_) {
      window.prompt("Copie este link:", url.toString());
    }
  });

  function applyMode() {
    document.querySelectorAll(".mode-button").forEach((button) => {
      button.classList.toggle("active", button.dataset.mode === state.mode);
    });
    const broadcast = state.mode === "broadcast";
    startButton.textContent = broadcast ? "Iniciar transmissão" : "Entrar na sala";
    copyButton.classList.toggle("hidden", !broadcast);
    document.querySelectorAll(".broadcast-option").forEach((element) => element.classList.toggle("hidden", !broadcast));
    if (broadcast) {
      modeKicker.textContent = "Sua tela, sua sala";
      modeTitle.textContent = "Transmitir tela e áudio";
      modeDescription.innerHTML = "Escolha uma sala, clique em iniciar e selecione a tela inteira. No Chrome ou Edge, marque também <em>Compartilhar áudio do sistema</em>.";
      setupNotice.textContent = "A transmissão só começa depois que você autorizar o navegador.";
    } else {
      modeKicker.textContent = "Uma sala privada";
      modeTitle.textContent = "Assistir transmissão";
      modeDescription.textContent = "Digite o nome da sala e entre. O vídeo e o áudio passam direto pelo WebRTC, sem gravação no servidor.";
      setupNotice.textContent = "O transmissor precisa estar conectado para a sala aparecer.";
    }
  }

  async function startBroadcast() {
    if (!navigator.mediaDevices?.getDisplayMedia) {
      setNotice("Este navegador não oferece captura de tela. Use uma versão atual do Chrome ou Edge em HTTPS.", true);
      return;
    }
    setNotice("Escolha a tela inteira e marque o áudio do sistema quando a janela pedir.");
    startButton.disabled = true;
    try {
      state.localStream = await navigator.mediaDevices.getDisplayMedia({
        video: { cursor: "motion", frameRate: { ideal: Number(frameRateSelect.value), max: Number(frameRateSelect.value) } },
        audio: { channelCount: 2, suppressLocalAudioPlayback: false },
      });
      state.localStream.getVideoTracks().forEach((track) => { track.contentHint = "detail"; });
      localVideo.srcObject = state.localStream;
      localVideo.classList.remove("hidden");
      placeholder.classList.add("hidden");
      stageTitle.textContent = state.room;
      $("#stage-kicker").textContent = "Sua transmissão";
      showStage();
      setStageStatus("Conectando", "");
      state.pc = createPeerConnection();
      state.localStream.getTracks().forEach((track) => {
        const sender = state.pc.addTrack(track, state.localStream);
        if (track.kind === "video") tuneVideoSender(sender, Number(frameRateSelect.value));
        track.addEventListener("ended", () => stop("A captura foi encerrada."), { once: true });
      });
      if (state.localStream.getAudioTracks().length === 0) {
        setNotice("A tela está sendo transmitida, mas o navegador não forneceu áudio. Ao compartilhar a tela inteira, marque o áudio do sistema.", true);
      }
      await connectSocket("publisher");
    } catch (error) {
      startButton.disabled = false;
      if (error?.name === "NotAllowedError") {
        setNotice("A captura foi cancelada ou bloqueada pelo navegador.", true);
      } else {
        setNotice(error?.message || "Não foi possível iniciar a transmissão.", true);
      }
      cleanupMedia();
    }
  }

  async function startWatching() {
    startButton.disabled = true;
    stageTitle.textContent = state.room;
    $("#stage-kicker").textContent = "Sala ao vivo";
    showStage();
    setStageStatus("Procurando transmissão", "");
    try {
      state.pc = createPeerConnection();
      await connectSocket("viewer");
    } catch (error) {
      startButton.disabled = false;
      setStageStatus(error?.message || "Não foi possível conectar", "error");
    }
  }

  function createPeerConnection() {
    const pc = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    });
    pc.addEventListener("connectionstatechange", () => {
      if (pc.connectionState === "connected") setStageStatus("Ao vivo", "live");
      if (pc.connectionState === "connecting") setStageStatus("Conectando mídia", "");
      if (["failed", "closed"].includes(pc.connectionState)) {
        setStageStatus("Mídia não conectou — confira UDP", "error");
        setNotice("A página conectou, mas a mídia WebRTC não alcançou a VPS. Libere UDP 40000-40100 e configure PUBLIC_IP no servidor.", true);
      }
    });
    pc.addEventListener("iceconnectionstatechange", () => {
      if (pc.iceConnectionState === "failed") setStageStatus("ICE falhou — verifique UDP/TLS", "error");
    });
    pc.addEventListener("track", (event) => {
      if (!state.remoteStream) state.remoteStream = new MediaStream();
      if (!state.remoteStream.getTracks().some((track) => track.id === event.track.id)) {
        state.remoteStream.addTrack(event.track);
      }
      remoteVideo.srcObject = state.remoteStream;
      remoteVideo.classList.remove("hidden");
      localVideo.classList.add("hidden");
      placeholder.classList.add("hidden");
      remoteVideo.play().catch(() => {
        unmuteButton.classList.remove("hidden");
      });
      event.track.addEventListener("ended", () => removeRemoteTrack(event.track), { once: true });
    });
    return pc;
  }

  async function connectSocket(role) {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);
    state.ws = ws;
    ws.addEventListener("open", () => {
      ws.send(JSON.stringify({
        type: "join",
        role,
        room: state.room,
      }));
    });
    ws.addEventListener("message", (event) => {
      if (state.ws !== ws) return;
      void handleSignal(JSON.parse(event.data));
    });
    ws.addEventListener("close", () => {
      if (state.ws !== ws) return;
      if (!state.stopping) stop("Servidor desconectado.", true);
    });
    ws.addEventListener("error", () => {
      if (state.ws !== ws) return;
      if (!state.stopping) setStageStatus("Falha no servidor", "error");
    });
  }

  async function handleSignal(message) {
    if (message.type === "error") {
      const errorMessage = message.message || "O servidor recusou a conexão.";
      setStageStatus(errorMessage, "error");
      stop(errorMessage, true);
      return;
    }
    if (message.type === "warning") {
      setStageStatus(message.message || "Aguardando mídia", "error");
      setNotice(message.message || "A VPS ainda não recebeu tela ou áudio do transmissor.", true);
      return;
    }
    if (message.type === "joined") {
      setStageStatus(state.mode === "broadcast" ? "Preparando" : "Aguardando transmissor", "");
      if (state.mode === "broadcast") await sendOffer();
      return;
    }
    if (message.type === "status") {
      if (state.mode === "broadcast") setStageStatus(`${message.viewers || 0} espectador(es)`, "live");
      return;
    }
    if (message.type === "tracks-removed") {
      for (const track of state.remoteStream?.getTracks() || []) {
        if (message.trackIds?.includes(track.id)) removeRemoteTrack(track);
      }
      return;
    }
    if (message.type === "offer" && state.mode === "watch") {
      await state.pc.setRemoteDescription({ type: "offer", sdp: message.sdp });
      const answer = await state.pc.createAnswer();
      await state.pc.setLocalDescription(answer);
      await waitForIce(state.pc);
      state.ws.send(JSON.stringify({ type: "answer", sdp: state.pc.localDescription.sdp }));
      return;
    }
    if (message.type === "answer" && state.mode === "broadcast") {
      await state.pc.setRemoteDescription({ type: "answer", sdp: message.sdp });
      setStageStatus("Ao vivo", "live");
      return;
    }
    if (message.type === "ended") {
      setStageStatus(message.message || "Transmissão encerrada", "error");
    }
  }

  async function sendOffer() {
    const offer = await state.pc.createOffer();
    await state.pc.setLocalDescription(offer);
    await waitForIce(state.pc);
    state.ws.send(JSON.stringify({ type: "offer", sdp: state.pc.localDescription.sdp }));
  }

  async function waitForIce(pc) {
    if (pc.iceGatheringState === "complete") return;
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, 12000);
      const check = () => {
        if (pc.iceGatheringState === "complete") {
          clearTimeout(timer);
          pc.removeEventListener("icegatheringstatechange", check);
          resolve();
        }
      };
      pc.addEventListener("icegatheringstatechange", check);
    });
  }

  function removeRemoteTrack(track) {
    if (!state.remoteStream?.getTracks().some((item) => item.id === track.id)) return;
    state.remoteStream.removeTrack(track);
    track.stop();
    if (state.remoteStream.getVideoTracks().length === 0) {
      state.remoteStream = null;
      remoteVideo.srcObject = null;
      remoteVideo.classList.add("hidden");
      unmuteButton.classList.add("hidden");
      placeholder.classList.remove("hidden");
    }
  }

  function tuneVideoSender(sender, frameRate) {
    const parameters = sender.getParameters();
    if (!parameters.encodings?.length) return;
    parameters.encodings[0].maxBitrate = frameRate >= 60 ? 10_000_000 : 8_000_000;
    parameters.encodings[0].maxFramerate = frameRate;
    parameters.degradationPreference = "maintain-resolution";
    sender.setParameters(parameters).catch(() => {});
  }

  function showStage() {
    setupCard.classList.add("hidden");
    stageCard.classList.remove("hidden");
    $(".shell").classList.add("watching");
    theaterButton.textContent = "Tamanho normal";
  }

  function setStageStatus(text, kind) {
    statusText.textContent = text;
    statusPill.classList.toggle("live", kind === "live");
    statusPill.classList.toggle("error", kind === "error");
  }

  function setNotice(text, error = false) {
    setupNotice.textContent = text;
    setupNotice.classList.toggle("error", error);
  }

  function stop(message, isError = false) {
    if (state.stopping) return;
    state.stopping = true;
    const ws = state.ws;
    state.ws = null;
    if (ws) ws.close();
    if (state.pc) state.pc.close();
    cleanupMedia();
    state.pc = null;
    state.remoteStream = null;
    localVideo.srcObject = null;
    remoteVideo.srcObject = null;
    localVideo.classList.add("hidden");
    remoteVideo.classList.add("hidden");
    unmuteButton.classList.add("hidden");
    placeholder.classList.remove("hidden");
    stageCard.classList.add("hidden");
    setupCard.classList.remove("hidden");
    $(".shell").classList.remove("watching");
    theaterButton.textContent = "Modo cinema";
    startButton.disabled = false;
    setNotice(message || "Pronto para uma nova conexão.", isError);
    state.stopping = false;
  }

  function cleanupMedia() {
    state.localStream?.getTracks().forEach((track) => track.stop());
    state.localStream = null;
  }

  function randomRoom() {
    if (window.crypto?.randomUUID) return `sala-${window.crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
    return `sala-${Math.random().toString(36).slice(2, 18)}`;
  }
})();
