import { app, BrowserWindow, ipcMain, net, shell } from "electron";
import electronUpdater from "electron-updater";
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const { autoUpdater } = electronUpdater;
const REPO_API = "https://api.github.com/repos/Lucasmellof/ss";
const RELEASES_API = `${REPO_API}/releases/latest`;
const CHANGELOG_SIZE = 6;
const ALLOWED_DOWNLOAD_HOSTS = ["github.com", "githubusercontent.com"];

type GithubAsset = { name: string; size: number; browser_download_url: string };
type GithubRelease = {
	tag_name: string;
	name?: string;
	body?: string;
	html_url: string;
	assets: GithubAsset[];
	published_at?: string;
	draft?: boolean;
	prerelease?: boolean;
};
type GithubCompare = { commits: { commit: { message: string } }[] };

export type UpdateInfo = {
	currentVersion: string;
	version: string;
	notes: string;
	releaseURL: string;
	assetName: string;
	assetSize: number;
	/** true: o app baixa e instala sozinho e reinicia; false: o arquivo é baixado para a pasta Downloads. */
	autoInstall: boolean;
};

export type UpdateCheckResult =
	| { status: "up-to-date"; currentVersion: string }
	| { status: "available"; info: UpdateInfo }
	| { status: "error"; message: string };

export type ChangelogEntry = {
	version: string;
	tag: string;
	previousTag?: string;
	publishedAt: string;
	url: string;
	notes: string;
	status: "new" | "current" | "old";
};

let pendingAsset: { info: UpdateInfo; url: string } | undefined;
let downloading = false;
let progressWindow: BrowserWindow | null = null;

// O instalador NSIS se atualiza sozinho; o portátil e o Linux seguem o fluxo de baixar o arquivo.
const canSelfUpdate = () => process.platform === "win32" && app.isPackaged && !process.env.PORTABLE_EXECUTABLE_FILE;
let autoUpdaterReady = false;
let pendingAuto = false;

function setupAutoUpdater() {
	if (autoUpdaterReady) return;
	autoUpdaterReady = true;
	autoUpdater.autoDownload = false;
	autoUpdater.autoInstallOnAppQuit = false;
	autoUpdater.on("download-progress", (progress) => {
		if (progressWindow && !progressWindow.isDestroyed()) {
			progressWindow.webContents.send("update:progress", { received: progress.transferred, total: progress.total });
		}
	});
}

async function checkWithAutoUpdater(): Promise<UpdateCheckResult> {
	setupAutoUpdater();
	const currentVersion = app.getVersion();
	const result = await autoUpdater.checkForUpdates();
	if (!result?.isUpdateAvailable) return { status: "up-to-date", currentVersion };
	const { updateInfo } = result;
	const file = updateInfo.files[0];
	pendingAuto = true;
	pendingAsset = undefined;
	return {
		status: "available",
		info: {
			currentVersion,
			version: updateInfo.version,
			notes: typeof updateInfo.releaseNotes === "string" ? updateInfo.releaseNotes : "",
			releaseURL: `https://github.com/Lucasmellof/ss/releases/tag/v${updateInfo.version}`,
			assetName: path.basename(file?.url ?? updateInfo.path),
			assetSize: file?.size ?? 0,
			autoInstall: true,
		},
	};
}

function parseVersion(value: string) {
	return value
		.trim()
		.replace(/^v/i, "")
		.split("-")[0]
		.split(".")
		.map((part) => Number.parseInt(part, 10) || 0);
}

function isNewer(candidate: string, current: string) {
	const a = parseVersion(candidate);
	const b = parseVersion(current);
	for (let i = 0; i < Math.max(a.length, b.length); i++) {
		const diff = (a[i] ?? 0) - (b[i] ?? 0);
		if (diff !== 0) return diff > 0;
	}
	return false;
}

