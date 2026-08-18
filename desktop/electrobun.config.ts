import type { ElectrobunConfig } from "electrobun";

export default {
	app: {
		name: "Screen Share",
		identifier: "com.lucasmellof.screen-share",
		version: "0.1.0",
	},
	runtime: {
		exitOnLastWindowClosed: true,
	},
	build: {
		bun: {
			entrypoint: "src/bun/index.ts",
		},
		views: {
			mainview: {
				entrypoint: "src/mainview/index.ts",
			},
		},
		copy: {
			"src/mainview/index.html": "views/mainview/index.html",
			"src/mainview/index.css": "views/mainview/index.css",
		},
		win: {
			bundleCEF: true,
			defaultRenderer: "cef",
		},
	},
} satisfies ElectrobunConfig;
