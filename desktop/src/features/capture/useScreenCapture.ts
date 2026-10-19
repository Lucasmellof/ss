import { useEffect, useRef, useState } from "react";
import { RoomClient } from "@/lib/room";
import { roomDebug, roomDebugError } from "@/lib/room/debug";
import { storedValue } from "@/lib/storage";
import {
	type AudioFilter,
	type AudioMode,
	audioFilterModes,
	defaultAudioFilter,
	type FrameRate,
	normalizeAppName,
	type Resolution,
	resolutions,
	type SourceType,
	videoBitrate,
} from "./types";

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

type AudioStreamFormat = {
	kind: "float32" | "pcm";
	channels: number;
	sampleRate: number;
	blockAlign: number;
	bitsPerSample: number;
	validBitsPerSample: number;
};

const AUDIO_HEADER_SIZE = 16;

const appendBytes = (current: Uint8Array, next: Uint8Array) => {
	const merged = new Uint8Array(current.byteLength + next.byteLength);
	merged.set(current);
	merged.set(next, current.byteLength);
	return merged;
};

const parseAudioHeader = (bytes: Uint8Array): AudioStreamFormat => {
	if (bytes.byteLength < AUDIO_HEADER_SIZE || String.fromCharCode(...bytes.slice(0, 4)) !== "SSAF") {
		throw new Error("O helper de áudio enviou um cabeçalho inválido");
	}
	if (bytes[4] !== 1) throw new Error(`Versão de áudio não suportada: ${bytes[4]}`);
	if (bytes[5] !== 1 && bytes[5] !== 2) throw new Error(`Formato de áudio não suportado: ${bytes[5]}`);

	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const format = {
		kind: bytes[5] === 1 ? ("float32" as const) : ("pcm" as const),
		channels: bytes[6],
		sampleRate: view.getUint32(8, true),
		blockAlign: view.getUint16(12, true),
		bitsPerSample: bytes[14],
		validBitsPerSample: bytes[15] || bytes[14],
	};
	if (!format.channels || !format.sampleRate || !format.blockAlign || !format.bitsPerSample) {
		throw new Error("O helper de áudio enviou um formato inválido");
	}
	return format;
};

const decodePcmSample = (view: DataView, offset: number, bitsPerSample: number) => {
	if (bitsPerSample === 8) return (view.getUint8(offset) - 128) / 128;
	if (bitsPerSample === 16) return view.getInt16(offset, true) / 32768;
	if (bitsPerSample === 24) {
		let value = view.getUint8(offset) | (view.getUint8(offset + 1) << 8) | (view.getUint8(offset + 2) << 16);
		if (value & 0x800000) value |= ~0xffffff;
		return value / 8388608;
	}
	if (bitsPerSample === 32) return view.getInt32(offset, true) / 2147483648;
	return 0;
};

const clampSample = (value: number) => (Number.isFinite(value) ? Math.max(-1, Math.min(1, value)) : 0);

const AUDIO_SETTINGS_KEY = "screen-share.audio-filter";

type AudioSettings = { audioMode: AudioMode; audioFilter: AudioFilter };

