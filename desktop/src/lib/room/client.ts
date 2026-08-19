import { peerConfig, waitForICE, wsURL } from "./ice";
import { clearViewerState, handleRemoteTrack, removeRemoteTracks } from "./remote-streams";
import type { Member, PublisherSession, RoomStream, Signal, StreamOwner, ViewerSession } from "./types";
import { roomDebug, roomDebugError } from "./debug";

type PendingPing = {
	id: string;
	startedAt: number;
	promise: Promise<number | undefined>;
	resolve: (value: number | undefined) => void;
	timeout: number;
};

export class RoomClient {
	private viewer?: ViewerSession;
	private viewerID?: string;
	private publisher?: PublisherSession;
	private publisherStop?: Promise<void>;
	private publisherIDs = new Set<string>();
	private pendingPing?: PendingPing;
	private pingCounter = 0;

	constructor(
		private onStreams: (streams: RoomStream[]) => void,
		private onStatus: (text: string) => void,
		private onPeople: (count: number) => void = () => undefined,
		private onMembers: (members: Member[]) => void = () => undefined,
		private onPublishingChange: (publishing: boolean) => void = () => undefined,
		private onRoomClosed: () => void = () => undefined,
		private onStreamingMembers: (viewerIDs: string[]) => void = () => undefined,
		private onStreamOwners: (owners: StreamOwner[]) => void = () => undefined,
	) {}

	async join(server: string, room: string, name = "Participante") {
		this.close();
		const pc = new RTCPeerConnection(peerConfig);
		const ws = new WebSocket(wsURL(server));
		let resolveReady!: () => void;
		let rejectReady!: (reason?: unknown) => void;
		const ready = new Promise<void>((resolve, reject) => {
			resolveReady = resolve;
			rejectReady = reject;
		});
		const session: ViewerSession = {
			ws,
			pc,
			streams: new Map(),
			intentional: false,
			joined: false,
			resolveReady,
			rejectReady,
		};
		this.viewer = session;

		pc.ontrack = (event) => {
			roomDebug("viewer ontrack", {
				trackID: event.track.id,
				kind: event.track.kind,
				readyState: event.track.readyState,
				muted: event.track.muted,
				streamIDs: event.streams.map((stream) => stream.id),
			});
			this.watchRemoteVideo(session, event.track);
			this.handleRemoteTrack(session, event);
		};
		pc.onconnectionstatechange = () => {
			if (this.viewer !== session) return;
			roomDebug("viewer peer state", { state: pc.connectionState, ice: pc.iceConnectionState, signaling: pc.signalingState });
			if (["failed", "closed"].includes(pc.connectionState)) {
				this.onStatus(`Conexão de espectador: ${pc.connectionState}`);
			}
		};
		ws.onopen = () => {
			roomDebug("viewer websocket open");
			ws.send(JSON.stringify({ type: "join", role: "viewer", room, name: name.trim() || "Participante" }));
		};
		ws.onmessage = (event) => {
			void this.viewerSignal(session, JSON.parse(event.data) as Signal).catch((error: unknown) => {
				if (this.viewer !== session) return;
				this.onStatus(error instanceof Error ? error.message : "Falha na conexão da sala");
				session.rejectReady(error);
				ws.close();
			});
		};
		ws.onerror = () => {
			if (this.viewer !== session) return;
			const error = new Error("Erro no WebSocket da sala");
			this.onStatus(error.message);
			session.rejectReady(error);
		};
		ws.onclose = (event) => {
			if (this.viewer !== session) return;
			roomDebug("viewer websocket close", { code: event.code, reason: event.reason });
			this.clearPendingPing();
			const intentional = session.intentional;
			this.viewer = undefined;
			pc.close();
			session.rejectReady(new Error("A conexão da sala foi encerrada"));
			this.clearViewerState(session);
			if (!intentional) {
				this.onStatus(`WebSocket da sala fechado (${event.code}${event.reason ? `: ${event.reason}` : ""})`);
				this.onRoomClosed();
			}
		};
		this.onStatus("Entrando na sala...");

		const timeout = window.setTimeout(() => {
			if (this.viewer !== session || session.joined) return;
			session.rejectReady(new Error("Tempo esgotado ao entrar na sala"));
			ws.close();
		}, 15_000);
		try {
			await ready;
		} finally {
			window.clearTimeout(timeout);
		}
	}

