import { useEffect, useRef, useState } from "react";
import { RoomClient } from "@/lib/room";
import { roomDebug, roomDebugError } from "@/lib/room/debug";
import { type AudioMode, type FrameRate, type Resolution, resolutions, type SourceType, videoBitrate } from "./types";

type RoomClientRef = { current: RoomClient | undefined };

export type ScreenCaptureOptions = {
	client: RoomClientRef;
	server: string;
	room: string;
	onStatus: (text: string) => void;
};

const stopTracks = (stream: MediaStream | undefined | null) => {
	stream?.getTracks().forEach((track) => track.stop());
};

export function useScreenCapture({ client, server, room, onStatus }: ScreenCaptureOptions) {
	const [local, setLocal] = useState<MediaStream | null>(null);
	const [sharing, setSharing] = useState(false);
	const [pickerOpen, setPickerOpen] = useState(false);
	const [sources, setSources] = useState<CaptureSource[]>([]);
	const [selectedSourceID, setSelectedSourceID] = useState("");
	const [sourceType, setSourceType] = useState<SourceType>("screen");
	const [frameRate, setFrameRate] = useState<FrameRate>(30);
	const [resolution, setResolution] = useState<Resolution>("1080p");
	const [audioMode, setAudioMode] = useState<AudioMode>("none");
	const [loadingSources, setLoadingSources] = useState(false);
	const [startingShare, setStartingShare] = useState(false);
	const localStream = useRef<MediaStream | null>(null);
	const captureToken = useRef(0);
	const sourceRequest = useRef(0);
	const serverRef = useRef(server);
	const roomRef = useRef(room);
	const onStatusRef = useRef(onStatus);
	const sourcesRef = useRef(sources);
	const selectedSourceIDRef = useRef(selectedSourceID);
	const frameRateRef = useRef(frameRate);
	const resolutionRef = useRef(resolution);
	const audioModeRef = useRef(audioMode);
	const audioContextRef = useRef<AudioContext | null>(null);
	const audioCleanupRef = useRef<(() => void) | null>(null);

	useEffect(() => {
		serverRef.current = server;
		roomRef.current = room;
		onStatusRef.current = onStatus;
		sourcesRef.current = sources;
		selectedSourceIDRef.current = selectedSourceID;
		frameRateRef.current = frameRate;
		resolutionRef.current = resolution;
		audioModeRef.current = audioMode;
	}, [server, room, onStatus, sources, selectedSourceID, frameRate, resolution, audioMode]);

	const cleanupAudio = () => {
		if (audioCleanupRef.current) {
			audioCleanupRef.current();
			audioCleanupRef.current = null;
		}
		if (audioContextRef.current) {
			void audioContextRef.current.close().catch(() => undefined);
			audioContextRef.current = null;
		}
		if (window.screenShare?.stopAudioLoopback) {
			void window.screenShare.stopAudioLoopback().catch(() => undefined);
		}
	};

	const loadSources = async () => {
		setPickerOpen(true);
		setLoadingSources(true);
		const requestID = ++sourceRequest.current;
		try {
			const available = await window.screenShare.sources();
			if (sourceRequest.current !== requestID) return;
			const current = available.find((source) => source.id === selectedSourceIDRef.current);
			const next = current ?? available.find((source) => source.kind === "screen") ?? available[0];
			setSources(available);
			setSelectedSourceID(next?.id ?? "");
			setSourceType(next?.kind ?? "screen");
		} catch (error) {
			if (sourceRequest.current !== requestID) return;
			onStatusRef.current(error instanceof Error ? error.message : "Não foi possível listar as fontes de captura");
		} finally {
			if (sourceRequest.current === requestID) setLoadingSources(false);
		}
	};

	const selectSourceType = (type: SourceType) => {
		setSourceType(type);
		setSelectedSourceID(sourcesRef.current.find((source) => source.kind === type)?.id ?? "");
	};

	const selectSource = (source: CaptureSource) => {
		setSelectedSourceID(source.id);
		setSourceType(source.kind);
	};

	const stopSharing = (message = "Compartilhamento encerrado") => {
		roomDebug("capture stop", { message, hadStream: Boolean(localStream.current) });
		captureToken.current += 1;
		client.current?.stopPublish();
		cleanupAudio();
		const stream = localStream.current;
		localStream.current = null;
		stopTracks(stream);
		setLocal(null);
		setSharing(false);
		setStartingShare(false);
		onStatusRef.current(message);
	};

	const startSharing = async () => {
		const source = sourcesRef.current.find((item) => item.id === selectedSourceIDRef.current);
		const roomClient = client.current;
		if (!source || !roomClient) {
			onStatusRef.current("Selecione uma tela ou janela para compartilhar");
			return;
		}
		const serverValue = serverRef.current;
		const roomValue = roomRef.current;
		const frameRateValue = frameRateRef.current;
		const resolutionValue = resolutionRef.current;
		const audioModeValue = audioModeRef.current;
		const maxBitrate = videoBitrate(resolutionValue, frameRateValue);
		const token = ++captureToken.current;
		roomDebug("capture start", {
			sourceID: source.id,
			sourceType: source.kind,
			room: roomValue,
			frameRate: frameRateValue,
			resolution: resolutionValue,
			audioMode: audioModeValue,
		});
		setStartingShare(true);
		cleanupAudio();
		let stream: MediaStream | undefined;
		try {
			const isWindow = source.kind === "window";
			const audioSource = isWindow ? source : (sourcesRef.current.find((item) => item.kind === "screen") ?? source);
			if (audioModeValue === "system" && !audioSource) {
				throw new Error(
					isWindow
						? "Não foi possível encontrar a janela para capturar o áudio do aplicativo"
						: "Não foi possível encontrar a tela para capturar o áudio do PC"
				);
			}
			const selectedResolution = resolutions[resolutionValue];
			const desktopVideo = {
				mandatory: {
					chromeMediaSource: "desktop",
					chromeMediaSourceId: source.id,
					maxFrameRate: frameRateValue,
					...(selectedResolution.width && selectedResolution.height
						? {
								maxWidth: selectedResolution.width,
								maxHeight: selectedResolution.height,
							}
						: {}),
				},
			} as unknown as MediaTrackConstraints;

			const capturesAudio = audioModeValue === "system";

			if (capturesAudio && window.screenShare?.startAudioLoopback) {
				const videoStream = await navigator.mediaDevices.getUserMedia({
					audio: false,
					video: desktopVideo,
				});

				const audioCtx = new AudioContext({ sampleRate: 48000 });
				audioContextRef.current = audioCtx;
				if (audioCtx.state === "suspended") {
					await audioCtx.resume();
				}

				const destination = audioCtx.createMediaStreamDestination();
				let nextPlayTime = 0;

				const unsubscribe = window.screenShare.onAudioChunk((chunk) => {
					if (audioContextRef.current !== audioCtx || audioCtx.state === "closed") return;
					const floatCount = Math.floor(chunk.byteLength / 4);
					if (floatCount <= 0) return;

					const floatArray = new Float32Array(chunk.buffer, chunk.byteOffset, floatCount);
					const numFrames = Math.floor(floatArray.length / 2);
					if (numFrames <= 0) return;

					const audioBuffer = audioCtx.createBuffer(2, numFrames, 48000);
					const leftChannel = audioBuffer.getChannelData(0);
					const rightChannel = audioBuffer.getChannelData(1);

					for (let i = 0; i < numFrames; i++) {
						leftChannel[i] = floatArray[i * 2];
						rightChannel[i] = floatArray[i * 2 + 1];
					}

					const bufferSource = audioCtx.createBufferSource();
					bufferSource.buffer = audioBuffer;
					bufferSource.connect(destination);

					const currentTime = audioCtx.currentTime;
					if (nextPlayTime < currentTime) {
						nextPlayTime = currentTime + 0.02;
					}
					bufferSource.start(nextPlayTime);
					nextPlayTime += audioBuffer.duration;
				});

				audioCleanupRef.current = unsubscribe;
				await window.screenShare.startAudioLoopback(source.id);

				const videoTrack = videoStream.getVideoTracks()[0];
				const audioTrack = destination.stream.getAudioTracks()[0];
				if (audioTrack) {
					audioTrack.contentHint = "music";
				}

				stream = new MediaStream([videoTrack, ...(audioTrack ? [audioTrack] : [])]);
			} else {
				stream = await navigator.mediaDevices.getUserMedia({
					audio: false,
					video: desktopVideo,
				});
			}

			const desktopAudio = {
				mandatory: {
					chromeMediaSource: "desktop",
					chromeMediaSourceId: audioSource.id,
				},
			} as unknown as MediaTrackConstraints;
			const capturesSystemAudio = audioModeValue === "system";
			stream = await navigator.mediaDevices.getUserMedia({
				audio: capturesSystemAudio ? desktopAudio : false,
				video: desktopVideo,
			});
			roomDebug("capture stream created", {
				streamID: stream.id,
				maxBitrate,
				tracks: stream.getTracks().map((track) => ({
					id: track.id,
					kind: track.kind,
					readyState: track.readyState,
					muted: track.muted,
					enabled: track.enabled,
				})),
			});
			if (captureToken.current !== token || client.current !== roomClient) {
				cleanupAudio();
				stopTracks(stream);
				return;
			}
			localStream.current = stream;

			const videoTrack = stream.getVideoTracks()[0];
			if (!videoTrack) throw new Error("A fonte não forneceu um vídeo");
			videoTrack.contentHint = "detail";
			roomDebug("capture video settings", { settings: videoTrack.getSettings(), contentHint: videoTrack.contentHint });
			videoTrack.addEventListener(
				"ended",
				() => {
					if (localStream.current === stream && captureToken.current === token) {
						stopSharing("A captura foi encerrada");
					}
				},
				{ once: true },
			);
			setLocal(stream);
			setSharing(true);
			setPickerOpen(false);
			onStatusRef.current("Conectando transmissão...");
			await videoTrack
				.applyConstraints({
					frameRate: { ideal: frameRateValue, max: frameRateValue },
				})
				.catch(() => undefined);
			roomDebug("capture publish begin", {
				streamID: stream.id,
				videoTrackID: videoTrack.id,
				videoReadyState: videoTrack.readyState,
			});
			await roomClient.publish(serverValue.trim(), roomValue.trim(), stream, frameRateValue, maxBitrate);
			roomDebug("capture publish ready", {
				streamID: stream.id,
				videoTrackID: videoTrack.id,
				videoReadyState: videoTrack.readyState,
			});
			if (localStream.current === stream && captureToken.current === token && client.current === roomClient) {
				onStatusRef.current(`Transmitindo · ${resolutions[resolutionValue].label} · ${frameRateValue} FPS`);
			}
		} catch (error) {
			roomDebugError("capture start failed", error);
			if (localStream.current !== stream || captureToken.current !== token || client.current !== roomClient) {
				return;
			}
			cleanupAudio();
			roomClient.stopPublish();
			stopTracks(stream);
			stopTracks(localStream.current);
			localStream.current = null;
			onStatusRef.current(error instanceof Error ? error.message : "Não foi possível iniciar o compartilhamento");
		} finally {
			if (captureToken.current === token) setStartingShare(false);
		}
	};

	useEffect(
		() => () => {
			captureToken.current += 1;
			sourceRequest.current += 1;
			cleanupAudio();
			client.current?.stopPublish();
			const stream = localStream.current;
			localStream.current = null;
			stopTracks(stream);
		},
		[client],
	);

	return {
		sharing,
		pickerOpen,
		sources,
		selectedSourceID,
		sourceType,
		frameRate,
		resolution,
		audioMode,
		loadingSources,
		startingShare,
		setPickerOpen,
		setSelectedSourceID,
		setSourceType,
		setFrameRate,
		setResolution,
		setAudioMode,
		loadSources,
		selectSourceType,
		selectSource,
		startSharing,
		stopSharing,
		closePicker: () => setPickerOpen(false),
		local,
	};
}
