/// <reference types="vite/client" />

declare global {
	type CaptureSource = { id: string; name: string; kind: "screen" | "window"; thumbnail: string; icon?: string };
	interface Window {
		screenShare: { sources(): Promise<CaptureSource[]>; hostname(): Promise<string> };
	}
}

// oxlint-disable-next-line unicorn/require-module-specifiers
export {};
