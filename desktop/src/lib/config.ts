import { isDesktop } from "./platform";

const webOrigin = !isDesktop && typeof window !== "undefined" ? window.location.origin : undefined;

export const SIGNALING_SERVER =
	import.meta.env.VITE_SIGNALING_SERVER ?? (import.meta.env.DEV ? "http://localhost:8080" : (webOrigin ?? "https://ss.carmellium.com"));
