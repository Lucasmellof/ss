import { spawnSync } from "node:child_process";

const targets = { win32: "dist:win", linux: "dist:linux", darwin: "dist:mac" };
const target = targets[process.platform];

if (!target) {
	console.error(`Distribuição não configurada para a plataforma ${process.platform}.`);
	process.exit(1);
}

const result = spawnSync(process.platform === "win32" ? "bun.exe" : "bun", ["run", target], {
	stdio: "inherit",
	shell: process.platform === "win32",
});

if (result.error) {
	console.error(`Não foi possível iniciar o Bun: ${result.error.message}`);
	process.exit(1);
}

process.exit(result.status ?? 1);
