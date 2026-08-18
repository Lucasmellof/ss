import type { Member, RoomStream, StreamOwner, ViewerSession } from "./types";
import { roomDebug } from "./debug";

type IsCurrentViewer = (session: ViewerSession) => boolean;

export function handleRemoteTrack(
	session: ViewerSession,
	event: RTCTrackEvent,
	isCurrentViewer: IsCurrentViewer,
	publisherIDs: ReadonlySet<string>,
	onStreams: (streams: RoomStream[]) => void,
) {
	if (!isCurrentViewer(session)) return;
	const streamID = event.streams[0]?.id ?? event.track.id;
	roomDebug("remote track received", {
		streamID,
		trackID: event.track.id,
		kind: event.track.kind,
		readyState: event.track.readyState,
		muted: event.track.muted,
		streamIDs: event.streams.map((stream) => stream.id),
	});
	if (publisherIDs.has(streamID)) return;
	const existing = session.streams.get(streamID);
	const stream = existing?.stream ?? new MediaStream([event.track]);
	const entry = existing ?? { stream, tracks: new Map<string, MediaStreamTrack>() };
	if (!entry.stream.getTracks().some((track) => track.id === event.track.id)) {
		entry.stream.addTrack(event.track);
	}
	entry.tracks.set(event.track.id, event.track);
	session.streams.set(streamID, entry);
	event.track.addEventListener(
		"ended",
		() => {
			removeRemoteTracks(session, undefined, [event.track.id], isCurrentViewer, onStreams);
		},
		{ once: true },
	);
	emitStreams(session, isCurrentViewer, onStreams);
}

export function removeRemoteTracks(
	session: ViewerSession | undefined,
	publisherID: string | undefined,
	trackIDs: string[],
	isCurrentViewer: IsCurrentViewer,
	onStreams: (streams: RoomStream[]) => void,
) {
	if (!session || !isCurrentViewer(session)) return;
	roomDebug("remote tracks removal", { publisherID, trackIDs });
	for (const [streamID, entry] of session.streams) {
		const matchesPublisher = Boolean(publisherID && publisherID === streamID);
		const matchingTracks =
			trackIDs.length === 0
				? matchesPublisher
					? [...entry.tracks.keys()]
					: []
				: trackIDs.filter((trackID) => entry.tracks.has(trackID));
		if (!matchesPublisher && matchingTracks.length === 0) continue;
		for (const trackID of matchingTracks) {
			const track = entry.tracks.get(trackID);
			if (!track) continue;
			entry.stream.removeTrack(track);
			track.stop();
			entry.tracks.delete(trackID);
		}
		if (matchesPublisher || entry.stream.getVideoTracks().length === 0) {
			for (const track of entry.stream.getTracks()) track.stop();
			session.streams.delete(streamID);
		}
	}
	emitStreams(session, isCurrentViewer, onStreams);
}

function emitStreams(session: ViewerSession, isCurrentViewer: IsCurrentViewer, onStreams: (streams: RoomStream[]) => void) {
	if (!isCurrentViewer(session)) return;
	const streams: RoomStream[] = [];
	for (const [id, entry] of session.streams) {
		if (entry.stream.getVideoTracks().length > 0) {
			streams.push({ id, publisherId: id, stream: entry.stream });
		}
	}
	onStreams(streams);
}

export function clearViewerState(
	session: ViewerSession,
	onStreams: (streams: RoomStream[]) => void,
	onPeople: (count: number) => void,
	onMembers: (members: Member[]) => void,
	onStreamingMembers: (viewerIDs: string[]) => void,
	onStreamOwners: (owners: StreamOwner[]) => void,
) {
	for (const entry of session.streams.values()) {
		for (const track of entry.stream.getTracks()) track.stop();
	}
	session.streams.clear();
	onStreams([]);
	onPeople(0);
	onMembers([]);
	onStreamingMembers([]);
	onStreamOwners([]);
}
