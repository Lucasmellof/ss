import { type FormEvent, useEffect, useRef, useState } from "react";
import { RoomClient, type Member, type RoomStream, type StreamOwner } from "@/lib/room";
import { SIGNALING_SERVER } from "@/lib/config";
import { desktop } from "@/lib/platform";
import { linkedRoom } from "@/lib/room-link";
import { storedValue } from "@/lib/storage";

// @refresh reset

const RECONNECT_ATTEMPTS = 5;
const RECONNECT_STEP_MS = 3_000;

type StopSharing = (message?: string) => void;

export type RoomSessionOptions = {
	onStopSharing?: StopSharing;
};

export type RoomClientRef = { current: RoomClient | undefined };

export function useRoomSession({ onStopSharing }: RoomSessionOptions = {}) {
	const [room, setRoom] = useState("");
	const [name, setName] = useState("");
	const [joined, setJoined] = useState(false);
	const [joining, setJoining] = useState(false);
	const [status, setStatus] = useState("Escolha uma sala para começar");
	const [members, setMembers] = useState<Member[]>([]);
	const [streamingMembers, setStreamingMembers] = useState<string[]>([]);
	const [streamOwners, setStreamOwners] = useState<StreamOwner[]>([]);
	const [remote, setRemote] = useState<RoomStream[]>([]);
	const client = useRef<RoomClient | undefined>(undefined);
	const sessionToken = useRef(0);
	const joinAttempt = useRef(0);
	const joiningRef = useRef(false);
	const wasJoined = useRef(false);
	const reconnecting = useRef(false);
	const onStopSharingRef = useRef<StopSharing | undefined>(onStopSharing);
	const openLinkedRoomRef = useRef<(linkedRoom: string) => void>(() => {});

	useEffect(() => {
		setRoom(linkedRoom() || storedValue("screen-share.room"));
		setName(storedValue("screen-share.name"));
	}, []);

	useEffect(() => {
		onStopSharingRef.current = onStopSharing;
	}, [onStopSharing]);

	const createClient = (token: number, targetRoom: string, displayName: string) => {
		const clientRef: { current?: RoomClient } = {};
		const isCurrentSession = () => sessionToken.current === token && client.current === clientRef.current;
		const created = new RoomClient(
			(streams) => {
				if (isCurrentSession()) setRemote(streams);
			},
			(text) => {
				if (isCurrentSession()) setStatus(text);
			},
			undefined,
			(nextMembers) => {
				if (isCurrentSession()) setMembers(nextMembers);
			},
			(publishing) => {
				if (isCurrentSession() && !publishing) {
					onStopSharingRef.current?.("A conexão de transmissão foi encerrada");
				}
			},
			() => {
				if (!isCurrentSession()) return;
				if (wasJoined.current && !reconnecting.current) {
					onStopSharingRef.current?.("A conexão com a sala foi perdida");
					const resumeToken = created.getResumeToken();
					created.close();
					client.current = undefined;
					void reconnect(token, targetRoom, displayName, resumeToken);
					return;
				}
				onStopSharingRef.current?.("O servidor encerrou a conexão");
				created.close();
				client.current = undefined;
				setJoined(false);
				setStatus("O servidor encerrou a conexão");
			},
			(viewerIDs) => {
				if (isCurrentSession()) setStreamingMembers(viewerIDs);
			},
			(owners) => {
				if (isCurrentSession()) setStreamOwners(owners);
			},
		);
		clientRef.current = created;
		return created;
	};

	const reconnect = async (token: number, targetRoom: string, displayName: string, resumeToken?: string) => {
		reconnecting.current = true;
		try {
			for (let attempt = 0; attempt < RECONNECT_ATTEMPTS; attempt++) {
				if (attempt > 0) {
					const delay = RECONNECT_STEP_MS * attempt;
					setStatus(`Reconexão falhou. Nova tentativa em ${delay / 1000}s (${attempt + 1}/${RECONNECT_ATTEMPTS})`);
					await new Promise((resolve) => window.setTimeout(resolve, delay));
				}
				if (sessionToken.current !== token) return;
				setStatus(`Reconectando à sala... (${attempt + 1}/${RECONNECT_ATTEMPTS})`);
				const next = createClient(token, targetRoom, displayName);
				client.current = next;
				try {
					await next.join(SIGNALING_SERVER, targetRoom, displayName, resumeToken);
					if (sessionToken.current !== token || client.current !== next) return;
					setJoined(true);
					return;
				} catch {
					if (client.current === next) {
						next.close();
						client.current = undefined;
					}
				}
			}
			if (sessionToken.current !== token) return;
			wasJoined.current = false;
			setJoined(false);
			setStatus("Não foi possível reconectar à sala");
		} finally {
			if (sessionToken.current === token) reconnecting.current = false;
		}
	};

	const join = async (event?: FormEvent) => {
		event?.preventDefault();
		await enterRoom(room.trim(), name.trim() || "Participante");
	};

	const enterRoom = async (nextRoom: string, displayName: string) => {
		if (joiningRef.current) return;

		if (!/^[a-zA-Z0-9_-]{8,64}$/.test(nextRoom)) {
			setStatus("A sala deve ter de 8 a 64 caracteres: letras, números, hífen ou sublinhado");
			return;
		}

		const token = ++sessionToken.current;
		reconnecting.current = false;
		client.current?.close();
		setRemote([]);
		setMembers([]);
		setStreamingMembers([]);
		setStreamOwners([]);

		const nextClient = createClient(token, nextRoom, displayName);
		client.current = nextClient;

		const attempt = ++joinAttempt.current;
		joiningRef.current = true;
		setJoining(true);
		setStatus("Entrando na sala...");
		try {
			await nextClient.join(SIGNALING_SERVER, nextRoom, displayName);
			if (sessionToken.current !== token || client.current !== nextClient) return;
			localStorage.setItem("screen-share.room", nextRoom);
			localStorage.setItem("screen-share.name", displayName);
			setRoom(nextRoom);
			wasJoined.current = true;
			setJoined(true);
		} catch (error) {
			if (sessionToken.current === token && client.current === nextClient) {
				nextClient.close();
				client.current = undefined;
				setStatus(error instanceof Error ? error.message : "Não foi possível entrar na sala");
			}
		} finally {
			if (joinAttempt.current === attempt) {
				joiningRef.current = false;
				setJoining(false);
			}
		}
	};

	const leave = () => {
		sessionToken.current += 1;
		wasJoined.current = false;
		reconnecting.current = false;
		const currentClient = client.current;
		currentClient?.close();
		onStopSharingRef.current?.();
		client.current = undefined;
		setRemote([]);
		setMembers([]);
		setStreamingMembers([]);
		setStreamOwners([]);
		setJoined(false);
		setStatus("Você saiu da sala");
	};

	useEffect(() => {
		openLinkedRoomRef.current = (linkedRoom) => {
			if (wasJoined.current && room === linkedRoom) return;
			setRoom(linkedRoom);
			const displayName = name.trim() || storedValue("screen-share.name");
			if (!displayName) {
				setStatus("Digite seu nome para entrar na sala do link");
				return;
			}
			if (wasJoined.current) leave();
			void enterRoom(linkedRoom, displayName);
		};
	});

	useEffect(() => {
		if (!desktop) return undefined;
		void desktop.takePendingRoom().then((linkedRoom) => {
			if (linkedRoom) openLinkedRoomRef.current(linkedRoom);
		});
		return desktop.onOpenRoom((linkedRoom) => openLinkedRoomRef.current(linkedRoom));
	}, []);

	useEffect(
		() => () => {
			sessionToken.current += 1;
			client.current?.close();
			client.current = undefined;
		},
		[],
	);

	return {
		server: SIGNALING_SERVER,
		room,
		name,
		setRoom,
		setName,
		joined,
		joining,
		status,
		setStatus,
		members,
		streamingMembers,
		streamOwners,
		remote,
		client,
		join,
		leave,
	};
}
