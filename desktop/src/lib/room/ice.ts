export const waitForICE = async (pc: RTCPeerConnection) => {
	if (pc.iceGatheringState === "complete") return;
	await new Promise<void>((resolve) => {
		let finished = false;
		const finish = () => {
			if (finished) return;
			finished = true;
			clearTimeout(timer);
			pc.removeEventListener("icegatheringstatechange", check);
			// The guard above makes the timeout and event race safe.
			// oxlint-disable-next-line promise/no-multiple-resolved
			resolve();
		};
		const check = () => {
			if (pc.iceGatheringState === "complete") finish();
		};
		const timer = window.setTimeout(finish, 3_000);
		pc.addEventListener("icegatheringstatechange", check);
	});
};

export const wsURL = (server: string) => {
	const url = new URL("/ws", server);
	url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
	return url;
};

export const peerConfig: RTCConfiguration = {
	iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
};
