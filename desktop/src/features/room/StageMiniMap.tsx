import { useEffect, useRef } from "react";
import type { StagePan, Tile } from "./types";

type StageMiniMapProps = {
	tile: Tile;
	zoom: number;
	pan: StagePan;
};

export function StageMiniMap({ tile, zoom, pan }: StageMiniMapProps) {
	const videoRef = useRef<HTMLVideoElement>(null);
	const viewportSize = 100 / zoom;
	const viewportLeft = Math.max(0, Math.min(100 - viewportSize, 50 - pan.x / zoom - viewportSize / 2));
	const viewportTop = Math.max(0, Math.min(100 - viewportSize, 50 - pan.y / zoom - viewportSize / 2));

	useEffect(() => {
		const video = videoRef.current;
		if (!video) return;
		video.srcObject = tile.stream;
		void video.play().catch(() => undefined);
		return () => {
			if (video.srcObject === tile.stream) video.srcObject = null;
		};
	}, [tile.stream]);

	return (
		<aside className="pointer-events-none absolute right-3 bottom-3 z-20 w-44 rounded-lg border border-white/20 bg-black/75 p-1.5 shadow-[0_8px_30px_rgba(0,0,0,.45)] backdrop-blur-sm">
			<div className="relative aspect-video overflow-hidden rounded-[5px] bg-[#17191c]">
				<video ref={videoRef} className="size-full object-contain" autoPlay muted playsInline />
				<div
					className="absolute rounded-[3px] border-2 border-app-accent shadow-[0_0_0_999px_rgba(0,0,0,.18)]"
					style={{
						width: `${viewportSize}%`,
						height: `${viewportSize}%`,
						left: `${viewportLeft}%`,
						top: `${viewportTop}%`,
					}}
				/>
			</div>
			<p className="truncate px-1 pt-1 text-[9px] font-bold text-white/75">Visão geral · {tile.name}</p>
		</aside>
	);
}
