import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

export function StreamLoading({ name, compact = false }: { name: string; compact?: boolean }) {
	return (
		<div
			className="absolute inset-0 z-[4] grid place-items-center bg-black/60 text-center backdrop-blur-[2px]"
			role="status"
			aria-label={`Carregando a tela de ${name}`}
		>
			<div className="grid justify-items-center gap-2 px-3 text-white">
				<Loader2 className={cn("animate-spin text-app-accent", compact ? "size-5" : "size-8")} />
				<span className={cn("font-extrabold", compact ? "text-[10px]" : "text-xs")}>Carregando a tela...</span>
			</div>
		</div>
	);
}
