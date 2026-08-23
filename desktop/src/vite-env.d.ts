/// <reference types="vite/client" />

declare global {
	type CaptureSource = { id: string; name: string; kind: "screen" | "window"; thumbnail: string; icon?: string };
	type DesktopPlatform = "win32" | "linux" | "darwin" | "freebsd" | "unknown";
	interface Window {
		screenShare: {
			platform: DesktopPlatform;
			sources(): Promise<CaptureSource[]>;
			setCaptureSource(sourceId: string): Promise<boolean>;
			hostname(): Promise<string>;
			startAudioLoopback(sourceId: string): Promise<boolean>;
			stopAudioLoopback(): Promise<void>;
			onAudioChunk(callback: (buffer: Uint8Array) => void): () => void;
		};
	}
}

// oxlint-disable-next-line unicorn/require-module-specifiers
export {};