function pickAsset(assets: GithubAsset[]) {
	if (process.platform === "win32") {
		const portable = assets.find((asset) => /portable\.exe$/i.test(asset.name));
		const installer = assets.find((asset) => /setup.*\.exe$/i.test(asset.name));
		// Quem usa a versão instalada recebe o instalador; o portátil recebe o portátil.
		const installed = app.isPackaged && !process.env.PORTABLE_EXECUTABLE_FILE;
		return (installed ? (installer ?? portable) : (portable ?? installer)) ?? assets.find((asset) => /\.exe$/i.test(asset.name));
	}
	if (process.platform === "linux") {
		const appImage = assets.find((asset) => /\.AppImage$/i.test(asset.name));
		const deb = assets.find((asset) => /\.deb$/i.test(asset.name));
		return process.env.APPIMAGE ? (appImage ?? deb) : (deb ?? appImage);
	}
	if (process.platform === "darwin") {
		return assets.find((asset) => /\.dmg$/i.test(asset.name));
	}
	return undefined;
}

function isAllowedDownload(rawURL: string) {
	try {
		const url = new URL(rawURL);
		return url.protocol === "https:" && ALLOWED_DOWNLOAD_HOSTS.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`));
	} catch {
		return false;
	}
}

async function checkViaGithub(): Promise<UpdateCheckResult> {
	const currentVersion = app.getVersion();
	const response = await githubFetch(RELEASES_API);
	if (response.status === 404) return { status: "up-to-date", currentVersion };
	if (!response.ok) throw new Error(`GitHub respondeu ${response.status}`);
	const release = (await response.json()) as GithubRelease;

	if (!isNewer(release.tag_name, currentVersion)) return { status: "up-to-date", currentVersion };
	const asset = pickAsset(release.assets ?? []);
	if (!asset || !isAllowedDownload(asset.browser_download_url)) return { status: "up-to-date", currentVersion };

	const info: UpdateInfo = {
		currentVersion,
		version: release.tag_name.replace(/^v/i, ""),
		notes: release.body ?? "",
		releaseURL: release.html_url,
		assetName: path.basename(asset.name),
		assetSize: asset.size,
		autoInstall: false,
	};
	pendingAuto = false;
	pendingAsset = { info, url: asset.browser_download_url };
	return { status: "available", info };
}

function githubFetch(url: string) {
	return net.fetch(url, { headers: { Accept: "application/vnd.github+json", "User-Agent": "screen-share-updater" } });
}

// As notas geradas pelo GitHub só trazem o link "Full Changelog"; o resto do texto é o que vale mostrar.
function releaseNotes(body: string) {
	return body
		.split(/\r?\n/)
		.filter((line) => !/^\*\*Full Changelog\*\*/i.test(line.trim()))
		.join("\n")
		.trim();
}

async function fetchChangelog(): Promise<ChangelogEntry[]> {
	const currentVersion = app.getVersion();
	const response = await githubFetch(`${REPO_API}/releases?per_page=${CHANGELOG_SIZE + 1}`);
	if (!response.ok) throw new Error(`GitHub respondeu ${response.status}`);
	const releases = ((await response.json()) as GithubRelease[]).filter((release) => !release.draft && !release.prerelease);
	return releases.slice(0, CHANGELOG_SIZE).map((release, index) => {
		const version = release.tag_name.replace(/^v/i, "");
		return {
			version,
			tag: release.tag_name,
			previousTag: releases[index + 1]?.tag_name,
			publishedAt: release.published_at ?? "",
			url: release.html_url,
			notes: releaseNotes(release.body ?? ""),
			status: isNewer(version, currentVersion) ? "new" : isNewer(currentVersion, version) ? "old" : "current",
		};
	});
}

const TAG_PATTERN = /^v?\d+\.\d+\.\d+[\w.-]*$/;
const changesCache = new Map<string, string[]>();

// Lista os commits entre duas versões, sem os commits de release.
async function fetchChanges(tag: string, previousTag: string): Promise<string[]> {
	if (!TAG_PATTERN.test(tag) || !TAG_PATTERN.test(previousTag)) throw new Error("Versão inválida");
	const key = `${previousTag}...${tag}`;
	const cached = changesCache.get(key);
	if (cached) return cached;
	const response = await githubFetch(`${REPO_API}/compare/${key}`);
	if (!response.ok) throw new Error(`GitHub respondeu ${response.status}`);
	const { commits } = (await response.json()) as GithubCompare;
	const changes = commits
		.map((item) => item.commit.message.split("\n")[0].trim())
		.filter((subject) => subject && !/^chore: release\b/i.test(subject))
		.reverse();
	changesCache.set(key, changes);
	return changes;
}

async function checkForUpdate(): Promise<UpdateCheckResult> {
	if (canSelfUpdate()) {
		try {
			return await checkWithAutoUpdater();
		} catch (error) {
			// Releases antigas não têm latest.yml; nesse caso cai para o download manual.
			console.error("[Updater] Auto-update indisponível, usando download manual:", error);
		}
	}
	return checkViaGithub();
}

async function installAutomatically(window: BrowserWindow | null) {
	if (downloading) throw new Error("O download já está em andamento");
	downloading = true;
	progressWindow = window;
	try {
		await autoUpdater.downloadUpdate();
	} finally {
		downloading = false;
	}
	// Instala em modo silencioso e reabre o aplicativo já atualizado.
	autoUpdater.quitAndInstall(true, true);
}

async function downloadAndQuit(window: BrowserWindow | null) {
	if (pendingAuto) {
		await installAutomatically(window);
		return "";
	}
	if (!pendingAsset) throw new Error("Nenhuma atualização disponível");
	if (downloading) throw new Error("O download já está em andamento");
	downloading = true;
	const { info, url } = pendingAsset;
	const target = path.join(app.getPath("downloads"), info.assetName);
	const partial = `${target}.part`;
	try {
		const response = await net.fetch(url, { headers: { "User-Agent": "screen-share-updater" } });
		if (!response.ok || !response.body) throw new Error(`Falha no download (${response.status})`);
		const total = Number(response.headers.get("content-length")) || info.assetSize;
		let received = 0;
		let lastSent = 0;
		const source = Readable.fromWeb(response.body as import("node:stream/web").ReadableStream<Uint8Array>);
		source.on("data", (chunk: Buffer) => {
			received += chunk.length;
			const now = Date.now();
			if (now - lastSent < 150 && received < total) return;
			lastSent = now;
			if (window && !window.isDestroyed()) window.webContents.send("update:progress", { received, total });
		});
		await pipeline(source, fs.createWriteStream(partial));
		fs.renameSync(partial, target);
		if (process.platform === "linux" && /\.AppImage$/i.test(target)) fs.chmodSync(target, 0o755);
	} catch (error) {
		fs.rmSync(partial, { force: true });
		throw error;
	} finally {
		downloading = false;
	}
	shell.showItemInFolder(target);
	app.quit();
	return target;
}

export function registerUpdater() {
	ipcMain.handle("update:check", async () => {
		try {
			return await checkForUpdate();
		} catch (error) {
			console.error("[Updater] Falha ao verificar atualização:", error);
			return { status: "error", message: error instanceof Error ? error.message : "Falha ao verificar atualização" } satisfies UpdateCheckResult;
		}
	});
	ipcMain.handle("update:changelog", async () => {
		try {
			return await fetchChangelog();
		} catch (error) {
			console.error("[Updater] Falha ao carregar o changelog:", error);
			return [];
		}
	});
	ipcMain.handle("update:changes", (_event, tag: string, previousTag: string) => fetchChanges(tag, previousTag));
	ipcMain.handle("update:download", (event) => downloadAndQuit(BrowserWindow.fromWebContents(event.sender)));
}
