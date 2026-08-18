import { type CSSProperties, type PointerEvent, type WheelEvent, useEffect, useRef, useState } from "react";
import { Activity, Check, Copy, Expand, Grid2X2, LogOut, Maximize2, Minus, MonitorUp, Plus, RefreshCw, Scan, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { ParticipantCard } from "./ParticipantCard";
import { StageMiniMap } from "./StageMiniMap";
import { VideoTile } from "./VideoTile";
import type { RoomViewProps, StageLayout, StagePan } from "./types";

const gridColumnClasses = {
	1: "grid-cols-1",
	2: "grid-cols-2",
	3: "grid-cols-3",
	4: "grid-cols-4",
} as const;

const clampZoom = (value: number) => Math.max(1, Math.min(2, Number(value.toFixed(3))));
const clampPan = (pan: StagePan, zoom: number): StagePan => {
	const limit = Math.max(0, (zoom - 1) * 50);
	return {
		x: Math.max(-limit, Math.min(limit, pan.x)),
		y: Math.max(-limit, Math.min(limit, pan.y)),
	};
};

export function RoomView({
	room,
	selfName,
	status,
	ping,
	members,
	streamingMembers,
	tiles,
	featured,
	pinned,
	sharing,
	startingShare,
	stageLayout,
	layoutManual,
	stageZoom,
	onPin,
	linkCopied,
	onCopyLink,
	onShare,
	onStopShare,
	onLeave,
	onStageLayout,
	onStageZoom,
}: RoomViewProps) {
	const [peopleOpen, setPeopleOpen] = useState(false);
	const [fullscreen, setFullscreen] = useState(false);
	const [stagePan, setStagePan] = useState<StagePan>({ x: 0, y: 0 });
	const [dragging, setDragging] = useState(false);
	const dragRef = useRef<{ x: number; y: number; pan: StagePan } | undefined>(undefined);
	const draggedRef = useRef(false);
	const visibleMembers = members.filter((member) => !streamingMembers.includes(member.id) && !(sharing && member.name === selfName));
	const cardCount = visibleMembers.length + tiles.length;
	const effectiveLayout: StageLayout = tiles.length === 0 ? "grid" : tiles.length === 1 ? "focus" : layoutManual ? stageLayout : "grid";
	const gridColumns = cardCount <= 1 ? 1 : cardCount <= 6 ? 2 : cardCount <= 9 ? 3 : 4;
	const showLayoutControls = tiles.length > 1;
	const showZoomReset = stageZoom > 1;
	const stageStyle = { transform: `translate(${stagePan.x}%, ${stagePan.y}%) scale(${stageZoom})` } as CSSProperties;
	const updateZoom = (nextZoom: number, pointer = { x: 0, y: 0 }) => {
		const zoom = clampZoom(nextZoom);
		if (zoom === 1) {
			setStagePan({ x: 0, y: 0 });
			onStageZoom(zoom);
			return;
		}
		const nextPan = {
			x: pointer.x - zoom * ((pointer.x - stagePan.x) / stageZoom),
			y: pointer.y - zoom * ((pointer.y - stagePan.y) / stageZoom),
		};
		setStagePan(clampPan(nextPan, zoom));
		onStageZoom(zoom);
	};
	const handleStageWheel = (event: WheelEvent<HTMLDivElement>) => {
		const bounds = event.currentTarget.getBoundingClientRect();
		const pointer = {
			x: ((event.clientX - bounds.left) / bounds.width - 0.5) * 100,
			y: ((event.clientY - bounds.top) / bounds.height - 0.5) * 100,
		};
		const delta = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaY;
		updateZoom(stageZoom * Math.exp(-delta * 0.0008), pointer);
	};
	const handleStagePointerDown = (event: PointerEvent<HTMLDivElement>) => {
		if (stageZoom <= 1 || event.button !== 0) return;
		event.currentTarget.setPointerCapture(event.pointerId);
		dragRef.current = { x: event.clientX, y: event.clientY, pan: stagePan };
		draggedRef.current = false;
		setDragging(true);
	};
	const handleStagePointerMove = (event: PointerEvent<HTMLDivElement>) => {
		const drag = dragRef.current;
		if (!drag) return;
		const bounds = event.currentTarget.getBoundingClientRect();
		const deltaX = ((event.clientX - drag.x) / bounds.width) * 100;
		const deltaY = ((event.clientY - drag.y) / bounds.height) * 100;
		if (Math.abs(deltaX) > 1 || Math.abs(deltaY) > 1) draggedRef.current = true;
		setStagePan(clampPan({ x: drag.pan.x + deltaX, y: drag.pan.y + deltaY }, stageZoom));
	};
	const handleStagePointerUp = (event: PointerEvent<HTMLDivElement>) => {
		if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
		dragRef.current = undefined;
		setDragging(false);
	};
	useEffect(() => {
		const updateFullscreen = () => setFullscreen(Boolean(document.fullscreenElement));
		document.addEventListener("fullscreenchange", updateFullscreen);
		return () => document.removeEventListener("fullscreenchange", updateFullscreen);
	}, []);
	const toggleFullscreen = async () => {
		try {
			if (document.fullscreenElement) await document.exitFullscreen();
			else await document.documentElement.requestFullscreen();
		} catch {
			setFullscreen(false);
		}
	};
	return (
		<div
			className={cn(
				"fixed inset-0 z-10 flex flex-col bg-black text-app-text",
				fullscreen ? "p-0" : "p-[10px] sm:px-[18px] sm:py-[14px]",
			)}
		>
			<header
				className={cn("relative flex min-h-[34px] items-center justify-between gap-[18px] sm:min-h-10", fullscreen && "hidden")}
			>
				<div className="flex items-center gap-2.5">
					<span className="size-2 rounded-full bg-app-accent shadow-[0_0_12px_rgba(140,226,189,.8)]" />
					<div>
						<strong className="block max-w-[42vw] overflow-hidden text-[13px] text-ellipsis whitespace-nowrap">{room}</strong>
						<span className="mt-0.5 block max-w-[42vw] overflow-hidden text-[10px] text-[#7d858d] text-ellipsis whitespace-nowrap">
							{status}
						</span>
					</div>
				</div>
				<div className="flex items-center gap-2.5">
					<button
						className="inline-flex items-center gap-1.5 rounded-[7px] border border-[#282d33] bg-[#111317] px-2.5 py-1.5 text-[11px] font-extrabold text-[#c8d0d6] hover:border-[#49535d] hover:bg-[#1a1e23]"
						type="button"
						onClick={onCopyLink}
						aria-label="Copiar link da sala"
					>
						{linkCopied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
						{linkCopied ? "Link copiado" : "Copiar link"}
					</button>
					<span
						className={cn(
							"inline-flex items-center gap-1 text-[10px]",
							ping === undefined
								? "text-[#7f8992]"
								: ping < 100
									? "text-app-accent"
									: ping < 250
										? "text-[#e7c77b]"
										: "text-app-danger",
						)}
						title="Latência de ida e volta até o relay"
					>
						<Activity className="size-3" /> {ping === undefined ? "Ping --" : `Ping ${ping} ms`}
					</span>
					<span className="text-[10px] text-[#7f8992] max-sm:hidden">Conectado</span>
					<button
						className="inline-flex items-center gap-1.5 rounded-[7px] border border-[#282d33] bg-[#111317] px-2.5 py-1.5 text-[11px] font-extrabold text-[#c8d0d6] hover:border-[#49535d] hover:bg-[#1a1e23]"
						type="button"
						onClick={() => setPeopleOpen((open) => !open)}
					>
						<Users className="size-3.5" /> {members.length}
					</button>
				</div>
				{peopleOpen && (
					<div className="absolute top-11 right-0 z-30 w-[235px] rounded-[10px] border border-[#2a3037] bg-[#15181c] p-2.5 shadow-[0_18px_60px_rgba(0,0,0,.55)]">
						<div className="flex items-center justify-between border-b border-[#272d34] px-1.5 pb-2 text-xs">
							<strong>Pessoas</strong>
							<span className="text-[11px] text-app-muted">{members.length}</span>
						</div>
						{members.length === 0 ? (
							<p className="my-1 px-1.5 text-xs text-app-muted">Ninguém conectado.</p>
						) : (
							members.map((member) => (
								<div
									className="flex items-center gap-2 rounded-lg px-1 py-1.5 text-xs text-[#d7dfe5] hover:bg-app-panel-raised"
									key={member.id}
								>
									<span className="grid size-[25px] shrink-0 place-items-center rounded-[7px] bg-app-accent text-[11px] font-black text-[#082016]">
										{member.name.slice(0, 1).toUpperCase()}
									</span>
									<span className="overflow-hidden text-ellipsis whitespace-nowrap">{member.name}</span>
									<span className="ml-auto size-1.5 rounded-full bg-app-accent" />
								</div>
							))
						)}
					</div>
				)}
			</header>

			<main
				className={cn("flex min-h-0 w-full flex-1 flex-col items-center justify-center", fullscreen ? "py-0" : "py-2 sm:py-[10px]")}
			>
				<div
					onWheel={handleStageWheel}
					onPointerDown={handleStagePointerDown}
					onPointerMove={handleStagePointerMove}
					onPointerUp={handleStagePointerUp}
					onPointerCancel={handleStagePointerUp}
					onClickCapture={(event) => {
						if (!draggedRef.current) return;
						event.stopPropagation();
						draggedRef.current = false;
					}}
					className={cn(
						"relative min-h-0 w-full flex-1 touch-none overscroll-none overflow-hidden rounded-lg bg-transparent",
						stageZoom > 1 && (dragging ? "cursor-grabbing" : "cursor-grab"),
						effectiveLayout === "focus" ? "max-w-none" : "",
						fullscreen && "rounded-none",
					)}
				>
					<div
						className={cn(
							"h-full min-h-0 w-full origin-center",
							dragging ? "transition-none" : "transition-transform duration-150 ease-out",
						)}
						style={stageStyle}
					>
						{effectiveLayout === "focus" && featured ? (
							<VideoTile tile={featured} large pinned={pinned === featured.id} onPin={onPin} />
						) : visibleMembers.length === 1 && tiles.length === 0 ? (
							<div className="flex h-full min-h-0 w-full items-center justify-center">
								<ParticipantCard member={visibleMembers[0]} self={visibleMembers[0].name === selfName} fill />
							</div>
						) : cardCount > 0 ? (
							<div className={cn("grid h-full min-h-0 w-full content-center gap-2.5 p-0", gridColumnClasses[gridColumns])}>
								{visibleMembers.map((member) => (
									<ParticipantCard
										key={`member-${member.id}`}
										member={member}
										self={member.name === selfName}
										fill={cardCount === 1}
									/>
								))}
								{tiles.map((tile) => (
									<VideoTile key={tile.id} tile={tile} pinned={pinned === tile.id} onPin={onPin} />
								))}
							</div>
						) : (
							<div className="grid h-full min-h-0 place-items-center content-center gap-2.5 p-9 text-center text-app-muted">
								<MonitorUp className="size-[25px] text-app-accent" />
								<strong className="text-sm text-app-text">Aguardando compartilhamento</strong>
								<span className="max-w-[280px] text-xs leading-6">
									Quando alguém compartilhar a tela, ela aparecerá aqui.
								</span>
							</div>
						)}
					</div>
					{stageZoom > 1 && featured && !fullscreen && <StageMiniMap tile={featured} zoom={stageZoom} pan={stagePan} />}
				</div>
				{!fullscreen && effectiveLayout === "focus" && tiles.length > 1 && (
					<div className="grid w-full max-w-[1160px] grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-[9px]">
						{tiles
							.filter((tile) => tile.id !== featured?.id)
							.map((tile) => (
								<VideoTile key={tile.id} tile={tile} pinned={pinned === tile.id} onPin={onPin} />
							))}
					</div>
				)}
			</main>

			<footer
				className={cn(
					"flex min-h-[54px] items-center justify-between gap-3.5 px-0.5 max-sm:flex-wrap max-sm:justify-center",
					fullscreen && "hidden",
				)}
			>
				<div className="flex items-center justify-center gap-1.5">
					{sharing ? (
						<button
							className="inline-flex h-[38px] min-w-[38px] items-center justify-center gap-1.5 rounded-[9px] border border-app-accent/35 bg-[#ED2939] px-2.5 text-[11px] font-extrabold text-app-text"
							type="button"
							onClick={() => onStopShare()}
							aria-label="Parar compartilhamento"
						>
							{startingShare ? <RefreshCw className="size-[17px] animate-spin" /> : <MonitorUp className="size-[17px]" />}
							<span className="max-sm:hidden">{startingShare ? "Conectando" : "Parar Compartilhamento"}</span>
						</button>
					) : (
						<button
							className="inline-flex h-[38px] min-w-[38px] items-center justify-center gap-1.5 rounded-[9px] border border-[#282d33] bg-[#111317] px-2.5 text-[11px] font-extrabold text-[#bbc3ca] hover:border-[#47535c] hover:bg-[#20252b]"
							type="button"
							onClick={onShare}
							aria-label="Compartilhar tela"
						>
							<MonitorUp className="size-[17px]" />
							<span className="max-sm:hidden">Compartilhar</span>
						</button>
					)}
					{(showLayoutControls || showZoomReset) && <div className="mx-1 h-[23px] w-px bg-[#2b3036]" />}
					{showLayoutControls && (
						<>
							<button
								className={cn(
									"inline-flex size-[38px] items-center justify-center rounded-[9px] border border-[#282d33] bg-[#111317] text-[#bbc3ca] hover:border-[#47535c] hover:bg-[#20252b]",
									effectiveLayout === "grid" && "border-[#47535c] bg-[#20252b] text-app-text",
								)}
								type="button"
								onClick={() => onStageLayout("grid")}
								aria-label="Layout em grade"
							>
								<Grid2X2 className="size-[17px]" />
							</button>
							<button
								className={cn(
									"inline-flex size-[38px] items-center justify-center rounded-[9px] border border-[#282d33] bg-[#111317] text-[#bbc3ca] hover:border-[#47535c] hover:bg-[#20252b]",
									effectiveLayout === "focus" && "border-[#47535c] bg-[#20252b] text-app-text",
								)}
								type="button"
								onClick={() => onStageLayout("focus")}
								aria-label="Modo foco"
							>
								<Maximize2 className="size-[17px]" />
							</button>
						</>
					)}
					{showZoomReset && (
						<button
							className="inline-flex size-[38px] items-center justify-center rounded-[9px] border border-[#282d33] bg-[#111317] text-[#bbc3ca] hover:border-[#47535c] hover:bg-[#20252b]"
							type="button"
							onClick={() => updateZoom(1)}
							aria-label="Ajustar ao palco"
						>
							<Scan className="size-[17px]" />
						</button>
					)}
				</div>
				<div className="flex items-center justify-center gap-1.5">
					<button
						className="inline-flex size-[38px] items-center justify-center rounded-[9px] border border-[#282d33] bg-[#111317] text-[#bbc3ca] hover:border-[#47535c] hover:bg-[#20252b] disabled:cursor-not-allowed disabled:opacity-50"
						type="button"
						disabled={stageZoom <= 1}
						onClick={() => updateZoom(stageZoom - 0.1)}
						aria-label="Diminuir zoom"
					>
						<Minus className="size-[17px]" />
					</button>
					<button
						className="inline-flex h-[38px] min-w-12 items-center justify-center rounded-[9px] border border-transparent bg-[#181c21] px-2.5 text-[11px] font-extrabold text-app-text"
						type="button"
						onClick={() => updateZoom(1)}
					>
						{Math.round(stageZoom * 100)}%
					</button>
					<button
						className="inline-flex size-[38px] items-center justify-center rounded-[9px] border border-[#282d33] bg-[#111317] text-[#bbc3ca] hover:border-[#47535c] hover:bg-[#20252b] disabled:cursor-not-allowed disabled:opacity-50"
						type="button"
						disabled={stageZoom >= 2}
						onClick={() => updateZoom(stageZoom + 0.1)}
						aria-label="Aumentar zoom"
					>
						<Plus className="size-[17px]" />
					</button>
					<button
						className={cn(
							"inline-flex size-[38px] items-center justify-center rounded-[9px] border border-[#282d33] bg-[#111317] text-[#bbc3ca] hover:border-[#47535c] hover:bg-[#20252b]",
							fullscreen && "border-[#47535c] bg-[#20252b] text-app-text",
						)}
						type="button"
						onClick={() => void toggleFullscreen()}
						aria-label="Tela cheia"
					>
						<Expand className="size-[17px]" />
					</button>
					<button
						className="inline-flex size-[38px] items-center justify-center rounded-[9px] border border-app-danger/35 bg-app-danger/12 text-app-danger hover:bg-app-danger/22"
						type="button"
						onClick={onLeave}
						aria-label="Sair da sala"
					>
						<LogOut className="size-[17px]" />
					</button>
				</div>
			</footer>
		</div>
	);
}
