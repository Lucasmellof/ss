import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("screenShare", {
	sources: () => ipcRenderer.invoke("capture:sources"),
	hostname: () => ipcRenderer.invoke("system:hostname"),
});
