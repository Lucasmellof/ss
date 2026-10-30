import { useEffect, useRef, useState } from "react";
import { RoomClient } from "@/lib/room";
import { roomDebug, roomDebugError } from "@/lib/room/debug";
import { type CameraResolution, cameraBitrate, cameraResolutions, type FrameRate } from "./types";

type RoomClientRef = { current: RoomClient | undefined };

export type CameraCaptureOptions = {
	client: RoomClientRef;
	server: string;
	room: string;
	onStatus: (text: string) => void;
};

type CameraSettings = {
	deviceID: string;
	resolution: CameraResolution;
	frameRate: FrameRate;
};

const stopTracks = (stream: MediaStream | undefined | null) => {
	stream?.getTracks().forEach((track) => track.stop());
};

const settingsKey = ({ deviceID, resolution, frameRate }: CameraSettings) => `${deviceID}|${resolution}|${frameRate}`;

const cameraErrorMessage = (error: unknown) => {
	if (error instanceof DOMException) {
		if (error.name === "NotAllowedError") return "O acesso à câmera foi negado";
		if (error.name === "NotFoundError" || error.name === "OverconstrainedError") return "Nenhuma câmera compatível foi encontrada";
		if (error.name === "NotReadableError") return "A câmera está em uso por outro aplicativo";
	}
	return error instanceof Error ? error.message : "Não foi possível abrir a câmera";
};

