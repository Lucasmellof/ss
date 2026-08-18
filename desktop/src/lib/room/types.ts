export type RoomStream = { id: string; publisherId: string; stream: MediaStream };
export type Member = { id: string; name: string };
export type StreamOwner = { publisherId: string; viewerId: string; name: string };

export type Signal = {
	type: string;
	sdp?: string;
	message?: string;
	publisherId?: string;
	viewerId?: string;
	trackIds?: string[];
	pingId?: string;
	viewers?: number;
	members?: Member[];
	streamingMembers?: string[];
	streamOwners?: StreamOwner[];
};

export type RemoteEntry = {
	stream: MediaStream;
	tracks: Map<string, MediaStreamTrack>;
};

export type ViewerSession = {
	ws: WebSocket;
	pc: RTCPeerConnection;
	streams: Map<string, RemoteEntry>;
	intentional: boolean;
	joined: boolean;
	resolveReady: () => void;
	rejectReady: (reason?: unknown) => void;
};

export type PublisherSession = {
	ws: WebSocket;
	pc: RTCPeerConnection;
	intentional: boolean;
	joined: boolean;
	publisherId?: string;
	resolveStopped: () => void;
	resolveReady: () => void;
	rejectReady: (reason?: unknown) => void;
};