	ping() {
		const session = this.viewer;
		if (!session || session.ws.readyState !== WebSocket.OPEN) return Promise.resolve<number | undefined>(undefined);
		if (this.pendingPing) return this.pendingPing.promise;

		const id = `${Date.now()}-${this.pingCounter++}`;
		let resolvePing!: (value: number | undefined) => void;
		const promise = new Promise<number | undefined>((resolve) => {
			resolvePing = resolve;
		});
		this.pendingPing = {
			id,
			startedAt: performance.now(),
			promise,
			resolve: resolvePing,
			timeout: window.setTimeout(() => this.finishPing(id), 3_000),
		};
		try {
			session.ws.send(JSON.stringify({ type: "ping", pingId: id }));
		} catch {
			this.finishPing(id);
		}
		return promise;
	}

	async publish(server: string, room: string, stream: MediaStream, frameRate = 30, maxBitrate = 10_000_000) {
		await this.stopPublish();
		const pc = new RTCPeerConnection(peerConfig);
		const ws = new WebSocket(wsURL(server));
		let resolveReady!: () => void;
		let rejectReady!: (reason?: unknown) => void;
		const ready = new Promise<void>((resolve, reject) => {
			resolveReady = resolve;
			rejectReady = reject;
		});
		const session: PublisherSession = {
			ws,
			pc,
			intentional: false,
			joined: false,
			resolveStopped: () => undefined,
			resolveReady,
			rejectReady,
		};
		this.publisher = session;
		stream.getTracks().forEach((track) => {
			roomDebug("publisher local track", { id: track.id, kind: track.kind, readyState: track.readyState, enabled: track.enabled });
			const sender = pc.addTrack(track, stream);
			if (track.kind === "audio") {
				track.contentHint = "music";
				const parameters = sender.getParameters();
				if (parameters.encodings?.length) {
					parameters.encodings[0].maxBitrate = 256_000;
					void sender.setParameters(parameters).catch(() => undefined);
				}
				return;
			}
			if (track.kind !== "video") return;
			const parameters = sender.getParameters();
			if (!parameters.encodings?.length) return;
			parameters.encodings[0].maxFramerate = frameRate;
			parameters.encodings[0].maxBitrate = maxBitrate;
			parameters.degradationPreference = "maintain-resolution";
			roomDebug("publisher sender parameters", {
				trackID: track.id,
				frameRate,
				maxBitrate,
				degradationPreference: parameters.degradationPreference,
			});
			void sender.setParameters(parameters).catch((error) => roomDebugError("publisher sender parameters failed", error));
		});
		pc.onconnectionstatechange = () => {
			if (this.publisher !== session) return;
			roomDebug("publisher peer state", { state: pc.connectionState, ice: pc.iceConnectionState, signaling: pc.signalingState });
			if (["failed", "closed"].includes(pc.connectionState)) {
				this.onStatus(`Conexão de transmissão: ${pc.connectionState}`);
			}
		};
		ws.onopen = () => {
			roomDebug("publisher websocket open", { room, viewerID: this.viewerID });
			ws.send(JSON.stringify({ type: "join", role: "publisher", room, viewerId: this.viewerID }));
		};
		ws.onmessage = (event) => {
			void this.publisherSignal(session, JSON.parse(event.data) as Signal).catch((error: unknown) => {
				if (this.publisher !== session) return;
				this.onStatus(error instanceof Error ? error.message : "Falha ao negociar transmissão");
				session.rejectReady(error);
				ws.close();
			});
		};
		ws.onerror = () => {
			if (this.publisher !== session) return;
			const error = new Error("Erro no WebSocket de transmissão");
			this.onStatus(error.message);
			session.rejectReady(error);
		};
		ws.onclose = (event) => {
			if (this.publisher !== session) return;
			roomDebug("publisher websocket close", { code: event.code, reason: event.reason });
			const intentional = session.intentional;
			this.publisher = undefined;
			this.removePublisherID(session.publisherId);
			pc.close();
			session.rejectReady(new Error("A conexão de transmissão foi encerrada"));
			if (!intentional) this.onPublishingChange(false);
			if (!intentional && event.code !== 1000) {
				this.onStatus(`WebSocket de transmissão fechado (${event.code}${event.reason ? `: ${event.reason}` : ""})`);
			}
		};
		this.onStatus("Preparando transmissão...");
		const timeout = window.setTimeout(() => {
			if (this.publisher !== session || session.joined) return;
			const error = new Error("Tempo esgotado ao iniciar a transmissão");
			session.rejectReady(error);
			ws.close();
		}, 15_000);
		try {
			await ready;
		} finally {
			window.clearTimeout(timeout);
		}
	}

