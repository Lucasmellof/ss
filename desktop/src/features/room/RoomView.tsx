import { type CSSProperties, type PointerEvent, type WheelEvent, useEffect, useRef, useState } from "react";
import {
	Activity,
	Check,
	Copy,
	Expand,
	ExternalLink,
	Eye,
	EyeOff,
	Grid2X2,
	LogOut,
	Maximize2,
	Minus,
	Monitor,
	MonitorUp,
	Plus,
	RefreshCw,
	Scan,
	Users,
	Volume2,
	VolumeX,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ParticipantCard } from "./ParticipantCard";
import { StageMiniMap } from "./StageMiniMap";
import { VideoTile } from "./VideoTile";
import type { RoomViewProps, StageLayout, StagePan } from "./types";

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
	hiddenTiles,
	onHideTile,
	onShowTile,
	featured,
	pinned,
	sharing,
	startingShare,
	soundsEnabled,
	stageLayout,
	layoutManual,
	stageZoom,
	onPin,
	linkCopied,
	desktopLink,
	onCopyLink,
	onShare,
	onStopShare,
	onLeave,
	onToggleSounds,
	onStageLayout,
	onStageZoom,
}: RoomViewProps) {
	const [peopleOpen, setPeopleOpen] = useState(false);
	const [streamsOpen, setStreamsOpen] = useState(false);
	const [fullscreen, setFullscreen] = useState(false);
	const [stagePan, setStagePan] = useState<StagePan>({ x: 0, y: 0 });
	const [dragging, setDragging] = useState(false);
	const dragRef = useRef<{ x: number; y: number; pan: StagePan } | undefined>(undefined);
	const draggedRef = useRef(false);
	const hiddenOwnerIDs = hiddenTiles
		.map((tile) => tile.ownerId)
		.filter((id): id is string => Boolean(id) && !tiles.some((tile) => tile.ownerId === id));
	const isSelfSharing = (member: { name: string }) => sharing && member.name === selfName;
	// Quem transmite mas ainda não tem tela carregada continua visível, com um overlay de carregamento.
	const loadingMemberIDs = streamingMembers.filter(
		(id) =>
			!tiles.some((tile) => tile.ownerId === id) &&
			!hiddenOwnerIDs.includes(id) &&
			members.some((member) => member.id === id && !isSelfSharing(member)),
	);
	const visibleMembers = members.filter(
		(member) =>
			(!streamingMembers.includes(member.id) || hiddenOwnerIDs.includes(member.id) || loadingMemberIDs.includes(member.id)) &&
			!isSelfSharing(member),
	);
	const watchHandler = (memberID: string) =>
		hiddenOwnerIDs.includes(memberID)
			? () => hiddenTiles.filter((tile) => tile.ownerId === memberID).forEach((tile) => onShowTile(tile.id))
			: undefined;
	const cardCount = visibleMembers.length + tiles.length;
	const effectiveLayout: StageLayout = tiles.length === 0 ? "grid" : layoutManual ? stageLayout : tiles.length === 1 ? "focus" : "grid";
	const gridColumns = cardCount <= 1 ? 1 : cardCount <= 6 ? 2 : cardCount <= 9 ? 3 : Math.min(8, Math.ceil(Math.sqrt(cardCount * 1.78)));
	const gridRows = Math.max(1, Math.ceil(cardCount / gridColumns));
	// Células com tamanho definido: com muitos cards eles encolhem juntos em vez de se sobreporem.
	const gridStyle: CSSProperties = {
		gridTemplateColumns: `repeat(${gridColumns}, minmax(0, 1fr))`,
		gridTemplateRows: `repeat(${gridRows}, minmax(0, 1fr))`,
	};
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
					{desktopLink && (
						<a
							className="inline-flex items-center gap-1.5 rounded-[7px] border border-[#282d33] bg-[#111317] px-2.5 py-1.5 text-[11px] font-extrabold text-[#c8d0d6] hover:border-[#49535d] hover:bg-[#1a1e23] max-sm:hidden"
							href={desktopLink}
						>
							<ExternalLink className="size-3.5" /> Abrir no app desktop
						</a>
					)}
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
						className={cn(
							"inline-flex items-center gap-1.5 rounded-[7px] border border-[#282d33] bg-[#111317] px-2.5 py-1.5 text-[11px] font-extrabold text-[#c8d0d6] hover:border-[#49535d] hover:bg-[#1a1e23]",
							!soundsEnabled && "text-[#7f8992]",
						)}
						type="button"
						onClick={onToggleSounds}
						title={soundsEnabled ? "Desativar efeitos sonoros" : "Ativar efeitos sonoros"}
						aria-label={soundsEnabled ? "Desativar efeitos sonoros" : "Ativar efeitos sonoros"}
						aria-pressed={soundsEnabled}
					>
						{soundsEnabled ? <Volume2 className="size-3.5" /> : <VolumeX className="size-3.5" />}
						<span className="max-md:hidden">{soundsEnabled ? "Desativar efeitos sonoros" : "Ativar efeitos sonoros"}</span>
					</button>
					<button
						className="inline-flex items-center gap-1.5 rounded-[7px] border border-[#282d33] bg-[#111317] px-2.5 py-1.5 text-[11px] font-extrabold text-[#c8d0d6] hover:border-[#49535d] hover:bg-[#1a1e23]"
						type="button"
						onClick={() => {
							setStreamsOpen((open) => !open);
							setPeopleOpen(false);
						}}
						title="Escolher quais transmissões assistir"
					>
						<Monitor className="size-3.5" /> {tiles.filter((tile) => !tile.local).length}/
						{tiles.filter((tile) => !tile.local).length + hiddenTiles.length}
					</button>
					<button
						className="inline-flex items-center gap-1.5 rounded-[7px] border border-[#282d33] bg-[#111317] px-2.5 py-1.5 text-[11px] font-extrabold text-[#c8d0d6] hover:border-[#49535d] hover:bg-[#1a1e23]"
						type="button"
						onClick={() => {
							setPeopleOpen((open) => !open);
							setStreamsOpen(false);
						}}
					>
						<Users className="size-3.5" /> {members.length}
					</button>
				</div>
				{streamsOpen && (
					<div className="absolute top-11 right-0 z-30 w-[270px] rounded-[10px] border border-[#2a3037] bg-[#15181c] p-2.5 shadow-[0_18px_60px_rgba(0,0,0,.55)]">
						<div className="flex items-center justify-between border-b border-[#272d34] px-1.5 pb-2 text-xs">
							<strong>Transmissões</strong>
							<span className="text-[11px] text-app-muted">
								{tiles.filter((tile) => !tile.local).length + hiddenTiles.length}
							</span>
						</div>
						{tiles.filter((tile) => !tile.local).length + hiddenTiles.length === 0 ? (
							<p className="my-1 px-1.5 text-xs text-app-muted">Nenhuma transmissão no momento.</p>
						) : (
							[
								...tiles.filter((tile) => !tile.local).map((tile) => ({ tile, watching: true })),
								...hiddenTiles.map((tile) => ({ tile, watching: false })),
							].map(({ tile, watching }) => (
								<div
									className="flex items-center gap-2 rounded-lg px-1 py-1.5 text-xs text-[#d7dfe5] hover:bg-app-panel-raised"
									key={tile.id}
								>
									<Monitor className={cn("size-3.5 shrink-0", watching ? "text-app-accent" : "text-[#7f8992]")} />
									<span className={cn("overflow-hidden text-ellipsis whitespace-nowrap", !watching && "text-[#7f8992]")}>
										{tile.name}
									</span>
									<div className="ml-auto flex items-center gap-1">
										{watching && (
											<button
												className="rounded-[6px] border border-[#282d33] px-1.5 py-1 text-[10px] font-extrabold hover:border-[#49535d]"
												type="button"
												onClick={() => onPin(tile.id)}
											>
												Ver
											</button>
										)}
										<button
											className="grid size-6 place-items-center rounded-[6px] border border-[#282d33] hover:border-[#49535d]"
											type="button"
											onClick={() => (watching ? onHideTile(tile.id) : onShowTile(tile.id))}
											title={watching ? "Parar de assistir" : "Voltar a assistir"}
											aria-label={watching ? `Parar de assistir ${tile.name}` : `Voltar a assistir ${tile.name}`}
										>
											{watching ? <EyeOff className="size-3" /> : <Eye className="size-3" />}
										</button>
									</div>
								</div>
							))
						)}
					</div>
				)}
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
							<VideoTile tile={featured} large pinned={pinned === featured.id} onPin={onPin} onHide={onHideTile} />
						) : visibleMembers.length === 1 && tiles.length === 0 ? (
							<div className="flex h-full min-h-0 w-full items-center justify-center">
								<ParticipantCard
									member={visibleMembers[0]}
									self={visibleMembers[0].name === selfName}
									fill
									loading={loadingMemberIDs.includes(visibleMembers[0].id)}
									onWatch={watchHandler(visibleMembers[0].id)}
								/>
							</div>
						) : cardCount > 0 ? (
							<div className="grid h-full min-h-0 w-full gap-2.5 p-0" style={gridStyle}>
								{visibleMembers.map((member) => (
									<ParticipantCard
										key={`member-${member.id}`}
										member={member}
										self={member.name === selfName}
										fill={cardCount === 1}
										loading={loadingMemberIDs.includes(member.id)}
										onWatch={watchHandler(member.id)}
									/>
								))}
								{tiles.map((tile) => (
									<VideoTile key={tile.id} tile={tile} pinned={pinned === tile.id} onPin={onPin} onHide={onHideTile} />
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
								<VideoTile key={tile.id} tile={tile} pinned={pinned === tile.id} onPin={onPin} onHide={onHideTile} />
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
