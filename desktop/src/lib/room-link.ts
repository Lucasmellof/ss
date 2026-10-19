import { SIGNALING_SERVER } from "./config";
import { isDesktop } from "./platform";

export function buildRoomLink(room: string) {
	const url = new URL("/", SIGNALING_SERVER);
	url.searchParams.set("room", room);
	url.searchParams.set("mode", "watch");
	return url.toString();
}

export function desktopRoomLink(room: string) {
	if (isDesktop || typeof navigator === "undefined" || /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)) return undefined;
	return /^[a-zA-Z0-9_-]{8,64}$/.test(room) ? `screen-share-room://join?room=${encodeURIComponent(room)}` : undefined;
}

export function linkedRoom() {
	if (typeof window === "undefined") return "";
	return new URLSearchParams(window.location.search).get("room")?.trim() ?? "";
}
