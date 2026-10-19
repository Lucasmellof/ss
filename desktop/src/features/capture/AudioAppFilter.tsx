import { Plus, RefreshCw, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { type AudioFilter, type AudioFilterMode, audioFilterModes, normalizeAppName } from "./types";

type AudioAppFilterProps = {
	value: AudioFilter;
	onChange: (value: AudioFilter) => void;
};

const appKey = (app: AudioApp) => normalizeAppName(app.exe || app.name);

export function AudioAppFilter({ value, onChange }: AudioAppFilterProps) {
	const [apps, setApps] = useState<AudioApp[]>([]);
	const [loading, setLoading] = useState(true);
	const [draft, setDraft] = useState("");
	const requestRef = useRef(0);

	const loadApps = useCallback(async () => {
		const requestID = ++requestRef.current;
		let next: AudioApp[] = [];
		try {
			next = (await window.screenShare?.audioApps?.()) ?? [];
		} catch {
			next = [];
		}
		if (requestRef.current !== requestID) return;
		setApps(next);
		setLoading(false);
	}, []);

	useEffect(() => {
		void loadApps();
		return () => {
			requestRef.current += 1;
		};
	}, [loadApps]);

	const selected = new Set(value.apps);
	const setMode = (mode: AudioFilterMode) => onChange({ ...value, mode });
	const addApp = (name: string) => {
		const key = normalizeAppName(name);
		if (!key || selected.has(key)) return;
		onChange({ ...value, apps: [...value.apps, key] });
	};
	const removeApp = (key: string) => onChange({ ...value, apps: value.apps.filter((app) => app !== key) });
	const toggleApp = (app: AudioApp) => {
		const key = appKey(app);
		if (selected.has(key)) removeApp(key);
		else addApp(key);
	};

	return (
		<div className="mt-3 grid gap-3 rounded-[10px] border border-app-line bg-[#0c1014] p-3">
			<div className="flex flex-wrap items-center justify-between gap-2">
				<span className="text-xs font-bold text-app-muted">Apps no áudio</span>
				<Select value={value.mode} onValueChange={(mode) => setMode(mode as AudioFilterMode)}>
					<SelectTrigger
						size="sm"
						className="min-w-[210px] border-app-line bg-[#0d1014] text-xs font-bold text-app-text"
						aria-label="Filtro de apps"
					>
						<SelectValue />
					</SelectTrigger>
					<SelectContent position="popper" className="border-app-line bg-[#11151a] text-app-text">
						{Object.entries(audioFilterModes).map(([mode, label]) => (
							<SelectItem className="text-xs focus:bg-app-accent/12 focus:text-app-text" value={mode} key={mode}>
								{label}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</div>

			{value.mode !== "all" && (
				<>
					<p className="text-[11px] leading-5 text-app-muted">
						{value.mode === "include"
							? "Só o áudio dos apps selecionados será transmitido."
							: "O áudio dos apps selecionados não será transmitido."}{" "}
						O som deste app nunca é transmitido.
					</p>

					<div className="flex min-h-[24px] flex-wrap gap-1.5">
						{value.apps.length === 0 ? (
							<span className="text-[11px] text-[#697681]">Nenhum app selecionado.</span>
						) : (
							value.apps.map((app) => (
								<Badge
									variant="outline"
									className="gap-1 border-app-accent/30 bg-app-accent/8 py-0.5 pr-1 text-[11px] text-app-accent"
									key={app}
								>
									{app}
									<button
										className="grid size-4 place-items-center rounded-full hover:bg-app-accent/20"
										type="button"
										onClick={() => removeApp(app)}
										aria-label={`Remover ${app}`}
									>
										<X className="size-3" />
									</button>
								</Badge>
							))
						)}
					</div>

					<div className="grid gap-1.5">
						<div className="flex items-center justify-between gap-2 text-[11px] text-app-muted">
							<span>{loading ? "Buscando apps com áudio..." : "Apps com áudio agora"}</span>
							<Button
								className="h-6 px-2 text-[11px] font-extrabold text-app-accent hover:bg-app-accent/12 hover:text-[#b0efd5]"
								size="xs"
								variant="ghost"
								type="button"
								onClick={() => {
									setLoading(true);
									void loadApps();
								}}
								disabled={loading}
							>
								<RefreshCw className={cn("size-3", loading && "animate-spin")} /> Atualizar
							</Button>
						</div>
						<div className="grid max-h-[140px] gap-1 overflow-auto">
							{!loading && apps.length === 0 && (
								<span className="py-1 text-[11px] text-[#697681]">Nenhum app tocando áudio agora.</span>
							)}
							{apps.map((app) => (
								<label
									className="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-xs text-app-text hover:bg-app-panel-raised"
									key={`${app.pid}-${app.exe}`}
								>
									<input
										className="size-4 accent-app-accent"
										type="checkbox"
										checked={selected.has(appKey(app))}
										onChange={() => toggleApp(app)}
									/>
									<span className="truncate font-bold">{app.name}</span>
									<span className="truncate text-[10px] text-[#697681]">{app.exe}</span>
								</label>
							))}
						</div>
					</div>

					<form
						className="flex gap-2"
						onSubmit={(event) => {
							event.preventDefault();
							addApp(draft);
							setDraft("");
						}}
					>
						<input
							className="min-w-0 flex-1 rounded-[9px] border border-app-line bg-[#0d1014] px-3 py-2 text-xs text-app-text outline-none placeholder:text-[#606c78] focus:border-app-accent-strong"
							value={draft}
							onChange={(event) => setDraft(event.target.value)}
							placeholder="Nome do app (ex.: discord, spotify.exe)"
							aria-label="Nome do app"
						/>
						<Button
							className="h-auto bg-app-panel-raised px-3 text-xs font-extrabold text-app-text hover:bg-app-line"
							size="sm"
							variant="secondary"
							type="submit"
							disabled={!normalizeAppName(draft)}
						>
							<Plus className="size-3.5" /> Adicionar
						</Button>
					</form>
				</>
			)}
		</div>
	);
}
