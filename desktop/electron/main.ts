import { app, BrowserWindow, desktopCapturer, ipcMain, Menu, net, protocol, session, shell, systemPreferences } from "electron";
import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { registerUpdater } from "./updater.js";

const root = path.dirname(fileURLToPath(import.meta.url));
const clientRoot = path.resolve(root, "../dist/client");

protocol.registerSchemesAsPrivileged([{ scheme: "screen-share", privileges: { standard: true, secure: true, supportFetchAPI: true } }]);

const ROOM_PROTOCOL = "screen-share-room";
const ROOM_PATTERN = /^[a-zA-Z0-9_-]{8,64}$/;

if (!app.isPackaged) app.setPath("userData", path.join(app.getPath("appData"), "screen-share-desktop-dev"));

const isPrimaryInstance = app.requestSingleInstanceLock();
if (!isPrimaryInstance) app.quit();

if (app.isPackaged) {
	const portableExe = process.env.PORTABLE_EXECUTABLE_FILE;
	if (portableExe) app.setAsDefaultProtocolClient(ROOM_PROTOCOL, portableExe, []);
	else app.setAsDefaultProtocolClient(ROOM_PROTOCOL);
}

let mainWindow: BrowserWindow | null = null;
let pendingRoom = roomFromArgs(process.argv);

function roomFromLink(link: string): string | undefined {
	try {
		const url = new URL(link);
		if (url.protocol !== `${ROOM_PROTOCOL}:`) return undefined;
		const room = url.searchParams.get("room")?.trim() ?? "";
		return ROOM_PATTERN.test(room) ? room : undefined;
	} catch {
		return undefined;
	}
}

function roomFromArgs(args: string[]): string | undefined {
	const link = args.find((arg) => arg.startsWith(`${ROOM_PROTOCOL}:`));
	return link ? roomFromLink(link) : undefined;
}

function openRoom(room: string | undefined) {
	if (!room) return;
	const window = mainWindow;
	if (!window || window.isDestroyed() || window.webContents.isLoading()) {
		pendingRoom = room;
		return;
	}
	if (window.isMinimized()) window.restore();
	window.focus();
	window.webContents.send("room:open", room);
}

app.on("second-instance", (_event, args) => openRoom(roomFromArgs(args)));
app.on("open-url", (event, link) => {
	event.preventDefault();
	openRoom(roomFromLink(link));
});

if (process.platform === "linux") {
	app.commandLine.appendSwitch("enable-features", "WebRTCPipeWireCapturer");
}

if (process.platform === "darwin") {
	app.commandLine.appendSwitch("enable-features", "MacLoopbackAudioForScreenShare,MacSckSystemAudioLoopbackOverride");
}

const SCREEN_PERMISSION_SETTINGS_URL = "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture";

let activeAudioProcess: ChildProcessWithoutNullStreams | null = null;
let captureSources: Electron.DesktopCapturerSource[] = [];
let selectedCaptureSourceID: string | undefined;
let selectedCaptureAudio = false;

function getAudioLoopbackPath(): string | undefined {
	if (process.platform !== "win32") return undefined;

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
		}
		activeAudioProcess = null;
	}
}

