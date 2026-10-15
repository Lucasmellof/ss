import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

type Progress = { received: number; total: number };
type CheckState = { status: "checking" } | UpdateCheckResult;

const AUTO_HIDE_MS = 5_000;

export function UpdateBanner() {
	const [check, setCheck] = useState<CheckState>({ status: "checking" });
	const [hidden, setHidden] = useState(false);
	const [progress, setProgress] = useState<Progress | undefined>();
	const [downloading, setDownloading] = useState(false);
	const [error, setError] = useState("");

	useEffect(() => {
		const api = window.screenShare;
		if (!api?.checkForUpdate) {
			setHidden(true);
			return;
		}
		let active = true;
		void api
			.checkForUpdate()
			.then((result) => {
				if (active) setCheck(result);
			})
			.catch((cause: unknown) => {
				if (active) setCheck({ status: "error", message: cause instanceof Error ? cause.message : "Falha ao verificar atualização" });
			});
		const unsubscribe = api.onUpdateProgress(setProgress);
		return () => {
			active = false;
			unsubscribe();
		};
	}, []);

	useEffect(() => {
		if (check.status !== "up-to-date" && check.status !== "error") return;
		const timer = window.setTimeout(() => setHidden(true), AUTO_HIDE_MS);
		return () => window.clearTimeout(timer);
	}, [check.status]);

	if (hidden) return null;

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
	const box = "fixed right-4 bottom-4 z-50 w-80 rounded-lg border border-app-line bg-app-panel-raised p-4 shadow-lg";

	if (check.status === "checking") {
		return (
			<div className={box} role="status">
				<p className="text-sm text-app-muted">Verificando atualização...</p>
			</div>
		);
	}

	if (check.status === "up-to-date") {
		return (
			<div className={box} role="status">
				<p className="text-sm font-medium">Você está na versão mais recente</p>
				<p className="mt-1 text-xs text-app-muted">Versão {check.currentVersion}.</p>
			</div>
		);
	}

	if (check.status === "error") {
		return (
			<div className={box} role="status">
				<p className="text-sm font-medium">Não foi possível verificar atualizações</p>
				<p className="mt-1 text-xs text-app-muted">{check.message}</p>
			</div>
		);
	}

	const update = check.info;
	return (
		<div className={box} role="status">
			<p className="text-sm font-medium">Nova versão disponível: {update.version}</p>
			<p className="mt-1 text-xs text-app-muted">Você está na versão {update.currentVersion}.</p>
			{downloading ? (
				<p className="mt-3 text-xs text-app-muted">
					{percent === undefined ? "Baixando..." : `Baixando... ${percent}%`} {update.autoInstall ? "O aplicativo será reiniciado ao terminar." : "O aplicativo será fechado ao terminar."}
				</p>
			) : (
				<div className="mt-3 flex gap-2">
					<Button size="sm" onClick={() => void install()}>
						Atualizar agora
					</Button>
					<Button size="sm" variant="ghost" onClick={() => setHidden(true)}>
						Depois
					</Button>
				</div>
			)}
			{error ? <p className="mt-2 text-xs text-app-danger">{error}</p> : null}
		</div>
	);
}
