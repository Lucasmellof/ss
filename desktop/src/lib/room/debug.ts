const enabled = import.meta.env.DEV;

export function roomDebug(message: string, details?: unknown) {
	if (!enabled) return;
	if (details === undefined) {
		console.info(`[room] ${message}`);
		return;
	}
	console.info(`[room] ${message}`, details);
}

export function roomDebugError(message: string, details?: unknown) {
	if (!enabled) return;
	console.warn(`[room] ${message}`, details);
}
