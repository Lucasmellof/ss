export type FrameRate = 30 | 60;
export type SourceType = CaptureSource["kind"];
export type Resolution = "source" | "720p" | "1080p" | "1440p";
export type AudioMode = "none" | "system";

export const resolutions: Record<Resolution, { label: string; width?: number; height?: number }> = {
	source: { label: "Original" },
	"720p": { label: "720p", width: 1280, height: 720 },
	"1080p": { label: "1080p", width: 1920, height: 1080 },
	"1440p": { label: "1440p", width: 2560, height: 1440 },
};

const resolutionBitrates: Record<Resolution, number> = {
	source: 12_000_000,
	"720p": 6_000_000,
	"1080p": 10_000_000,
	"1440p": 16_000_000,
};

export const videoBitrate = (resolution: Resolution, frameRate: FrameRate) =>
	Math.min(resolutionBitrates[resolution] * (frameRate === 60 ? 1.25 : 1), 20_000_000);

export type CameraResolution = "480p" | "720p" | "1080p";

export const cameraResolutions: Record<CameraResolution, { label: string; width: number; height: number }> = {
	"480p": { label: "480p", width: 854, height: 480 },
	"720p": { label: "720p", width: 1280, height: 720 },
	"1080p": { label: "1080p", width: 1920, height: 1080 },
};

// Camera bitrates stay low on purpose: smaller frames leave the encoder and the network faster.
const cameraBitrates: Record<CameraResolution, number> = {
	"480p": 1_500_000,
	"720p": 3_000_000,
	"1080p": 5_000_000,
};

export const cameraBitrate = (resolution: CameraResolution, frameRate: FrameRate) =>
	cameraBitrates[resolution] * (frameRate === 60 ? 1.25 : 1);

export type CameraPickerProps = {
	devices: MediaDeviceInfo[];
	deviceID: string;
	resolution: CameraResolution;
	frameRate: FrameRate;
	preview: MediaStream | null;
	live: boolean;
	loading: boolean;
	starting: boolean;
	error: string;
	onDevice: (deviceID: string) => void;
	onResolution: (value: CameraResolution) => void;
	onFrameRate: (value: FrameRate) => void;
	onClose: () => void;
	onStart: () => void;
};

export type SourcePickerProps = {
	sources: CaptureSource[];
	selectedID: string;
	sourceType: SourceType;
	frameRate: FrameRate;
	resolution: Resolution;
	audioMode: AudioMode;
	includeDiscordAudio: boolean;
	nativePicker: boolean;
	live: boolean;
	loading: boolean;
	starting: boolean;
	onType: (type: SourceType) => void;
	onSelect: (source: CaptureSource) => void;
	onFrameRate: (value: FrameRate) => void;
	onResolution: (value: Resolution) => void;
	onAudioMode: (value: AudioMode) => void;
	onIncludeDiscordAudio: (value: boolean) => void;
	onRefresh: () => void;
	onClose: () => void;
	onStart: () => void;
};
