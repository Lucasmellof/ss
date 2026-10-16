import { Check, Video, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CameraDevice } from "./useCameraCapture";

type CameraPickerProps = {
	devices: CameraDevice[];
	lastDeviceId: string;
	onSelect: (deviceId: string) => void;
	onClose: () => void;
};

export function CameraPicker({ devices, lastDeviceId, onSelect, onClose }: CameraPickerProps) {
	return (
		<div
			className="fixed inset-0 z-20 grid place-items-center bg-black/80 p-2.5 sm:p-5"
			role="presentation"
			onMouseDown={(event) => {
				if (event.target === event.currentTarget) onClose();
			}}
		>
			<section
				className="w-full max-w-[420px] rounded-[15px] border border-app-line bg-[#11151a] p-[17px] shadow-[0_30px_100px_rgba(0,0,0,.55)] sm:p-[22px]"
				role="dialog"
				aria-modal="true"
				aria-labelledby="camera-picker-title"
			>
				<div className="mb-4 flex items-center justify-between gap-[15px]">
					<h2 className="text-[20px] font-semibold tracking-[-.04em]" id="camera-picker-title">
						Escolha a câmera
					</h2>
					<button
						className="grid size-[30px] shrink-0 place-items-center rounded-lg border border-transparent text-[#dbe2e7] hover:border-app-accent/40 hover:bg-app-accent/12 hover:text-app-accent"
						type="button"
						onClick={onClose}
						aria-label="Fechar"
					>
						<X className="size-3.5" />
					</button>
				</div>
				<div className="grid gap-2">
					{devices.map((device) => (
						<button
							key={device.id}
							className={cn(
								"flex items-center gap-2.5 rounded-[9px] border border-app-line bg-[#0d1014] px-[13px] py-3 text-left text-xs font-bold text-app-text hover:border-app-accent/50",
								device.id === lastDeviceId && "border-app-accent/60",
							)}
							type="button"
							onClick={() => onSelect(device.id)}
						>
							<Video className="size-4 shrink-0 text-app-muted" />
							<span className="min-w-0 flex-1 truncate">{device.label}</span>
							{device.id === lastDeviceId && <Check className="size-4 shrink-0 text-app-accent" />}
						</button>
					))}
				</div>
			</section>
		</div>
	);
}
