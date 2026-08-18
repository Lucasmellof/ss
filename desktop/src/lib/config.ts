export const SIGNALING_SERVER =
	import.meta.env.VITE_SIGNALING_SERVER ?? (import.meta.env.DEV ? "http://localhost:8080" : "https://ss.carmellium.com");
