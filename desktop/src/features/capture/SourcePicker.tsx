import { AppWindow, Check, MonitorUp, RefreshCw, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { resolutions, type SourcePickerProps } from "./types";

const fieldClass =
	"w-full rounded-[9px] border border-app-line bg-[#0d1014] px-[13px] py-3 text-app-text outline-none transition focus:border-app-accent-strong focus:ring-[3px] focus:ring-app-accent-strong/15 placeholder:text-[#606c78]";
const buttonBase =
	"inline-flex min-h-[39px] items-center justify-center gap-2 rounded-[9px] border border-transparent px-[13px] text-xs font-extrabold transition duration-150 hover:-translate-y-px disabled:cursor-not-allowed disabled:opacity-55";

export function SourcePicker({
	sources,
	selectedID,
	sourceType,
	frameRate,
	resolution,
	audioMode,
	loading,
	starting,
	onType,
	onSelect,
	onFrameRate,
	onResolution,
	onAudioMode,
	onRefresh,
	onClose,
	onStart,
}: SourcePickerProps) {
	const visibleSources = sources.filter((source) => source.kind === sourceType);
	const screenCount = sources.filter((source) => source.kind === "screen").length;
	const windowCount = sources.filter((source) => source.kind === "window").length;
	return (
		<div
			className="fixed inset-0 z-20 grid place-items-center bg-black/80 p-2.5 sm:p-5"
			role="presentation"
			onMouseDown={(event) => {
				if (event.target === event.currentTarget) onClose();
			}}
		>
			<section
				className="max-h-[calc(100vh-20px)] w-full max-w-[760px] overflow-auto rounded-[15px] border border-app-line bg-[#11151a] p-[17px] shadow-[0_30px_100px_rgba(0,0,0,.55)] sm:max-h-[calc(100vh-40px)] sm:p-[22px]"
				role="dialog"
				aria-modal="true"
				aria-labelledby="source-picker-title"
			>
				<div className="mb-5 flex items-center justify-between gap-[15px]">
					<div>
						<p className="mb-1.5 text-[10px] font-extrabold tracking-[.16em] text-app-accent uppercase">Nova transmissão</p>
						<h2 className="text-[22px] font-semibold tracking-[-.04em]" id="source-picker-title">
							Escolha o que compartilhar
						</h2>
					</div>
					<button
						className="grid size-[30px] shrink-0 place-items-center rounded-lg border border-transparent text-[#dbe2e7] hover:border-app-accent/40 hover:bg-app-accent/12 hover:text-app-accent"
						type="button"
						onClick={onClose}
						aria-label="Fechar"
					>
						<X className="size-3.5" />
					</button>
				</div>

				<div className="mb-2.5 flex items-center justify-between gap-[15px] text-[11px] text-app-muted">
					<span>{loading ? "Buscando telas e janelas..." : `${sources.length} fonte(s) disponível(is)`}</span>
					<button
						className="inline-flex items-center gap-1.5 border-0 bg-transparent text-[11px] font-extrabold text-app-accent hover:text-[#b0efd5] disabled:cursor-not-allowed disabled:opacity-50"
						type="button"
						onClick={onRefresh}
						disabled={loading}
					>
						<RefreshCw className={cn("size-[13px]", loading && "animate-spin")} /> Atualizar
					</button>
				</div>
				<div className="mb-2.5 flex gap-1.5 rounded-[9px] bg-[#0b0e12] p-1" role="tablist" aria-label="Tipo de fonte">
					<button
						className={cn(
							"inline-flex flex-1 items-center justify-center gap-1.5 rounded-[7px] border border-transparent px-2.5 py-2 text-[11px] font-extrabold text-app-muted",
							sourceType === "screen" && "border-app-line bg-app-panel-raised text-app-text",
						)}
						type="button"
						role="tab"
						aria-selected={sourceType === "screen"}
						onClick={() => onType("screen")}
					>
						<MonitorUp className={cn("size-3.5", sourceType === "screen" && "text-app-accent")} /> Telas{" "}
						<span className="text-[10px] text-[#697681]">{screenCount}</span>
					</button>
					<button
						className={cn(
							"inline-flex flex-1 items-center justify-center gap-1.5 rounded-[7px] border border-transparent px-2.5 py-2 text-[11px] font-extrabold text-app-muted",
							sourceType === "window" && "border-app-line bg-app-panel-raised text-app-text",
						)}
						type="button"
						role="tab"
						aria-selected={sourceType === "window"}
						onClick={() => onType("window")}
					>
						<AppWindow className={cn("size-3.5", sourceType === "window" && "text-app-accent")} /> Janelas{" "}
						<span className="text-[10px] text-[#697681]">{windowCount}</span>
					</button>
				</div>
				<div className="grid max-h-[390px] grid-cols-1 gap-2.5 overflow-auto p-0.5 sm:grid-cols-2">
					{loading ? (
						<div className="col-span-full grid min-h-[190px] place-items-center content-center gap-2.5 p-[30px_10px] text-center text-xs text-app-muted">
							<RefreshCw className="size-6 animate-spin text-app-accent" />
							<strong className="text-[13px] text-app-text">Carregando fontes</strong>
							<span className="text-[11px]">Procurando telas e janelas disponíveis.</span>
						</div>
					) : visibleSources.length === 0 ? (
						<div className="col-span-full p-10 text-center text-xs text-app-muted">
							Nenhuma {sourceType === "screen" ? "tela" : "janela"} disponível.
						</div>
					) : (
						visibleSources.map((source) => (
							<button
								className={cn(
									"min-w-0 rounded-[10px] border border-app-line bg-[#0c1014] p-[7px] text-left text-app-text hover:border-app-accent-strong hover:bg-app-accent-strong/8",
									selectedID === source.id && "border-app-accent-strong bg-app-accent-strong/8",
								)}
								type="button"
								key={source.id}
								onClick={() => onSelect(source)}
							>
								<div className="relative grid min-h-[94px] place-items-center overflow-hidden rounded-md bg-[#05070a]">
									{source.thumbnail ? (
										<img className="block aspect-video w-full object-cover" src={source.thumbnail} alt="" />
									) : (
										<MonitorUp className="text-app-muted" />
									)}
									{selectedID === source.id && (
										<span className="absolute top-1.5 right-1.5 grid size-[22px] place-items-center rounded-full bg-app-accent text-[#07150f]">
											<Check className="size-[13px]" />
										</span>
									)}
								</div>
								<span className="mt-2 block overflow-hidden text-xs font-extrabold text-ellipsis whitespace-nowrap">
									{source.name}
								</span>
								<span className="mt-0.5 block overflow-hidden text-[10px] text-app-muted text-ellipsis whitespace-nowrap">
									{source.kind === "screen" ? "Tela" : "Janela"}
								</span>
							</button>
						))
					)}
				</div>

				<div className="mt-5 border-t border-app-line-soft pt-[17px]">
					<div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
						<label className="grid min-w-0 gap-2 text-xs font-bold text-app-muted">
							<span>Taxa de quadros</span>
							<select
								className={cn(fieldClass, "appearance-none")}
								value={frameRate}
								onChange={(event) => onFrameRate(Number(event.target.value) as 30 | 60)}
							>
								<option value={30}>30 FPS · estável</option>
								<option value={60}>60 FPS · suave</option>
							</select>
						</label>
						<label className="grid min-w-0 gap-2 text-xs font-bold text-app-muted">
							<span>Resolução máxima</span>
							<select
								className={cn(fieldClass, "appearance-none")}
								value={resolution}
								onChange={(event) => onResolution(event.target.value as "source" | "720p" | "1080p" | "1440p")}
							>
								{Object.entries(resolutions).map(([value, option]) => (
									<option value={value} key={value}>
										{option.label}
									</option>
								))}
							</select>
						</label>
						<label className="grid min-w-0 gap-2 text-xs font-bold text-app-muted">
							<span>Áudio</span>
							<select
								className={cn(fieldClass, "appearance-none")}
								value={audioMode}
								onChange={(event) => onAudioMode(event.target.value as "none" | "system")}
							>
								<option value="none">Sem áudio</option>
								<option value="system">Áudio do PC</option>
							</select>
						</label>
					</div>
					<div className="mt-[17px] flex justify-end gap-2 max-sm:[&>button]:flex-1">
						<button
							className={cn(buttonBase, "border-app-line text-app-muted hover:bg-app-panel-raised")}
							type="button"
							onClick={onClose}
						>
							Cancelar
						</button>
						<button
							className={cn(buttonBase, "bg-app-accent text-[#07150f] hover:bg-[#b0efd5]")}
							type="button"
							onClick={onStart}
							disabled={!selectedID || loading || starting}
						>
							{starting ? (
								<>
									<RefreshCw className="size-4 animate-spin" /> Iniciando...
								</>
							) : (
								"Compartilhar"
							)}
						</button>
					</div>
				</div>
			</section>
		</div>
	);
}
