import { type FormEvent, useEffect, useRef, useState } from "react";
import { RoomClient, type Member, type RoomStream, type StreamOwner } from "@/lib/room";
import { SIGNALING_SERVER } from "@/lib/config";
import { linkedRoom } from "@/lib/room-link";
import { storedValue } from "@/lib/storage";

// @refresh reset

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
	const onStopSharingRef = useRef<StopSharing | undefined>(onStopSharing);

	useEffect(() => {
		setRoom(linkedRoom() || storedValue("screen-share.room"));
		setName(storedValue("screen-share.name"));
	}, []);

	useEffect(() => {
		onStopSharingRef.current = onStopSharing;
	}, [onStopSharing]);

	const join = async (event?: FormEvent) => {
		event?.preventDefault();
		if (joiningRef.current) return;

		const nextRoom = room.trim();
		if (!/^[a-zA-Z0-9_-]{8,64}$/.test(nextRoom)) {
			setStatus("A sala deve ter de 8 a 64 caracteres: letras, números, hífen ou sublinhado");
			return;
		}

		const token = ++sessionToken.current;
		client.current?.close();
		setRemote([]);
		setMembers([]);
		setStreamingMembers([]);
		setStreamOwners([]);

		const nextClientRef: { current?: RoomClient } = {};
		const isCurrentSession = () => sessionToken.current === token && client.current === nextClientRef.current;
		const nextClient = new RoomClient(
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
				onStopSharingRef.current?.("O servidor encerrou a conexão");
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
		nextClientRef.current = nextClient;
		client.current = nextClient;

		const attempt = ++joinAttempt.current;
		joiningRef.current = true;
		setJoining(true);
		setStatus("Entrando na sala...");
		try {
			await nextClient.join(SIGNALING_SERVER, nextRoom, name.trim() || "Participante");
			if (!isCurrentSession()) return;
			localStorage.setItem("screen-share.room", nextRoom);
			localStorage.setItem("screen-share.name", name.trim() || "Participante");
			setRoom(nextRoom);
			setJoined(true);
		} catch (error) {
			if (isCurrentSession()) {
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
