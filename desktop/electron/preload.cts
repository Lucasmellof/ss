import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("screenShare", {
	platform: process.platform,
	sources: () => ipcRenderer.invoke("capture:sources"),
	setCaptureSource: (sourceId: string, audio?: boolean) => ipcRenderer.invoke("capture:set-source", sourceId, audio),
	screenPermission: () => ipcRenderer.invoke("capture:permission"),
	openScreenPermissionSettings: () => ipcRenderer.invoke("capture:open-permission-settings"),
	hostname: () => ipcRenderer.invoke("system:hostname"),
	startAudioLoopback: (sourceId: string) => ipcRenderer.invoke("capture:start-audio-loopback", sourceId),
	stopAudioLoopback: () => ipcRenderer.invoke("capture:stop-audio-loopback"),
	checkForUpdate: () => ipcRenderer.invoke("update:check"),
	downloadUpdate: () => ipcRenderer.invoke("update:download"),
	changelog: () => ipcRenderer.invoke("update:changelog"),
	releaseChanges: (tag: string, previousTag: string) => ipcRenderer.invoke("update:changes", tag, previousTag),
	onUpdateProgress: (callback: (progress: { received: number; total: number }) => void) => {
		const handler = (_event: Electron.IpcRendererEvent, progress: { received: number; total: number }) => callback(progress);
		ipcRenderer.on("update:progress", handler);
		return () => {
			ipcRenderer.removeListener("update:progress", handler);
		};
	},
	takePendingRoom: () => ipcRenderer.invoke("room:take-pending"),
	onOpenRoom: (callback: (room: string) => void) => {
		const handler = (_event: Electron.IpcRendererEvent, room: string) => callback(room);
		ipcRenderer.on("room:open", handler);
		return () => {
			ipcRenderer.removeListener("room:open", handler);
		};
	},
	onAudioChunk: (callback: (buffer: Uint8Array) => void) => {
		const handler = (_event: Electron.IpcRendererEvent, chunk: Uint8Array) => callback(chunk);
		ipcRenderer.on("capture:audio-chunk", handler);
		return () => {
			ipcRenderer.removeListener("capture:audio-chunk", handler);
		};
	},
});
