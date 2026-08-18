import { cn } from "@/lib/utils";
import type { ParticipantCardProps } from "./types";

const participantColors = ["bg-[#202326]", "bg-[#4c302a]", "bg-[#423625]", "bg-[#163d29]", "bg-[#302a3d]", "bg-[#3d2e22]", "bg-[#263d43]"];

export function ParticipantCard({ member, self, compact = false, fill = false }: ParticipantCardProps) {
	let hash = 0;
	for (const character of member.id) hash = (hash * 31 + character.charCodeAt(0)) | 0;
	const color = participantColors[Math.abs(hash) % participantColors.length];
	return (
		<article
			className={cn(
				"relative grid aspect-video min-h-0 place-items-center overflow-hidden rounded-lg",
				color,
				compact && "h-auto",
				fill && "h-full w-full aspect-auto",
			)}
			title={member.name}
		>
			<div className="absolute inset-0 bg-gradient-to-br from-white/10 via-transparent to-black/20" />
			<div
				className={cn(
					"relative z-[1] grid aspect-square w-[clamp(58px,9vw,112px)] place-items-center rounded-full border-[3px] border-white/20 bg-black/35 text-[clamp(22px,4vw,44px)] font-extrabold text-[#f5f7f8] shadow-[0_8px_28px_rgba(0,0,0,.25)]",
					compact && "w-[38px] text-base",
				)}
			>
				{member.name.slice(0, 1).toUpperCase()}
			</div>
			<div
				className={cn(
					"absolute inset-x-3 bottom-2.5 z-[2] flex items-center justify-between gap-2 rounded-[7px] bg-black/60 px-2.5 py-2 text-xs font-extrabold text-[#f4f6f7]",
					compact && "inset-x-1.5 bottom-1.5 px-2 py-1.5 text-[10px]",
				)}
			>
				<span className="overflow-hidden text-ellipsis whitespace-nowrap">
					{member.name}
					{self ? " · você" : ""}
				</span>
				<span
					className={cn("inline-flex shrink-0 items-center gap-1 text-[10px] font-semibold text-[#bac4ca]", compact && "hidden")}
				>
					<span className="size-1.5 rounded-full bg-app-accent" /> conectado
				</span>
			</div>
		</article>
	);
}
