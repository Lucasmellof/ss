import { useEffect, useRef } from "react";
import { RefreshCw, Video, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { type CameraPickerProps, type CameraResolution, cameraResolutions } from "./types";

const fieldClass =
	"w-full rounded-[9px] border border-app-line bg-[#0d1014] px-[13px] py-3 text-app-text outline-none transition focus:border-app-accent-strong focus:ring-[3px] focus:ring-app-accent-strong/15 placeholder:text-[#606c78]";
const buttonBase =
	"inline-flex min-h-[39px] items-center justify-center gap-2 rounded-[9px] border border-transparent px-[13px] text-xs font-extrabold transition duration-150 hover:-translate-y-px disabled:cursor-not-allowed disabled:opacity-55";

export function CameraPicker({
	devices,
	deviceID,
	resolution,
	frameRate,
	preview,
	live,
	loading,
	starting,
	error,
	onDevice,
	onResolution,
	onFrameRate,
	onClose,
	onStart,
}: CameraPickerProps) {
	const videoRef = useRef<HTMLVideoElement>(null);

	useEffect(() => {
		const video = videoRef.current;
		if (!video) return;
		video.srcObject = preview;
		if (preview) void video.play().catch(() => undefined);
	}, [preview]);

	return (
		<div
			className="fixed inset-0 z-20 grid place-items-center bg-black/80 p-2.5 sm:p-5"
			role="presentation"
			onMouseDown={(event) => {
				if (event.target === event.currentTarget) onClose();
			}}
		>
			<section
				className="max-h-[calc(100vh-20px)] w-full max-w-[560px] overflow-auto rounded-[15px] border border-app-line bg-[#11151a] p-[17px] shadow-[0_30px_100px_rgba(0,0,0,.55)] sm:max-h-[calc(100vh-40px)] sm:p-[22px]"
				role="dialog"
				aria-modal="true"
				aria-labelledby="camera-picker-title"
			>
				<div className="mb-5 flex items-center justify-between gap-[15px]">
					<div>
						<p className="mb-1.5 text-[10px] font-extrabold tracking-[.16em] text-app-accent uppercase">
							{live ? "Câmera ativa" : "Nova transmissão"}
						</p>
						<h2 className="text-[22px] font-semibold tracking-[-.04em]" id="camera-picker-title">
							{live ? "Alterar câmera" : "Transmitir câmera"}
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

				<div className="relative grid aspect-video place-items-center overflow-hidden rounded-[10px] border border-app-line bg-[#05070a]">
					<video className={cn("size-full -scale-x-100 object-cover", !preview && "hidden")} ref={videoRef} muted playsInline />
					{loading ? (
						<div className="absolute inset-0 grid place-items-center content-center gap-2.5 text-center text-xs text-app-muted">
							<RefreshCw className="size-6 animate-spin text-app-accent" />
							<span className="text-[11px]">Abrindo câmera...</span>
						</div>
					) : (
						!preview && (
							<div className="absolute inset-0 grid place-items-center content-center gap-2.5 p-5 text-center text-xs text-app-muted">
								<Video className="size-6 text-app-muted" />
								<span className="text-[11px]">{error || "Nenhuma prévia disponível."}</span>
							</div>
						)
					)}
				</div>
				{error && preview && <p className="mt-2.5 text-[11px] text-app-danger">{error}</p>}

				<div className="mt-5 border-t border-app-line-soft pt-[17px]">
					<div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
						<label className="grid min-w-0 gap-2 text-xs font-bold text-app-muted sm:col-span-3">
							<span>Câmera</span>
							<select
								className={cn(fieldClass, "appearance-none")}
								value={deviceID}
								onChange={(event) => onDevice(event.target.value)}
								disabled={devices.length === 0}
							>
								{devices.length === 0 && <option value={deviceID}>Câmera padrão</option>}
								{devices.map((device, index) => (
									<option value={device.deviceId} key={device.deviceId}>
										{device.label || `Câmera ${index + 1}`}
									</option>
								))}
							</select>
						</label>
						<label className="grid min-w-0 gap-2 text-xs font-bold text-app-muted sm:col-span-2">
							<span>Resolução</span>
							<select
								className={cn(fieldClass, "appearance-none")}
								value={resolution}
								onChange={(event) => onResolution(event.target.value as CameraResolution)}
							>
								{Object.entries(cameraResolutions).map(([value, option]) => (
									<option value={value} key={value}>
										{option.label}
									</option>
								))}
							</select>
						</label>
						<label className="grid min-w-0 gap-2 text-xs font-bold text-app-muted">
							<span>Taxa de quadros</span>
							<select
								className={cn(fieldClass, "appearance-none")}
								value={frameRate}
								onChange={(event) => onFrameRate(Number(event.target.value) as 30 | 60)}
							>
								<option value={30}>30 FPS</option>
								<option value={60}>60 FPS</option>
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
							disabled={!preview || loading || starting}
						>
							{starting ? (
								<>
									<RefreshCw className="size-4 animate-spin" /> {live ? "Aplicando..." : "Iniciando..."}
								</>
							) : live ? (
								"Aplicar"
							) : (
								"Transmitir câmera"
							)}
						</button>
					</div>
				</div>
			</section>
		</div>
	);
}