async function startAudioLoopback(window: BrowserWindow, sourceId: string): Promise<boolean> {
	stopAudioProcess();
	if (process.platform !== "win32") {
		console.info("[AudioLoopback] helper WASAPI indisponível nesta plataforma; usando a captura do Chromium");
		return false;
	}

	const isWindow = sourceId.startsWith("window:");
	const isScreen = sourceId.startsWith("screen:");
	console.log("[AudioLoopback] startAudioLoopback chamado:", { sourceId, isWindow, isScreen });
	if (!isWindow && !isScreen) return false;

	const helperPath = getAudioLoopbackPath();
	console.log("[AudioLoopback] helperPath:", helperPath, "exists:", helperPath ? fs.existsSync(helperPath) : false);
	if (!helperPath || !fs.existsSync(helperPath)) {
		console.error("AudioLoopback.exe não encontrado em:", helperPath ?? "caminho não configurado");
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
		const proc = spawn(helperPath, args);
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

async function getDesktopCapturerSources() {
	const items = await desktopCapturer.getSources({
		types: ["screen", "window"],
		thumbnailSize: { width: 480, height: 270 },
		fetchWindowIcons: true,
	});
	captureSources = items;
	return items;
}

async function sources() {
	try {
		const items = await getDesktopCapturerSources();
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
	const window = (mainWindow = new BrowserWindow({
		width: 1240,
		height: 840,
		minWidth: 900,
		minHeight: 650,
		title: "Screen Share",
		backgroundColor: "#09090b",
		icon: path.resolve(root, "../resources/icon.png"),
		webPreferences: {
			preload: path.join(root, "preload.cjs"),
			contextIsolation: true,
			nodeIntegration: false,
			sandbox: false,
			backgroundThrottling: false,
		},
	}));
	window.webContents.setWindowOpenHandler(({ url }) => {
		if (url.startsWith("https://")) void shell.openExternal(url);
		return { action: "deny" };
	});
	const devURL = process.env.VITE_DEV_SERVER_URL;
	if (devURL) void window.loadURL(devURL);
	else void window.loadURL("screen-share://app/");
}

app.whenReady().then(() => {
	if (!isPrimaryInstance) return undefined;
	protocol.handle("screen-share", (request) => {
		const requestedPath = decodeURIComponent(new URL(request.url).pathname);
		const assetPath = requestedPath === "/" ? "/_shell.html" : requestedPath;
		const filePath = path.resolve(clientRoot, `.${assetPath}`);
		if (filePath !== clientRoot && !filePath.startsWith(`${clientRoot}${path.sep}`)) {
			return new Response("Not found", { status: 404 });
		}
		return net.fetch(pathToFileURL(filePath).toString());
	});


	const signalingOrigin = "https://ss.carmellium.com";
	session.defaultSession.webRequest.onBeforeSendHeaders({ urls: [`wss://ss.carmellium.com/*`, `ws://ss.carmellium.com/*`] }, (details, callback) => {
		callback({ requestHeaders: { ...details.requestHeaders, Origin: signalingOrigin } });
	});

	if (process.platform === "linux" || process.platform === "darwin") {
		session.defaultSession.setDisplayMediaRequestHandler(async (request, callback) => {
			const withAudio = process.platform === "darwin" && selectedCaptureAudio && request.audioRequested;
			const streams = (video: Electron.DesktopCapturerSource): Electron.Streams =>
				withAudio ? { video, audio: "loopback" } : { video };
			const selected = captureSources.find((source) => source.id === selectedCaptureSourceID);
			const source = selected ?? captureSources[0];
			if (source) {
				callback(streams(source));
				return;
			}

			try {
				const items = await getDesktopCapturerSources();
				const fallback = items.find((item) => item.id === selectedCaptureSourceID) ?? items[0];
				callback(fallback ? streams(fallback) : {});
			} catch (error) {
				console.error("Não foi possível autorizar a captura PipeWire:", error);
				callback({});
			}
		});
	}

	ipcMain.handle("capture:sources", sources);
	ipcMain.handle("capture:set-source", (_event, sourceId: string, audio?: boolean) => {
		selectedCaptureSourceID = sourceId;
		selectedCaptureAudio = audio === true;
		return true;
	});
	ipcMain.handle("capture:permission", () =>
		process.platform === "darwin" ? systemPreferences.getMediaAccessStatus("screen") : "granted",
	);
	ipcMain.handle("capture:open-permission-settings", async () => {
		if (process.platform !== "darwin") return false;
		await shell.openExternal(SCREEN_PERMISSION_SETTINGS_URL);
		return true;
	});
	registerUpdater();
	ipcMain.handle("system:hostname", () => os.hostname());
	ipcMain.handle("room:take-pending", () => {
		const room = pendingRoom;
		pendingRoom = undefined;
		return room ?? null;
	});
	ipcMain.handle("capture:start-audio-loopback", (_event, sourceId: string) => {
		const win = BrowserWindow.fromWebContents(_event.sender);
		if (!win) return false;
		return startAudioLoopback(win, sourceId);
	});
	ipcMain.handle("capture:stop-audio-loopback", () => {
		stopAudioProcess();
		return true;
	});

	if (process.platform === "darwin") {
		Menu.setApplicationMenu(
			Menu.buildFromTemplate([{ role: "appMenu" }, { role: "editMenu" }, { role: "viewMenu" }, { role: "windowMenu" }]),
		);
	}

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
