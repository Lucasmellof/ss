import { app, BrowserWindow, ipcMain, net, shell } from "electron";
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const RELEASES_API = "https://api.github.com/repos/Lucasmellof/ss/releases/latest";
const ALLOWED_DOWNLOAD_HOSTS = ["github.com", "githubusercontent.com"];

type GithubAsset = { name: string; size: number; browser_download_url: string };
type GithubRelease = { tag_name: string; name?: string; body?: string; html_url: string; assets: GithubAsset[] };

export type UpdateInfo = {
	currentVersion: string;
	version: string;
	notes: string;
	releaseURL: string;
	assetName: string;
	assetSize: number;
};

export type UpdateCheckResult =
	| { status: "up-to-date"; currentVersion: string }
	| { status: "available"; info: UpdateInfo }
	| { status: "error"; message: string };

let pendingAsset: { info: UpdateInfo; url: string } | undefined;
let downloading = false;

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
		return assets.find((asset) => /portable\.exe$/i.test(asset.name)) ?? assets.find((asset) => /\.exe$/i.test(asset.name));
	}
	if (process.platform === "linux") {
		const appImage = assets.find((asset) => /\.AppImage$/i.test(asset.name));
		const deb = assets.find((asset) => /\.deb$/i.test(asset.name));
		return process.env.APPIMAGE ? (appImage ?? deb) : (deb ?? appImage);
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

async function checkForUpdate(): Promise<UpdateCheckResult> {
	const currentVersion = app.getVersion();
	const response = await net.fetch(RELEASES_API, { headers: { Accept: "application/vnd.github+json", "User-Agent": "screen-share-updater" } });
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
	};
	pendingAsset = { info, url: asset.browser_download_url };
	return { status: "available", info };
}

async function downloadAndQuit(window: BrowserWindow | null) {
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
	ipcMain.handle("update:download", (event) => downloadAndQuit(BrowserWindow.fromWebContents(event.sender)));
}
