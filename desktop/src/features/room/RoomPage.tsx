import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { SourcePicker } from "@/features/capture/SourcePicker";
import { buildRoomLink } from "@/lib/room-link";
import { RoomView } from "./RoomView";
import { useRoomApp } from "./RoomSessionProvider";
import { useRoomPing } from "./RoomPingProvider";

export function RoomPage() {
	const navigate = useNavigate();
	const { session, capture, stage, tiles, leave } = useRoomApp();
	const ping = useRoomPing();
	const [linkCopied, setLinkCopied] = useState(false);

	useEffect(() => {
		if (!session.joined) void navigate({ to: "/", replace: true });
	}, [session.joined, navigate]);

	if (!session.joined) return null;

	return (
		<>
			<RoomView
				room={session.room}
				selfName={session.name}
				status={session.status}
				ping={ping}
				members={session.members}
				streamingMembers={session.streamingMembers}
				tiles={tiles}
				featured={stage.featured}
				pinned={stage.pinned}
				sharing={capture.sharing}
				startingShare={capture.startingShare}
				stageLayout={stage.stageLayout}
				layoutManual={stage.stageLayoutManual}
				stageZoom={stage.stageZoom}
				onStageLayout={stage.onStageLayout}
				onStageZoom={stage.onStageZoom}
				onPin={stage.onPin}
				linkCopied={linkCopied}
				onCopyLink={async () => {
					const link = buildRoomLink(session.room);
					try {
						await navigator.clipboard.writeText(link);
						setLinkCopied(true);
						window.setTimeout(() => setLinkCopied(false), 1800);
					} catch {
						window.prompt("Copie este link:", link);
					}
				}}
				onShare={() => void capture.loadSources()}
				onStopShare={capture.stopSharing}
				onLeave={() => {
					leave();
					void navigate({ to: "/", replace: true });
				}}
			/>

			{capture.pickerOpen && (
				<SourcePicker
					sources={capture.sources}
					selectedID={capture.selectedSourceID}
					sourceType={capture.sourceType}
					frameRate={capture.frameRate}
					resolution={capture.resolution}
					audioMode={capture.audioMode}
					loading={capture.loadingSources}
					starting={capture.startingShare}
					onType={capture.selectSourceType}
					onSelect={capture.selectSource}
					onFrameRate={capture.setFrameRate}
					onResolution={capture.setResolution}
					onAudioMode={capture.setAudioMode}
					onRefresh={() => void capture.loadSources()}
					onClose={capture.closePicker}
					onStart={() => void capture.startSharing()}
				/>
			)}
		</>
	);
}
