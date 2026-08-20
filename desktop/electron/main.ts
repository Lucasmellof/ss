import { app, BrowserWindow, desktopCapturer, ipcMain, net, protocol } from "electron";
import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const clientRoot = path.resolve(root, "../dist/client");

protocol.registerSchemesAsPrivileged([{ scheme: "screen-share", privileges: { standard: true, secure: true, supportFetchAPI: true } }]);

let activeAudioProcess: ChildProcessWithoutNullStreams | null = null;

function getAudioLoopbackPath(): string {
	const possiblePaths = [
		path.join(process.resourcesPath, "tools/audio-loopback/AudioLoopback.exe"),
		path.resolve(root, "../build/audio-loopback/AudioLoopback.exe"),
		path.resolve(root, "../tools/audio-loopback/AudioLoopback.exe"),
		path.resolve(root, "../../tools/audio-loopback/AudioLoopback.exe"),
		path.resolve(process.cwd(), "tools/audio-loopback/AudioLoopback.exe"),
	];
	for (const p of possiblePaths) {
		if (fs.existsSync(p)) return p;
	}
	return possiblePaths[1];
}

function stopAudioProcess() {
	if (activeAudioProcess) {
		try {
			activeAudioProcess.kill();
		} catch {
			// ignora erro ao encerrar processo
		}
		activeAudioProcess = null;
	}
}

async function startAudioLoopback(window: BrowserWindow, sourceId: string): Promise<boolean> {
	stopAudioProcess();
	const isWindow = sourceId.startsWith("window:");
	const isScreen = sourceId.startsWith("screen:");
	console.log("[AudioLoopback] startAudioLoopback chamado:", { sourceId, isWindow, isScreen });
	if (!isWindow && !isScreen) return false;

	const exePath = getAudioLoopbackPath();
	console.log("[AudioLoopback] exePath:", exePath, "exists:", fs.existsSync(exePath));
	if (!fs.existsSync(exePath)) {
		console.error("AudioLoopback.exe não encontrado em:", exePath);
		return false;
	}

	const args: string[] = [];
	if (isWindow) {
		const parts = sourceId.split(":");
		const hwnd = parts[1];
		console.log("[AudioLoopback] sourceId partes:", parts, "hwnd extraído:", hwnd);
		if (!hwnd) return false;
		args.push("--hwnd", hwnd);
	} else {
		args.push("--exclude-discord");
	}

	console.log("[AudioLoopback] Iniciando processo com args:", args);
	try {
		const proc = spawn(exePath, args);
		activeAudioProcess = proc;
		let startupResolved = false;
		let resolveStartup!: (started: boolean) => void;
		const startup = new Promise<boolean>((resolve) => {
			resolveStartup = resolve;
		});
		const startupTimeout = setTimeout(() => {
			if (startupResolved) return;
			console.error("[AudioLoopback] O helper não enviou áudio durante a inicialização");
			stopAudioProcess();
			startupResolved = true;
			resolveStartup(false);
		}, 2_000);
		const markStarted = () => {
			if (startupResolved) return;
			startupResolved = true;
			clearTimeout(startupTimeout);
			resolveStartup(true);
		};

		proc.stdout.on("data", (chunk: Buffer) => {
			markStarted();
			if (!window.isDestroyed()) {
				window.webContents.send("capture:audio-chunk", new Uint8Array(chunk));
			}
		});

		proc.stderr.on("data", (data) => {
			console.error("[AudioLoopback stderr]", data.toString());
		});

		proc.on("exit", (code) => {
			console.log("[AudioLoopback] Processo encerrado com código:", code);
			if (!startupResolved) {
				startupResolved = true;
				clearTimeout(startupTimeout);
				resolveStartup(false);
			}
			if (activeAudioProcess === proc) {
				activeAudioProcess = null;
			}
		});

		proc.on("error", (err) => {
			console.error("[AudioLoopback] Erro ao iniciar processo:", err);
			if (!startupResolved) {
				startupResolved = true;
				clearTimeout(startupTimeout);
				resolveStartup(false);
			}
		});

		console.log("[AudioLoopback] Processo iniciado, PID:", proc.pid);
		return await startup;
	} catch (error) {
		console.error("Erro ao iniciar AudioLoopback:", error);
		return false;
	}
}

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
	else void window.loadURL("screen-share://app/");
}

app.whenReady().then(() => {
	protocol.handle("screen-share", (request) => {
		const requestedPath = decodeURIComponent(new URL(request.url).pathname);
		const assetPath = requestedPath === "/" ? "/_shell.html" : requestedPath;
		const filePath = path.resolve(clientRoot, `.${assetPath}`);
		if (filePath !== clientRoot && !filePath.startsWith(`${clientRoot}${path.sep}`)) {
			return new Response("Not found", { status: 404 });
		}
		return net.fetch(pathToFileURL(filePath).toString());
	});

	ipcMain.handle("capture:sources", sources);
	ipcMain.handle("system:hostname", () => os.hostname());
	ipcMain.handle("capture:start-audio-loopback", (_event, sourceId: string) => {
		const win = BrowserWindow.fromWebContents(_event.sender);
		if (!win) return false;
		return startAudioLoopback(win, sourceId);
	});
	ipcMain.handle("capture:stop-audio-loopback", () => {
		stopAudioProcess();
		return true;
	});

	createWindow();
	app.on("activate", () => {
		if (BrowserWindow.getAllWindows().length === 0) createWindow();
	});
	return undefined;
});

app.on("window-all-closed", () => {
	stopAudioProcess();
	if (process.platform !== "darwin") app.quit();
});
