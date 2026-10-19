import { spawnSync } from "node:child_process";

const commands = {
	win32: ["powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "scripts/build-audio-loopback.ps1"]],
	linux: ["bash", ["scripts/build-audio-loopback.sh"]],
};

const command = commands[process.platform];
if (!command) {
	console.log(`Skipping the native audio helper: no build is configured for ${process.platform}.`);
	process.exit(0);
}

const [executable, args] = command;
const result = spawnSync(executable, args, { stdio: "inherit" });

if (result.error) {
	console.error(`Could not start ${executable}: ${result.error.message}`);
	process.exit(1);
}

process.exit(result.status ?? 1);