	stopPublish() {
		const session = this.publisher;
		if (!session) return this.publisherStop ?? Promise.resolve();
		this.publisher = undefined;
		session.intentional = true;
		this.removePublisherID(session.publisherId);

		let resolveStopped!: () => void;
		let timeout = 0;
		const stopped = new Promise<void>((resolve) => {
			let finished = false;
			const finish = () => {
				if (finished) return;
				finished = true;
				window.clearTimeout(timeout);
				if (session.ws.readyState !== WebSocket.CLOSED) session.ws.close();
				resolve();
			};
			resolveStopped = finish;
		});
		session.resolveStopped = resolveStopped;
		this.publisherStop = stopped;

		timeout = window.setTimeout(resolveStopped, 1_000);
		session.ws.addEventListener("close", resolveStopped, { once: true });
		if (session.ws.readyState === WebSocket.OPEN) {
			roomDebug("publisher stop sent");
			session.ws.send(JSON.stringify({ type: "stop" }));
		}
		session.pc.close();
		if (session.ws.readyState !== WebSocket.OPEN) session.ws.close();
		session.rejectReady(new Error("Transmissão encerrada"));
		return stopped;
	}

	close() {
		this.clearPendingPing();
		this.stopPublish();
		const session = this.viewer;
		this.viewerID = undefined;
		if (!session) return;
		this.viewer = undefined;
		session.intentional = true;
		session.pc.ontrack = null;
		session.pc.close();
		session.ws.close();
		session.rejectReady(new Error("Sala encerrada"));
		this.clearViewerState(session);
	}

	private async viewerSignal(session: ViewerSession, message: Signal) {
		if (this.viewer !== session) return;
		if (message.type === "error") {
			const error = new Error(message.message ?? "Erro na sala");
			this.onStatus(error.message);
			session.rejectReady(error);
			return;
		}
		if (message.type !== "pong")
			roomDebug("viewer signal", { type: message.type, publisherId: message.publisherId, trackIds: message.trackIds });
		if (message.type === "pong") {
			const pending = this.pendingPing;
			if (!pending || pending.id !== message.pingId) return;
			this.finishPing(pending.id, Math.round(performance.now() - pending.startedAt));
			return;
		}
		if (message.type === "status") {
			const count = message.viewers ?? 0;
			this.onPeople(count);
			this.onMembers(message.members ?? []);
			this.onStreamingMembers(message.streamingMembers ?? []);
			this.onStreamOwners(message.streamOwners ?? []);
			this.onStatus(`Na sala · ${count} pessoa(s)`);
			return;
		}
		if (message.type === "joined") {
			session.joined = true;
			this.viewerID = message.viewerId;
			session.resolveReady();
			this.onStatus("Na sala · aguardando transmissões");
			return;
		}
		if (message.type === "tracks-removed") {
			roomDebug("viewer tracks removed", { publisherId: message.publisherId, trackIds: message.trackIds });
			this.removeRemoteTracks(session, message.publisherId, message.trackIds ?? []);
			return;
		}
		if (message.type === "ended") {
			this.onStatus(message.message ?? "A conexão foi encerrada");
			return;
		}
		if (message.type !== "offer" || !message.sdp) return;
		roomDebug("viewer offer received", { sdpBytes: message.sdp.length, signaling: session.pc.signalingState });

		await session.pc.setRemoteDescription({ type: "offer", sdp: message.sdp });
		await session.pc.setLocalDescription(await session.pc.createAnswer());
		await waitForICE(session.pc);
		if (session.ws.readyState !== WebSocket.OPEN || this.viewer !== session) return;
		roomDebug("viewer answer sent", { sdpBytes: session.pc.localDescription?.sdp?.length ?? 0 });
		session.ws.send(JSON.stringify({ type: "answer", sdp: session.pc.localDescription?.sdp }));
		this.onStatus("Ao vivo");
	}

