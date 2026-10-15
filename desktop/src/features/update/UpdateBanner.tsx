import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

type Progress = { received: number; total: number };

export function UpdateBanner() {
	const [update, setUpdate] = useState<UpdateInfo | null>(null);
	const [dismissed, setDismissed] = useState(false);
	const [progress, setProgress] = useState<Progress | undefined>();
	const [downloading, setDownloading] = useState(false);
	const [error, setError] = useState("");

	useEffect(() => {
		const api = window.screenShare;
		if (!api?.checkForUpdate) return;
		let active = true;
		void api
			.checkForUpdate()
			.then((info) => {
				if (active) setUpdate(info);
			})
			.catch(() => undefined);
		const unsubscribe = api.onUpdateProgress(setProgress);
		return () => {
			active = false;
			unsubscribe();
		};
	}, []);

	if (!update || dismissed) return null;

	const install = async () => {
		setError("");
		setDownloading(true);
		try {
			await window.screenShare.downloadUpdate();
		} catch (cause) {
			setDownloading(false);
			setProgress(undefined);
			setError(cause instanceof Error ? cause.message : "Não foi possível baixar a atualização");
		}
	};

	const percent = progress && progress.total > 0 ? Math.min(100, Math.round((progress.received / progress.total) * 100)) : undefined;

	return (
		<div className="fixed right-4 bottom-4 z-50 w-80 rounded-lg border border-app-line bg-app-panel-raised p-4 shadow-lg" role="status">
			<p className="text-sm font-medium">Nova versão disponível: {update.version}</p>
			<p className="mt-1 text-xs text-app-muted">Você está na versão {update.currentVersion}.</p>
			{downloading ? (
				<p className="mt-3 text-xs text-app-muted">
					{percent === undefined ? "Baixando..." : `Baixando... ${percent}%`} O aplicativo será fechado ao terminar.
				</p>
			) : (
				<div className="mt-3 flex gap-2">
					<Button size="sm" onClick={() => void install()}>
						Atualizar agora
					</Button>
					<Button size="sm" variant="ghost" onClick={() => setDismissed(true)}>
						Depois
					</Button>
				</div>
			)}
			{error ? <p className="mt-2 text-xs text-app-danger">{error}</p> : null}
		</div>
	);
}
