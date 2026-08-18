import { app, BrowserWindow, desktopCapturer, ipcMain, net, protocol } from "electron";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const clientRoot = path.resolve(root, "../dist/client");

protocol.registerSchemesAsPrivileged([{ scheme: "screen-share", privileges: { standard: true, secure: true, supportFetchAPI: true } }]);

async function sources() {
	try {
		const items = await desktopCapturer.getSources({
			types: ["screen", "window"],
			thumbnailSize: { width: 480, height: 270 },
			fetchWindowIcons: true,
		});
		return items.map((item) => ({
			id: item.id,
			name: item.name,
			kind: item.id.startsWith("screen:") ? "screen" : "window",
			thumbnail: item.thumbnail.isEmpty() ? "" : item.thumbnail.toDataURL(),
			icon: item.appIcon?.isEmpty() ? undefined : item.appIcon?.toDataURL(),
		}));
	} catch (error) {
		console.error("Não foi possível listar fontes de captura:", error);
		throw new Error(error instanceof Error ? error.message : "Falha ao listar fontes de captura.", { cause: error });
	}
}

function createWindow() {
	const window = new BrowserWindow({
		width: 1240,
		height: 840,
		minWidth: 900,
		minHeight: 650,
		backgroundColor: "#09090b",
		webPreferences: { preload: path.join(root, "preload.cjs"), contextIsolation: true, nodeIntegration: false, sandbox: false },
	});
	const devURL = process.env.VITE_DEV_SERVER_URL;
	if (devURL) void window.loadURL(devURL);
	else void window.loadURL("screen-share://app/_shell.html");
}

app.whenReady().then(() => {
	protocol.handle("screen-share", (request) => {
		const requestedPath = decodeURIComponent(new URL(request.url).pathname);
		const filePath = path.resolve(clientRoot, `.${requestedPath}`);
		if (filePath !== clientRoot && !filePath.startsWith(`${clientRoot}${path.sep}`)) {
			return new Response("Not found", { status: 404 });
		}
		return net.fetch(pathToFileURL(filePath).toString());
	});
	ipcMain.handle("capture:sources", sources);
	ipcMain.handle("system:hostname", () => os.hostname());
	createWindow();
	app.on("activate", () => {
		if (BrowserWindow.getAllWindows().length === 0) createWindow();
	});
	return undefined;
});
app.on("window-all-closed", () => {
	if (process.platform !== "darwin") app.quit();
});
