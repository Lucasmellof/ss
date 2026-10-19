import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import { defineConfig, type Plugin } from "vite";

const webTarget = process.env.BUILD_TARGET === "web";
const webOutDir = path.resolve(__dirname, "../web/dist");

const keepWebDist = (): Plugin => ({
	name: "keep-web-dist",
	apply: "build",
	closeBundle() {
		mkdirSync(webOutDir, { recursive: true });
		writeFileSync(path.join(webOutDir, ".gitkeep"), "");
	},
});

export default defineConfig({
	plugins: [tanstackStart({ spa: { enabled: true } }), react(), tailwindcss(), ...(webTarget ? [keepWebDist()] : [])],
	resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
	base: webTarget ? "/" : "./",
	build: webTarget
		? { outDir: "dist-web", minify: true, cssMinify: true, sourcemap: false }
		: {
				outDir: "dist",
				minify: false,
				cssMinify: false,
				sourcemap: true,
			},
	environments: webTarget ? { client: { build: { outDir: webOutDir, emptyOutDir: true } } } : undefined,
});
