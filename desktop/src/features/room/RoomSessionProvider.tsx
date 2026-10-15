import { createContext, type PropsWithChildren, useEffect, useRef, useState, useContext } from "react";
import { useScreenCapture } from "@/features/capture/useScreenCapture";
import { type StreamOwner } from "@/lib/room";
import { useRoomSession } from "./useRoomSession";
import { type Tile } from "./types";
import { useRoomSounds } from "./useRoomSounds";
import { useStageControls } from "./useStageControls";
import { RoomPingProvider } from "./RoomPingProvider";

/* oxlint-disable react/jsx-no-constructed-context-values */

type RoomAppContextValue = {
	session: ReturnType<typeof useRoomSession>;
	capture: ReturnType<typeof useScreenCapture>;
	stage: ReturnType<typeof useStageControls>;
	sounds: ReturnType<typeof useRoomSounds>;
	tiles: Tile[];
	hiddenTiles: Tile[];
	hideTile: (id: string) => void;
	showTile: (id: string) => void;
	leave: () => void;
};

const RoomAppContext = createContext<RoomAppContextValue | undefined>(undefined);

export function RoomSessionProvider({ children }: PropsWithChildren) {
	const stopSharingRef = useRef<(message?: string) => void>(() => undefined);
	const [hiddenIDs, setHiddenIDs] = useState<string[]>([]);
	const session = useRoomSession({
		onStopSharing: (message) => stopSharingRef.current(message),
	});
	const capture = useScreenCapture({
		client: session.client,
		server: session.server,
		room: session.room,
		onStatus: session.setStatus,
	});

	useEffect(() => {
		stopSharingRef.current = capture.stopSharing;
	}, [capture.stopSharing]);

	const tiles: Tile[] = [
		...(capture.local
			? [
					{
						id: "local",
						name: `${session.name.trim() || "Participante"} (você)`,
						stream: capture.local,
						local: true,
					},
				]
			: []),
		...session.remote.map((item) => {
			const owner = session.streamOwners.find((streamOwner: StreamOwner) => streamOwner.publisherId === item.publisherId);
			const userName =
				owner?.name ??
				(owner?.viewerId ? session.members.find((member) => member.id === owner.viewerId)?.name : undefined) ??
				"Transmissão";

			return { id: item.id, name: userName, stream: item.stream, ownerId: owner?.viewerId };
		}),
	];
	const hiddenTiles = tiles.filter((tile) => !tile.local && hiddenIDs.includes(tile.id));
	const visibleTiles = tiles.filter((tile) => !hiddenTiles.includes(tile));
	const stage = useStageControls(visibleTiles);
	const sounds = useRoomSounds({
		joined: session.joined,
		members: session.members,
		streamOwners: session.streamOwners,
	});
	const hideTile = (id: string) => setHiddenIDs((ids) => (ids.includes(id) ? ids : [...ids, id]));
	const showTile = (id: string) => setHiddenIDs((ids) => ids.filter((item) => item !== id));
	const leave = () => {
		capture.closePicker();
		session.leave();
		stage.reset();
		setHiddenIDs([]);
	};

	// The provider value intentionally follows the live room, capture and stage state.
	const contextValue = { session, capture, stage, sounds, tiles: visibleTiles, hiddenTiles, hideTile, showTile, leave };
	return (
		<RoomAppContext.Provider value={contextValue}>
			<RoomPingProvider key={session.joined ? "joined" : "idle"} client={session.client} joined={session.joined}>
				{children}
			</RoomPingProvider>
		</RoomAppContext.Provider>
	);
}

export function useRoomApp() {
	const context = useContext(RoomAppContext);
	if (!context) throw new Error("useRoomApp precisa ser usado dentro de RoomSessionProvider");
	return context;
}
