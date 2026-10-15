import { useEffect, useRef, useState } from "react";
import { EyeOff, Pin,Volume1, Volume2, VolumeX } from "lucide-react";
import { cn } from "@/lib/utils";
import { roomDebug, roomDebugError } from "@/lib/room/debug";
import { StreamLoading } from "./StreamLoading";
import type { VideoTileProps } from "./types";

export function VideoTile({ tile, large, pinned, onPin, onHide }: VideoTileProps) {
	const ref = useRef<HTMLVideoElement>(null);
	const [audioBlocked, setAudioBlocked] = useState(false);
	const [muted, setMuted] = useState(true);
	const [volume, setVolume] = useState(1);
	const [ready, setReady] = useState(false);

	useEffect(() => {
		const video = ref.current;
		if (!video) return;
		const logVideoEvent = (event: Event) =>
			roomDebug("video element event", {
				event: event.type,
				tileID: tile.id,
				streamID: tile.stream.id,
				readyState: video.readyState,
				videoWidth: video.videoWidth,
				videoHeight: video.videoHeight,
				currentTime: video.currentTime,
				errorCode: video.error?.code,
			});
		const markReady = () => {
			if (video.videoWidth > 0 && video.readyState >= 2) setReady(true);
		};
		const readyEvents = ["loadeddata", "playing", "resize", "timeupdate"];
		readyEvents.forEach((eventName) => video.addEventListener(eventName, markReady));
		setReady(false);
		const videoEvents = ["loadedmetadata", "loadeddata", "canplay", "playing", "waiting", "stalled", "resize", "error"];
		videoEvents.forEach((eventName) => video.addEventListener(eventName, logVideoEvent));
		const videoTrack = tile.stream.getVideoTracks()[0];
		const logTrackEvent = (event: Event) =>
			roomDebug("video track event", {
				event: event.type,
				tileID: tile.id,
				trackID: videoTrack?.id,
				readyState: videoTrack?.readyState,
				muted: videoTrack?.muted,
			});
		videoTrack?.addEventListener("mute", logTrackEvent);
		videoTrack?.addEventListener("unmute", logTrackEvent);
		videoTrack?.addEventListener("ended", logTrackEvent);
		roomDebug("video srcObject attach", {
			tileID: tile.id,
			streamID: tile.stream.id,
			trackID: videoTrack?.id,
			trackReadyState: videoTrack?.readyState,
			trackMuted: videoTrack?.muted,
		});
		video.pause();
		video.srcObject = null;
		video.srcObject = tile.stream;
		setAudioBlocked(false);
		void video.play().catch(() => {
			roomDebugError("video play failed", {
				tileID: tile.id,
				streamID: tile.stream.id,
				readyState: video.readyState,
				videoWidth: video.videoWidth,
				videoHeight: video.videoHeight,
			});
			if (!tile.local) setAudioBlocked(true);
		});
		return () => {
			readyEvents.forEach((eventName) => video.removeEventListener(eventName, markReady));
			videoEvents.forEach((eventName) => video.removeEventListener(eventName, logVideoEvent));
			videoTrack?.removeEventListener("mute", logTrackEvent);
			videoTrack?.removeEventListener("unmute", logTrackEvent);
			videoTrack?.removeEventListener("ended", logTrackEvent);
			roomDebug("video srcObject detach", { tileID: tile.id, streamID: tile.stream.id });
			if (video.srcObject === tile.stream) video.srcObject = null;
		};
	}, [tile.id, tile.stream, tile.local]);

	useEffect(() => {
		const video = ref.current;
		if (video) video.volume = muted ? 0 : volume;
	}, [muted, volume]);

	const toggleMute = () => {
		if (tile.local) return;
		const nextMuted = !muted;
		setMuted(nextMuted);
		if (nextMuted) {
			setAudioBlocked(false);
			return;
		}
		if (volume === 0) setVolume(1);
		void ref.current?.play().catch(() => setAudioBlocked(true));
	};
	const handleVolumeChange = (nextVolume: number) => {
		setVolume(nextVolume);
		if (nextVolume === 0) {
			setMuted(true);
			setAudioBlocked(false);
			return;
		}
		setMuted(false);
		setAudioBlocked(false);
		void ref.current?.play().catch(() => setAudioBlocked(true));
	};

	return (
		<article
			className={cn(
				"relative min-w-0 overflow-hidden rounded-lg border-2 border-transparent bg-[#17191c] hover:cursor-pointer hover:border-purple-800 transition-colors duration-300 mx-1",
				large && "h-full rounded-none",
			)}
			onClick={() => onPin(tile.id)}
		>
			<video
				className={cn("block size-full bg-[#17191c] object-contain", large ? "aspect-auto" : "aspect-video", !ready && "invisible")}
				ref={ref}
				autoPlay
				muted={tile.local || muted}
				playsInline
			/>
			{!ready && (
				<>
					<div className="absolute inset-0 grid place-items-center bg-[#202326]">
						<div className="grid aspect-square w-[clamp(58px,9vw,112px)] place-items-center rounded-full border-[3px] border-white/20 bg-black/35 text-[clamp(22px,4vw,44px)] font-extrabold text-[#f5f7f8]">
							{tile.name.slice(0, 1).toUpperCase()}
						</div>
					</div>
					<StreamLoading name={tile.name} />
				</>
			)}
			<div className="absolute inset-x-0 bottom-0 z-[5] flex items-center justify-between gap-2 bg-gradient-to-t from-black/80 via-black/30 to-transparent px-3 pb-2.5 pt-7 text-[11px] font-bold text-white">
				<span>{tile.name}</span>
				<div className="flex items-center gap-1.5">
					{!tile.local && (muted || audioBlocked) && (
						<button
							className="inline-flex h-[30px] items-center gap-1.5 rounded-lg bg-app-accent px-2.5 text-[10px] font-extrabold text-[#07150f]"
							type="button"
							onClick={(event) => {
								event.stopPropagation();
								setMuted(false);
								setAudioBlocked(false);
								if (volume === 0) setVolume(1);
								void ref.current?.play().catch(() => setAudioBlocked(true));
							}}
						>
							<VolumeX className="size-3.5" /> Ativar som
						</button>
					)}
					{!tile.local && !muted && !audioBlocked && (
						<>
							<label
								className="flex items-center gap-1 rounded-lg border border-white/15 bg-black/65 px-1.5 text-[#dbe2e7]"
								onClick={(event) => event.stopPropagation()}
								title={`Volume de ${tile.name}`}
							>
								<Volume1 className="size-3.5 shrink-0" />
								<input
									className="h-7 w-14 cursor-pointer accent-app-accent sm:w-20"
									max="1"
									min="0"
									onChange={(event) => handleVolumeChange(Number(event.target.value))}
									step="0.05"
									type="range"
									value={muted ? 0 : volume}
									aria-label={`Volume de ${tile.name}`}
								/>
							</label>
							<button
								className="grid size-[30px] place-items-center rounded-lg border border-white/15 bg-black/65 text-[#dbe2e7] hover:border-app-accent/40 hover:bg-app-accent/12 hover:text-app-accent"
								type="button"
								onClick={(event) => {
									event.stopPropagation();
									toggleMute();
								}}
								aria-label={muted ? `Ativar som de ${tile.name}` : `Silenciar ${tile.name}`}
							>
								{muted ? <VolumeX className="size-3.5" /> : <Volume2 className="size-3.5" />}
							</button>
						</>
					)}
					<button
						className={cn(
							"grid size-[30px] place-items-center rounded-lg border border-white/15 bg-black/65 text-[#dbe2e7] hover:border-app-accent/40 hover:bg-app-accent/12 hover:text-app-accent",
							pinned && "border-app-accent/40 bg-app-accent/12 text-app-accent",
						)}
						type="button"
						onClick={() => onPin(tile.id)}
						aria-label={pinned ? "Desafixar vídeo" : "Fixar vídeo"}
					>
						<Pin className="size-3.5" />
					</button>
					{!tile.local && onHide && (
						<button
							className="inline-flex h-[30px] items-center gap-1.5 rounded-lg border border-white/15 bg-black/65 px-2 text-[10px] font-extrabold text-[#dbe2e7] hover:border-app-danger/40 hover:bg-app-danger/12 hover:text-app-danger"
							type="button"
							onClick={(event) => {
								event.stopPropagation();
								onHide(tile.id);
							}}
							title={`Parar de assistir ${tile.name}`}
							aria-label={`Parar de assistir ${tile.name}`}
						>
							<EyeOff className="size-3.5" /> Sair da transmissão
						</button>
					)}
				</div>
			</div>
		</article>
	);
}
