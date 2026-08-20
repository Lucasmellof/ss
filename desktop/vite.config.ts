import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import { defineConfig } from "vite";

export default defineConfig({
	plugins: [tanstackStart({ spa: { enabled: true } }), react(), tailwindcss()],
	resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
	base: "./",
	build: {
		outDir: "dist",
		minify: false,
		cssMinify: false,
		sourcemap: true,
	},
});
