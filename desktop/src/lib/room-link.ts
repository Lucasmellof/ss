import { SIGNALING_SERVER } from "./config";

export function buildRoomLink(room: string) {
	const url = new URL("/", SIGNALING_SERVER);
	url.searchParams.set("room", room);
	url.searchParams.set("mode", "watch");
	return url.toString();
}

export function linkedRoom() {
	if (typeof window === "undefined") return "";
	return new URLSearchParams(window.location.search).get("room")?.trim() ?? "";
}