	private async publisherSignal(session: PublisherSession, message: Signal) {
		roomDebug("publisher signal", { type: message.type, sdpBytes: message.sdp?.length });
		if (message.type === "stopped") {
			session.resolveStopped();
			return;
		}
		if (this.publisher !== session) return;
		if (message.type === "error") {
			const error = new Error(message.message ?? "Erro ao transmitir");
			this.onStatus(error.message);
			session.rejectReady(error);
			session.ws.close();
			return;
		}
		if (message.type === "joined") {
			session.joined = true;
			session.publisherId = message.publisherId;
			if (session.publisherId) {
				this.publisherIDs.add(session.publisherId);
				this.removeRemoteTracks(this.viewer, session.publisherId, []);
			}
			await session.pc.setLocalDescription(await session.pc.createOffer());
			await waitForICE(session.pc);
			if (session.ws.readyState !== WebSocket.OPEN || this.publisher !== session) return;
			roomDebug("publisher offer sent", { sdpBytes: session.pc.localDescription?.sdp?.length ?? 0 });
			session.ws.send(JSON.stringify({ type: "offer", sdp: session.pc.localDescription?.sdp }));
			return;
		}
		if (message.type === "answer" && message.sdp) {
			await session.pc.setRemoteDescription({ type: "answer", sdp: message.sdp });
			roomDebug("publisher answer applied", { sdpBytes: message.sdp.length, signaling: session.pc.signalingState });
			session.resolveReady();
			this.onStatus("Transmitindo");
		}
	}

	private watchRemoteVideo(session: ViewerSession, track: MediaStreamTrack) {
		if (track.kind !== "video") return;
		let timer = 0;
		const stop = () => {
			if (timer) window.clearInterval(timer);
			track.removeEventListener("ended", stop);
		};
		const poll = async () => {
			if (this.viewer !== session || track.readyState === "ended") {
				stop();
				return;
			}
			try {
				const stats = await session.pc.getStats(track);
				stats.forEach((report) => {
					if (report.type !== "inbound-rtp") return;
					const values = report as unknown as Record<string, unknown>;
					if (values.kind !== "video" && values.mediaType !== "video") return;
					roomDebug("viewer video stats", {
						trackID: track.id,
						readyState: track.readyState,
						muted: track.muted,
						packetsReceived: values.packetsReceived,
						framesDecoded: values.framesDecoded,
						keyFramesDecoded: values.keyFramesDecoded,
						frameWidth: values.frameWidth,
						frameHeight: values.frameHeight,
						framesPerSecond: values.framesPerSecond,
					});
				});
			} catch (error) {
				roomDebugError("viewer video stats failed", error);
			}
		};
		const logTrackState = (event: Event) =>
			roomDebug("remote video track event", {
				event: event.type,
				trackID: track.id,
				readyState: track.readyState,
				muted: track.muted,
			});
		track.addEventListener("ended", stop, { once: true });
		track.addEventListener("mute", logTrackState);
		track.addEventListener("unmute", logTrackState);
		void poll();
		timer = window.setInterval(() => void poll(), 2_000);
	}

	private handleRemoteTrack(session: ViewerSession, event: RTCTrackEvent) {
		handleRemoteTrack(session, event, (currentSession) => this.viewer === currentSession, this.publisherIDs, this.onStreams);
	}

	private removeRemoteTracks(session: ViewerSession | undefined, publisherID: string | undefined, trackIDs: string[]) {
		removeRemoteTracks(session, publisherID, trackIDs, (currentSession) => this.viewer === currentSession, this.onStreams);
	}

	private removePublisherID(publisherID: string | undefined) {
		if (!publisherID) return;
		this.publisherIDs.delete(publisherID);
		this.removeRemoteTracks(this.viewer, publisherID, []);
	}

	private finishPing(id: string, value?: number) {
		const pending = this.pendingPing;
		if (!pending || pending.id !== id) return;
		this.pendingPing = undefined;
		window.clearTimeout(pending.timeout);
		pending.resolve(value);
	}

	private clearPendingPing() {
		const pending = this.pendingPing;
		if (!pending) return;
		this.pendingPing = undefined;
		window.clearTimeout(pending.timeout);
		pending.resolve(undefined);
	}

	private clearViewerState(session: ViewerSession) {
		clearViewerState(session, this.onStreams, this.onPeople, this.onMembers, this.onStreamingMembers, this.onStreamOwners);
	}
}