const loadAudioSettings = (): AudioSettings => {
	const fallback: AudioSettings = { audioMode: "none", audioFilter: defaultAudioFilter };
	try {
		const raw = storedValue(AUDIO_SETTINGS_KEY);
		if (!raw) return fallback;
		const parsed = JSON.parse(raw) as { audioMode?: unknown; audioFilter?: { mode?: unknown; apps?: unknown } };
		const audioMode: AudioMode = parsed.audioMode === "system" ? "system" : "none";
		const mode = parsed.audioFilter?.mode;
		const apps = parsed.audioFilter?.apps;
		if (typeof mode !== "string" || !(mode in audioFilterModes) || !Array.isArray(apps)) {
			return { audioMode, audioFilter: defaultAudioFilter };
		}
		const names = apps.filter((app): app is string => typeof app === "string").map(normalizeAppName);
		return {
			audioMode,
			audioFilter: { mode: mode as AudioFilter["mode"], apps: [...new Set(names.filter(Boolean))] },
		};
	} catch {
		return fallback;
	}
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
	const [initialAudioSettings] = useState(loadAudioSettings);
	const [audioMode, setAudioMode] = useState<AudioMode>(initialAudioSettings.audioMode);
	const [audioFilter, setAudioFilter] = useState<AudioFilter>(initialAudioSettings.audioFilter);
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
	const audioFilterRef = useRef(audioFilter);
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
		audioFilterRef.current = audioFilter;
	}, [server, room, onStatus, sources, selectedSourceID, frameRate, resolution, audioMode, audioFilter]);

	useEffect(() => {
		try {
			window.localStorage.setItem(AUDIO_SETTINGS_KEY, JSON.stringify({ audioMode, audioFilter }));
		} catch (error) {
			roomDebugError("audio settings save failed", error);
		}
	}, [audioMode, audioFilter]);

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
		const isLinux = window.screenShare.platform === "linux";
		if ((!source && !isLinux) || !roomClient) {
			onStatusRef.current("Selecione uma tela ou janela para compartilhar");
			return;
		}
		const serverValue = serverRef.current;
		const roomValue = roomRef.current;
		const frameRateValue = frameRateRef.current;
		const resolutionValue = resolutionRef.current;
		const audioModeValue = audioModeRef.current;
		const audioFilterValue = audioFilterRef.current;
		const maxBitrate = videoBitrate(resolutionValue, frameRateValue);
		const token = ++captureToken.current;
		roomDebug("capture start", {
			sourceID: source?.id ?? "linux:native-picker",
			sourceType: source?.kind ?? "screen",
			room: roomValue,
			frameRate: frameRateValue,
			resolution: resolutionValue,
			audioMode: audioModeValue,
			audioFilter: audioFilterValue,
		});
		setStartingShare(true);
		cleanupAudio();
		let stream: MediaStream | undefined;
		try {
			if (source) await window.screenShare.setCaptureSource(source.id);
			const isWindow = source?.kind === "window";
			const audioSource = source && (isWindow ? source : (sourcesRef.current.find((item) => item.kind === "screen") ?? source));
			if (audioModeValue === "system" && !isLinux && !audioSource) {
				throw new Error(
					isWindow
						? "Não foi possível encontrar a janela para capturar o áudio do aplicativo"
						: "Não foi possível encontrar a tela para capturar o áudio do PC",
				);
			}
			const selectedResolution = resolutions[resolutionValue];
			const capturesAudio = audioModeValue === "system";
			const desktopVideo = source
				? ({
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
					} as unknown as MediaTrackConstraints)
				: undefined;
			const desktopAudio = audioSource
				? ({
						mandatory: {
							chromeMediaSource: "desktop",
							chromeMediaSourceId: audioSource.id,
						},
					} as unknown as MediaTrackConstraints)
				: undefined;
			const displayVideo: MediaTrackConstraints = {
				frameRate: { ideal: frameRateValue, max: frameRateValue },
				...(selectedResolution.width && selectedResolution.height
					? {
							width: { ideal: selectedResolution.width, max: selectedResolution.width },
							height: { ideal: selectedResolution.height, max: selectedResolution.height },
						}
					: {}),
			};
			if (capturesAudio && !desktopAudio && !isLinux) {
				throw new Error("Não foi possível encontrar a fonte de áudio da tela");
			}
			const captureLegacyDesktop = async (withAudio: boolean) => {
				if (!desktopVideo) throw new Error("Não foi possível identificar a fonte de captura da tela");
				return navigator.mediaDevices.getUserMedia({ audio: withAudio ? (desktopAudio ?? false) : false, video: desktopVideo });
			};
			const captureLinuxDesktop = async (withAudio: boolean) => {
				try {
					return await captureLegacyDesktop(withAudio);
				} catch (legacyError) {
					roomDebugError("legacy Linux desktop capture failed; trying PipeWire display capture", legacyError);
					if (typeof navigator.mediaDevices.getDisplayMedia !== "function") throw legacyError;

					const videoStream = await navigator.mediaDevices.getDisplayMedia({ video: displayVideo, audio: false });
					if (!withAudio) return videoStream;
					if (!desktopAudio) {
						stopTracks(videoStream);
						throw new Error("Não foi possível identificar a fonte de áudio do desktop no Linux", { cause: legacyError });
					}

					try {
						const audioStream = await navigator.mediaDevices.getUserMedia({ audio: desktopAudio, video: false });
						return new MediaStream([...videoStream.getVideoTracks(), ...audioStream.getAudioTracks()]);
					} catch (audioError) {
						stopTracks(videoStream);
						throw audioError;
					}
				}
			};

			const startNativeAudio = async (): Promise<MediaStreamTrack | undefined> => {
				const audioCtx = new AudioContext({ sampleRate: 48000 });
				audioContextRef.current = audioCtx;
				if (audioCtx.state === "suspended") {
					await audioCtx.resume();
				}

				const destination = audioCtx.createMediaStreamDestination();
				let nextPlayTime = 0;
				let bufferedAudio = new Uint8Array();
				let audioFormat: AudioStreamFormat | undefined;
				let audioDecodeErrorReported = false;

				const unsubscribe = window.screenShare.onAudioChunk((chunk) => {
					if (audioContextRef.current !== audioCtx || audioCtx.state === "closed") return;
					try {
						const incoming = new Uint8Array(chunk.byteLength);
						incoming.set(chunk);
						bufferedAudio = appendBytes(bufferedAudio, incoming);

						if (!audioFormat) {
							if (bufferedAudio.byteLength < AUDIO_HEADER_SIZE) return;
							audioFormat = parseAudioHeader(bufferedAudio);
							bufferedAudio = bufferedAudio.slice(AUDIO_HEADER_SIZE);
							roomDebug("audio stream format", audioFormat);
						}
						const format = audioFormat;

						const frameBytes = format.blockAlign;
						const frameCount = Math.floor(bufferedAudio.byteLength / frameBytes);
						if (frameCount <= 0) return;
						const bytesToConsume = frameCount * frameBytes;
						const raw = bufferedAudio.slice(0, bytesToConsume);
						bufferedAudio = bufferedAudio.slice(bytesToConsume);
						const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
						const sampleBytes = Math.max(1, Math.floor(format.blockAlign / format.channels));
						const audioBuffer = audioCtx.createBuffer(2, frameCount, format.sampleRate);
						const leftChannel = audioBuffer.getChannelData(0);
						const rightChannel = audioBuffer.getChannelData(1);

						const readSample = (frame: number, channel: number) => {
							const sourceChannel = Math.min(channel, format.channels - 1);
							const offset = frame * frameBytes + sourceChannel * sampleBytes;
							if (format.kind === "float32") {
								return offset + 4 <= view.byteLength ? clampSample(view.getFloat32(offset, true)) : 0;
							}
							return offset + sampleBytes <= view.byteLength
								? clampSample(decodePcmSample(view, offset, format.bitsPerSample))
								: 0;
						};

						for (let i = 0; i < frameCount; i++) {
							leftChannel[i] = readSample(i, 0);
							rightChannel[i] = readSample(i, 1);
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
					} catch (error) {
						if (!audioDecodeErrorReported) {
							audioDecodeErrorReported = true;
							roomDebugError("audio chunk decode failed", error);
						}
					}
				});

				audioCleanupRef.current = unsubscribe;
				const loopbackStarted = await window.screenShare.startAudioLoopback(source?.id, audioFilterValue);
				const audioTrack = destination.stream.getAudioTracks()[0];
				if (!loopbackStarted || !audioTrack) {
					roomDebug("native audio loopback unavailable; using Chromium desktop audio capture");
					cleanupAudio();
					return undefined;
				}
				audioTrack.contentHint = "music";
				return audioTrack;
			};

			const nativeAudioAvailable =
				capturesAudio &&
				(isLinux || Boolean(source && desktopVideo)) &&
				typeof window.screenShare?.startAudioLoopback === "function" &&
				typeof window.screenShare?.onAudioChunk === "function";
			const nativeAudioTrack = nativeAudioAvailable ? await startNativeAudio() : undefined;

			if (nativeAudioTrack) {
				const videoStream = isLinux
					? await captureLinuxDesktop(false)
					: await navigator.mediaDevices.getUserMedia({ audio: false, video: desktopVideo });
				stream = new MediaStream([...videoStream.getVideoTracks(), nativeAudioTrack]);
			} else if (isLinux) {
				stream = await captureLinuxDesktop(capturesAudio);
			} else {
				stream = await captureLegacyDesktop(capturesAudio);
			}
			if (capturesAudio && stream.getAudioTracks().length === 0) {
				throw new Error("A fonte não forneceu uma faixa de áudio");
			}
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
			if (captureToken.current !== token || client.current !== roomClient) {
				stopTracks(stream);
				return;
			}
			cleanupAudio();
			roomClient.stopPublish();
			stopTracks(stream);
			if (localStream.current && localStream.current !== stream) stopTracks(localStream.current);
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
		audioFilter,
		loadingSources,
		startingShare,
		setPickerOpen,
		setSelectedSourceID,
		setSourceType,
		setFrameRate,
		setResolution,
		setAudioMode,
		setAudioFilter,
		loadSources,
		selectSourceType,
		selectSource,
		startSharing,
		stopSharing,
		closePicker: () => setPickerOpen(false),
		local,
	};
}
