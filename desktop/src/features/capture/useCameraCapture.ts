import { useEffect, useRef, useState } from "react";
import { RoomClient } from "@/lib/room";
import { roomDebugError } from "@/lib/room/debug";
import { storedValue } from "@/lib/storage";

type RoomClientRef = { current: RoomClient | undefined };

export type CameraCaptureOptions = {
	client: RoomClientRef;
	server: string;
	room: string;
	onStatus: (text: string) => void;
};

const CAMERA_FRAME_RATE = 30;
const CAMERA_MAX_BITRATE = 2_500_000;
const CAMERA_STORAGE_KEY = "screen-share.camera";

export type CameraDevice = { id: string; label: string };

export function useCameraCapture({ client, server, room, onStatus }: CameraCaptureOptions) {
	const [local, setLocal] = useState<MediaStream | null>(null);
	const [starting, setStarting] = useState(false);
	const [devices, setDevices] = useState<CameraDevice[]>([]);
	const [pickerOpen, setPickerOpen] = useState(false);
	const localStream = useRef<MediaStream | null>(null);
	const token = useRef(0);

	const stopCamera = (message = "Câmera desligada") => {
		token.current += 1;
		client.current?.stopPublish("camera");
		localStream.current?.getTracks().forEach((track) => track.stop());
		localStream.current = null;
		setLocal(null);
		setStarting(false);
		onStatus(message);
	};

	const openPicker = async () => {
		try {
			const found = (await navigator.mediaDevices.enumerateDevices())
				.filter((device) => device.kind === "videoinput")
				.map((device, index) => ({ id: device.deviceId, label: device.label || `Câmera ${index + 1}` }));
			if (found.length === 0) {
				onStatus("Nenhuma câmera encontrada");
				return;
			}
			if (found.length === 1) {
				void startCamera(found[0].id);
				return;
			}
			setDevices(found);
			setPickerOpen(true);
		} catch (error) {
			roomDebugError("camera enumerate failed", error);
			onStatus("Não foi possível listar as câmeras");
		}
	};

	const startCamera = async (deviceId: string) => {
		const roomClient = client.current;
		if (!roomClient) return;
		setPickerOpen(false);
		localStorage.setItem(CAMERA_STORAGE_KEY, deviceId);
		const current = ++token.current;
		setStarting(true);
		let stream: MediaStream | undefined;
		try {
			stream = await navigator.mediaDevices.getUserMedia({
				audio: false,
				video: {
					deviceId: deviceId ? { exact: deviceId } : undefined,
					width: { ideal: 1280 },
					height: { ideal: 720 },
					frameRate: { ideal: CAMERA_FRAME_RATE },
				},
			});
			if (token.current !== current || client.current !== roomClient) {
				stream.getTracks().forEach((track) => track.stop());
				return;
			}
			const videoTrack = stream.getVideoTracks()[0];
			videoTrack.contentHint = "motion";
			videoTrack.addEventListener(
				"ended",
				() => {
					if (localStream.current === stream && token.current === current) stopCamera("A câmera foi desconectada");
				},
				{ once: true },
			);
			localStream.current = stream;
			setLocal(stream);
			await roomClient.publish("camera", server.trim(), room.trim(), stream, CAMERA_FRAME_RATE, CAMERA_MAX_BITRATE);
			if (token.current === current) onStatus("Câmera ao vivo");
		} catch (error) {
			roomDebugError("camera start failed", error);
			if (token.current !== current) return;
			const denied = error instanceof DOMException && error.name === "NotAllowedError";
			const missing = error instanceof DOMException && error.name === "NotFoundError";
			stopCamera(
				denied
					? "Permissão de câmera negada"
					: missing
						? "Nenhuma câmera encontrada"
						: error instanceof Error
							? error.message
							: "Não foi possível ligar a câmera",
			);
		} finally {
			if (token.current === current) setStarting(false);
		}
	};

	useEffect(
		() => () => {
			token.current += 1;
			client.current?.stopPublish("camera");
			localStream.current?.getTracks().forEach((track) => track.stop());
			localStream.current = null;
		},
		[client],
	);

	return {
		local,
		active: Boolean(local),
		starting,
		devices,
		pickerOpen,
		lastDeviceId: storedValue(CAMERA_STORAGE_KEY),
		openPicker,
		closePicker: () => setPickerOpen(false),
		startCamera,
		stopCamera,
	};
}
