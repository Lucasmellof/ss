import { useEffect, useState } from "react";
import { XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { desktop } from "@/lib/platform";
import { ChangelogDialog, formatReleaseDate } from "./ChangelogDialog";

type Progress = { received: number; total: number };
type CheckState = { status: "checking" } | UpdateCheckResult;

const AUTO_HIDE_MS = 8_000;
const STATUS_LABEL: Record<ChangelogEntry["status"], string> = { new: "nova", current: "atual", old: "" };

export function UpdateBanner() {
	const [check, setCheck] = useState<CheckState>({ status: "checking" });
	const [hidden, setHidden] = useState(false);
	const [progress, setProgress] = useState<Progress | undefined>();
	const [downloading, setDownloading] = useState(false);
	const [error, setError] = useState("");
	const [changelog, setChangelog] = useState<ChangelogEntry[]>([]);
	const [selected, setSelected] = useState<ChangelogEntry | undefined>();
	// Depois que o usuário interage com o aviso, ele não some sozinho.
	const [pinned, setPinned] = useState(false);

	useEffect(() => {
		const api = desktop;
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
				if (active)
					setCheck({ status: "error", message: cause instanceof Error ? cause.message : "Falha ao verificar atualização" });
			})
			.then(() => api.changelog())
			.then((entries) => {
				if (active) setChangelog(entries);
			})
			.catch(() => undefined);
		const unsubscribe = api.onUpdateProgress(setProgress);
		return () => {
			active = false;
			unsubscribe();
		};
	}, []);

	useEffect(() => {
		if (pinned || (check.status !== "up-to-date" && check.status !== "error")) return;
		const timer = window.setTimeout(() => setHidden(true), AUTO_HIDE_MS);
		return () => window.clearTimeout(timer);
	}, [check.status, pinned]);

	if (hidden) return null;

	const install = async () => {
		setError("");
		setDownloading(true);
		try {
			if (!desktop) throw new Error("Atualização disponível apenas no app desktop");
			await desktop.downloadUpdate();
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

	const closeButton = (
		<button
			type="button"
			className="absolute top-3 right-3 rounded-sm text-app-muted hover:text-app-text"
			aria-label="Fechar"
			onClick={() => setHidden(true)}
		>
			<XIcon className="size-4" />
		</button>
	);

	const changelogList =
		changelog.length > 0 ? (
			<div className="mt-3 border-t border-app-line pt-3">
				<p className="text-xs font-medium text-app-muted">Novidades</p>
				<ul className="mt-1.5 space-y-0.5">
					{changelog.map((entry) => (
						<li key={entry.tag}>
							<button
								type="button"
								className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1 text-left text-sm hover:bg-app-panel"
								onClick={() => {
									setPinned(true);
									setSelected(entry);
								}}
							>
								<span>v{entry.version}</span>
								<span className="flex items-center gap-2 text-xs text-app-muted">
									{STATUS_LABEL[entry.status] ? (
										<span className="text-app-accent">{STATUS_LABEL[entry.status]}</span>
									) : null}
									{formatReleaseDate(entry.publishedAt)}
								</span>
							</button>
						</li>
					))}
				</ul>
			</div>
		) : null;

	const dialog = <ChangelogDialog entry={selected} onClose={() => setSelected(undefined)} />;

	if (check.status === "up-to-date" || check.status === "error") {
		return (
			<div className={box} role="status" onPointerEnter={() => setPinned(true)}>
				{closeButton}
				{check.status === "up-to-date" ? (
					<>
						<p className="pr-6 text-sm font-medium">Você está na versão mais recente</p>
						<p className="mt-1 text-xs text-app-muted">Versão {check.currentVersion}.</p>
					</>
				) : (
					<>
						<p className="pr-6 text-sm font-medium">Não foi possível verificar atualizações</p>
						<p className="mt-1 text-xs text-app-muted">{check.message}</p>
					</>
				)}
				{changelogList}
				{dialog}
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
					{percent === undefined ? "Baixando..." : `Baixando... ${percent}%`}{" "}
					{update.autoInstall ? "O aplicativo será reiniciado ao terminar." : "O aplicativo será fechado ao terminar."}
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
			{changelogList}
			{dialog}
		</div>
	);
}
