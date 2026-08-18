import { createContext, type PropsWithChildren, useContext, useEffect, useState } from "react";
import type { RoomClient } from "@/lib/room";

type RoomClientRef = { current: RoomClient | undefined };

const RoomPingContext = createContext<number | undefined>(undefined);

type RoomPingProviderProps = PropsWithChildren<{
	client: RoomClientRef;
	joined: boolean;
}>;

export function RoomPingProvider({ client, joined, children }: RoomPingProviderProps) {
	const [ping, setPing] = useState<number>();

	useEffect(() => {
		if (!joined) return;
		let active = true;
		const measure = async () => {
			const currentClient = client.current;
			const nextPing = await currentClient?.ping();
			if (active && currentClient === client.current) setPing(nextPing);
		};
		void measure();
		const interval = window.setInterval(() => void measure(), 5_000);
		return () => {
			active = false;
			window.clearInterval(interval);
		};
	}, [client, joined]);

	return <RoomPingContext.Provider value={ping}>{children}</RoomPingContext.Provider>;
}

export function useRoomPing() {
	return useContext(RoomPingContext);
}
