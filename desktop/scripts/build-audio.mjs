import { spawnSync } from "node:child_process";

if (process.platform !== "win32") {
	console.log("Helper WASAPI ignorado: o cliente Linux usa a captura de áudio do Chromium/PipeWire.");
	process.exit(0);
}

const result = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "scripts/build-audio-loopback.ps1"], {
	stdio: "inherit",
});

if (result.error) {
	console.error(`Não foi possível iniciar o PowerShell: ${result.error.message}`);
	process.exit(1);
}

process.exit(result.status ?? 1);