export function useCameraCapture({ client, server, room, onStatus }: CameraCaptureOptions) {
	const [local, setLocal] = useState<MediaStream | null>(null);
	const [pickerOpen, setPickerOpen] = useState(false);
	const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
	const [deviceID, setDeviceID] = useState("");
	const [resolution, setResolution] = useState<CameraResolution>("720p");
	const [frameRate, setFrameRate] = useState<FrameRate>(30);
	const [preview, setPreview] = useState<MediaStream | null>(null);
	const [loading, setLoading] = useState(false);
	const [starting, setStarting] = useState(false);
	const [error, setError] = useState("");
	const localStream = useRef<MediaStream | null>(null);
	const previewStream = useRef<MediaStream | null>(null);
	const previewKey = useRef("");
	const previewToken = useRef(0);
	const captureToken = useRef(0);
	const activeSettings = useRef<CameraSettings | null>(null);
	const serverRef = useRef(server);
	const roomRef = useRef(room);
	const onStatusRef = useRef(onStatus);

	useEffect(() => {
		serverRef.current = server;
		roomRef.current = room;
		onStatusRef.current = onStatus;
	}, [server, room, onStatus]);

	// Stops the picker preview unless it already became the live transmission.
	const releasePreview = () => {
		previewToken.current += 1;
		const stream = previewStream.current;
		previewStream.current = null;
		previewKey.current = "";
		if (stream !== localStream.current) stopTracks(stream);
		setPreview(null);
	};

	const acquire = async ({ deviceID: id, resolution: resolutionValue, frameRate: frameRateValue }: CameraSettings) => {
		const selected = cameraResolutions[resolutionValue];
		const stream = await navigator.mediaDevices.getUserMedia({
			audio: false,
			video: {
				...(id ? { deviceId: { exact: id } } : {}),
				width: { ideal: selected.width },
				height: { ideal: selected.height },
				frameRate: { ideal: frameRateValue, max: frameRateValue },
			},
		});
		const track = stream.getVideoTracks()[0];
		if (!track) {
			stopTracks(stream);
			throw new Error("A câmera não forneceu um vídeo");
		}
		// "motion" makes the encoder favour frame rate over sharpness, which keeps camera latency low.
		track.contentHint = "motion";
		return stream;
	};

	useEffect(() => {
		if (!pickerOpen) return;
		const settings = { deviceID, resolution, frameRate };
		const key = settingsKey(settings);
		if (previewStream.current && previewKey.current === key) return;
		const active = activeSettings.current;
		if (localStream.current && active && settingsKey(active) === key) {
			if (previewStream.current !== localStream.current) stopTracks(previewStream.current);
			previewStream.current = localStream.current;
			previewKey.current = key;
			setPreview(localStream.current);
			return;
		}

		const token = ++previewToken.current;
		setLoading(true);
		setError("");
		void (async () => {
			try {
				// Release the old preview first: some webcams cannot be opened twice with different settings.
				if (previewStream.current && previewStream.current !== localStream.current) stopTracks(previewStream.current);
				const stream = await acquire(settings);
				if (previewToken.current !== token) {
					stopTracks(stream);
					return;
				}
				const actualDeviceID = stream.getVideoTracks()[0]?.getSettings().deviceId ?? deviceID;
				previewStream.current = stream;
				previewKey.current = settingsKey({ ...settings, deviceID: actualDeviceID });
				setPreview(stream);
				// Labels are only exposed after the camera permission is granted, so list devices afterwards.
				const available = (await navigator.mediaDevices.enumerateDevices()).filter((device) => device.kind === "videoinput");
				if (previewToken.current !== token) return;
				setDevices(available);
				if (actualDeviceID !== deviceID) setDeviceID(actualDeviceID);
			} catch (acquireError) {
				if (previewToken.current !== token) return;
				roomDebugError("camera preview failed", acquireError);
				previewStream.current = null;
				previewKey.current = "";
				setPreview(null);
				setError(cameraErrorMessage(acquireError));
			} finally {
				if (previewToken.current === token) setLoading(false);
			}
		})();
	}, [pickerOpen, deviceID, resolution, frameRate]);

	const openPicker = () => {
		setError("");
		setPickerOpen(true);
	};

	const watchTrack = (stream: MediaStream) => {
		stream.getVideoTracks()[0]?.addEventListener(
			"ended",
			() => {
				if (localStream.current === stream) stopCamera("A câmera foi desconectada");
			},
			{ once: true },
		);
	};

	const stopCamera = (message = "Câmera encerrada") => {
		roomDebug("camera stop", { message, hadStream: Boolean(localStream.current) });
		captureToken.current += 1;
		void client.current?.stopPublish("camera");
		const stream = localStream.current;
		localStream.current = null;
		activeSettings.current = null;
		if (previewStream.current === stream) releasePreview();
		stopTracks(stream);
		setLocal(null);
		setStarting(false);
		onStatusRef.current(message);
	};

	const startCamera = async () => {
		const roomClient = client.current;
		if (!roomClient) return;
		const settings = { deviceID, resolution, frameRate };
		const maxBitrate = cameraBitrate(resolution, frameRate);
		const previous = localStream.current;
		const token = ++captureToken.current;
		roomDebug("camera start", { ...settings, maxBitrate, live: Boolean(previous) });
		setStarting(true);
		setError("");
		let stream = previewStream.current;
		try {
			if (!stream) {
				// Drop any preview still being opened; the transmission acquires its own stream.
				previewToken.current += 1;
				setLoading(false);
				stream = await acquire(settings);
			}
			if (captureToken.current !== token || client.current !== roomClient) {
				if (stream !== previewStream.current) stopTracks(stream);
				return;
			}
			if (stream === previous) {
				setPickerOpen(false);
				releasePreview();
				return;
			}
			watchTrack(stream);
			// Hand the preview over to the transmission so the camera is not reopened.
			previewStream.current = null;
			previewKey.current = "";
			setPreview(null);
			localStream.current = stream;
			activeSettings.current = { ...settings, deviceID: stream.getVideoTracks()[0]?.getSettings().deviceId ?? deviceID };
			setLocal(stream);
			setPickerOpen(false);
			const replaced = previous ? await roomClient.replaceTracks(stream, frameRate, maxBitrate, "camera") : false;
			stopTracks(previous);
			if (!replaced) {
				onStatusRef.current("Conectando câmera...");
				await roomClient.publish(serverRef.current.trim(), roomRef.current.trim(), stream, frameRate, maxBitrate, "camera");
			}
			if (localStream.current === stream && captureToken.current === token && client.current === roomClient) {
				onStatusRef.current(`Câmera ao vivo · ${cameraResolutions[resolution].label} · ${frameRate} FPS`);
			}
		} catch (startError) {
			roomDebugError("camera start failed", startError);
			if (captureToken.current !== token || client.current !== roomClient) return;
			const message = cameraErrorMessage(startError);
			if (stream && localStream.current === stream) {
				stopCamera(message);
				return;
			}
			setError(message);
			onStatusRef.current(message);
		} finally {
			if (captureToken.current === token) setStarting(false);
		}
	};

	const closePicker = () => {
		setPickerOpen(false);
		releasePreview();
		// Discard options edited in the picker that were never applied to the running camera.
		const active = activeSettings.current;
		if (localStream.current && active) {
			setDeviceID(active.deviceID);
			setResolution(active.resolution);
			setFrameRate(active.frameRate);
		}
	};

	useEffect(
		() => () => {
			captureToken.current += 1;
			previewToken.current += 1;
			void client.current?.stopPublish("camera");
			stopTracks(previewStream.current);
			stopTracks(localStream.current);
			previewStream.current = null;
			localStream.current = null;
		},
		[client],
	);

	return {
		live: Boolean(local),
		local,
		pickerOpen,
		devices,
		deviceID,
		resolution,
		frameRate,
		preview,
		loading,
		starting,
		error,
		setDeviceID,
		setResolution,
		setFrameRate,
		openPicker,
		closePicker,
		startCamera,
		stopCamera,
	};
}
