/// <reference types="vite/client" />

declare global {
	type CaptureSource = { id: string; name: string; kind: "screen" | "window"; thumbnail: string; icon?: string };
	type UpdateInfo = {
		currentVersion: string;
		version: string;
		notes: string;
		releaseURL: string;
		assetName: string;
		assetSize: number;
		autoInstall: boolean;
	};
	type UpdateCheckResult =
		| { status: "up-to-date"; currentVersion: string }
		| { status: "available"; info: UpdateInfo }
		| { status: "error"; message: string };
	type ChangelogEntry = {
		version: string;
		tag: string;
		previousTag?: string;
		publishedAt: string;
		url: string;
		notes: string;
		status: "new" | "current" | "old";
	};
	type DesktopPlatform = "win32" | "linux" | "darwin" | "freebsd" | "unknown";
	interface Window {
		screenShare?: {
			platform: DesktopPlatform;
			sources(): Promise<CaptureSource[]>;
			setCaptureSource(sourceId: string): Promise<boolean>;
			hostname(): Promise<string>;
			startAudioLoopback(sourceId: string): Promise<boolean>;
			stopAudioLoopback(): Promise<void>;
			checkForUpdate(): Promise<UpdateCheckResult>;
			downloadUpdate(): Promise<string>;
			changelog(): Promise<ChangelogEntry[]>;
			releaseChanges(tag: string, previousTag: string): Promise<string[]>;
			onUpdateProgress(callback: (progress: { received: number; total: number }) => void): () => void;
			takePendingRoom(): Promise<string | null>;
			onOpenRoom(callback: (room: string) => void): () => void;
			onAudioChunk(callback: (buffer: Uint8Array) => void): () => void;
		};
	}
}

// oxlint-disable-next-line unicorn/require-module-specifiers
export {};
