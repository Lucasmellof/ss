import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("screenShare", {
	platform: process.platform,
	sources: () => ipcRenderer.invoke("capture:sources"),
	setCaptureSource: (sourceId: string) => ipcRenderer.invoke("capture:set-source", sourceId),
	hostname: () => ipcRenderer.invoke("system:hostname"),
	startAudioLoopback: (sourceId: string) => ipcRenderer.invoke("capture:start-audio-loopback", sourceId),
	stopAudioLoopback: () => ipcRenderer.invoke("capture:stop-audio-loopback"),
	onAudioChunk: (callback: (buffer: Uint8Array) => void) => {
		const handler = (_event: Electron.IpcRendererEvent, chunk: Uint8Array) => callback(chunk);
		ipcRenderer.on("capture:audio-chunk", handler);
		return () => {
			ipcRenderer.removeListener("capture:audio-chunk", handler);
		};
	},
});
