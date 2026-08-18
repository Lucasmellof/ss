import { useState } from "react";
import type { StageLayout, Tile } from "./types";

export function useStageControls(tiles: Tile[]) {
	const [pinned, setPinned] = useState<string>();
	const [stageLayout, setStageLayout] = useState<StageLayout>("grid");
	const [stageLayoutManual, setStageLayoutManual] = useState(false);
	const [stageZoom, setStageZoom] = useState(1);

	const activePinned = pinned && tiles.some((tile) => tile.id === pinned) ? pinned : undefined;
	const featured = tiles.find((tile) => tile.id === activePinned) ?? tiles[0];

	const onStageLayout = (layout: StageLayout) => {
		setStageLayout(layout);
		setStageLayoutManual(true);
	};

	const onPin = (id: string) => {
		if (pinned === id) {
			setPinned(undefined);
			setStageLayout("grid");
			setStageLayoutManual(true);
		} else {
			setPinned(id);
			setStageLayout("focus");
			setStageLayoutManual(true);
		}
	};

	const reset = () => {
		setPinned(undefined);
		setStageLayout("grid");
		setStageLayoutManual(false);
	};

	return {
		pinned: activePinned,
		stageLayout,
		stageLayoutManual,
		stageZoom,
		featured,
		onStageLayout,
		onStageZoom: setStageZoom,
		onPin,
		reset,
	};
}
