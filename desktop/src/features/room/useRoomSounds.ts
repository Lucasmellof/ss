import { useEffect, useRef, useState } from "react";
import type { Member, StreamOwner } from "@/lib/room";
import { playRoomSound, type RoomSound } from "@/lib/sounds";
import { storedValue } from "@/lib/storage";

const STORAGE_KEY = "screen-share.sounds";
const SOUND_SPACING = 140;

export type RoomSoundsOptions = {
	joined: boolean;
	members: Member[];
	streamOwners: StreamOwner[];
};

export function useRoomSounds({ joined, members, streamOwners }: RoomSoundsOptions) {
	const [enabled, setEnabled] = useState(() => storedValue(STORAGE_KEY) !== "off");
	const enabledRef = useRef(enabled);
	const wasJoinedRef = useRef(joined);
	const knownMembers = useRef<Set<string> | undefined>(undefined);
	const knownOwners = useRef<Map<string, string> | undefined>(undefined);
	const pendingSounds = useRef<number[]>([]);

	const cancelPendingSounds = () => {
		pendingSounds.current.forEach((timer) => window.clearTimeout(timer));
		pendingSounds.current = [];
	};

	useEffect(() => {
		enabledRef.current = enabled;
	}, [enabled]);

	useEffect(() => {
		const wasJoined = wasJoinedRef.current;
		wasJoinedRef.current = joined;
		if (wasJoined === joined || !enabledRef.current) return;
		// Cobre entrar, sair pelo botão e queda de conexão: todos mudam `joined`.
		playRoomSound(joined ? "self-joined" : "self-left");
	}, [joined]);

	useEffect(() => {
		if (!joined) {
			cancelPendingSounds();
			knownMembers.current = undefined;
			knownOwners.current = undefined;
			return;
		}

		const nextMembers = new Set(members.map((member) => member.id));
		const nextOwners = new Map(streamOwners.map((owner) => [owner.publisherId, owner.viewerId] as const));
		const previousMembers = knownMembers.current;
		const previousOwners = knownOwners.current;
		// Entre o "joined" e o primeiro status a lista chega vazia: não é a sala real ainda.
		if (!previousMembers && members.length === 0) return;
		knownMembers.current = nextMembers;
		knownOwners.current = nextOwners;
		// A primeira leitura da sala só serve de referência: ninguém acabou de entrar.
		if (!previousMembers || !previousOwners) return;

		const joinedMembers = [...nextMembers].filter((id) => !previousMembers.has(id));
		const leftMembers = [...previousMembers].filter((id) => !nextMembers.has(id));
		const startedShares = [...nextOwners.keys()].filter((publisherID) => !previousOwners.has(publisherID));
		// Quem sai da sala transmitindo já avisa com o som de saída; não toca os dois.
		const stoppedShares = [...previousOwners].filter(
			([publisherID, viewerID]) => !nextOwners.has(publisherID) && !leftMembers.includes(viewerID),
		);

		const queue: RoomSound[] = [
			...(joinedMembers.length > 0 ? (["member-joined"] as const) : []),
			...(leftMembers.length > 0 ? (["member-left"] as const) : []),
			...(startedShares.length > 0 ? (["share-started"] as const) : []),
			...(stoppedShares.length > 0 ? (["share-stopped"] as const) : []),
		];
		if (queue.length === 0 || !enabledRef.current) return;

		// Os timers só são descartados ao sair da sala: uma atualização de status
		// no meio da fila não pode engolir um som que já foi decidido.
		queue.forEach((sound, index) => {
			if (index === 0) {
				playRoomSound(sound);
				return;
			}
			pendingSounds.current.push(window.setTimeout(() => playRoomSound(sound), index * SOUND_SPACING));
		});
	}, [joined, members, streamOwners]);

	useEffect(() => () => cancelPendingSounds(), []);

	const toggleSounds = () => {
		const next = !enabled;
		setEnabled(next);
		window.localStorage.setItem(STORAGE_KEY, next ? "on" : "off");
		if (next) playRoomSound("member-joined", 0.7);
	};

	return { soundsEnabled: enabled, toggleSounds };
}
