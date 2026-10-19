import type { FormEvent } from "react";
import type { Member } from "@/lib/room";

export type Tile = {
	id: string;
	name: string;
	stream: MediaStream;
	local?: boolean;
	ownerId?: string;
};
export type StageLayout = "grid" | "focus";
export type StagePan = { x: number; y: number };

export type JoinPanelProps = {
	room: string;
	name: string;
	joining: boolean;
	status: string;
	onRoomChange: (value: string) => void;
	onNameChange: (value: string) => void;
	onSubmit: (event: FormEvent) => void;
};

export type RoomViewProps = {
	room: string;
	selfName: string;
	status: string;
	ping?: number;
	members: Member[];
	streamingMembers: string[];
	tiles: Tile[];
	hiddenTiles: Tile[];
	onHideTile: (id: string) => void;
	onShowTile: (id: string) => void;
	featured?: Tile;
	pinned?: string;
	sharing: boolean;
	startingShare: boolean;
	soundsEnabled: boolean;
	stageLayout: StageLayout;
	layoutManual: boolean;
	stageZoom: number;
	onPin: (id: string) => void;
	linkCopied: boolean;
	desktopLink?: string;
	onCopyLink: () => void;
	onShare: () => void;
	onStopShare: () => void;
	onLeave: () => void;
	onToggleSounds: () => void;
	onStageLayout: (layout: StageLayout) => void;
	onStageZoom: (zoom: number) => void;
};

export type ParticipantCardProps = {
	member: Member;
	self: boolean;
	compact?: boolean;
	fill?: boolean;
	loading?: boolean;
	onWatch?: () => void;
};

export type VideoTileProps = {
	tile: Tile;
	large?: boolean;
	pinned: boolean;
	onPin: (id: string) => void;
	onHide?: (id: string) => void;
};
