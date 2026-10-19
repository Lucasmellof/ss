import { ShieldAlert } from "lucide-react";
import { useEffect, useState } from "react";

export function ScreenPermissionNotice() {
	const desktop = typeof window === "undefined" ? undefined : window.screenShare;
	const isMac = desktop?.platform === "darwin";
	const [status, setStatus] = useState<ScreenPermissionStatus>("granted");

	useEffect(() => {
		if (!isMac || !desktop?.screenPermission) return undefined;
		let active = true;
		const refresh = async () => {
			try {
				const next = await desktop.screenPermission();
				if (active) setStatus(next);
			} catch {
				return;
			}
		};
		void refresh();
		window.addEventListener("focus", refresh);
		return () => {
			active = false;
			window.removeEventListener("focus", refresh);
		};
	}, [desktop, isMac]);

	if (!isMac || status === "granted") return null;

	return (
		<div className="mb-2.5 flex flex-wrap items-center justify-between gap-2.5 rounded-lg border border-amber-400/30 bg-amber-400/8 px-3 py-2 text-[11px] leading-5 text-app-muted">
			<span className="inline-flex items-center gap-2">
				<ShieldAlert className="size-4 shrink-0 text-amber-300" />
				Permita a Gravação de Tela para o Screen Share nas Preferências de Privacidade do macOS e reabra o app.
			</span>
			<button
				className="inline-flex min-h-[30px] items-center rounded-[7px] border border-amber-400/40 px-2.5 text-[11px] font-extrabold text-amber-200 hover:bg-amber-400/12"
				type="button"
				onClick={() => void desktop?.openScreenPermissionSettings()}
			>
				Abrir Preferências de Privacidade
			</button>
		</div>
	);
}
