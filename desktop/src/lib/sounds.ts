export type RoomSound = "self-joined" | "self-left" | "member-joined" | "member-left" | "share-started" | "share-stopped";

type Tone = {
	freq: number;
	start: number;
	duration: number;
	gain?: number;
	type?: OscillatorType;
	slideTo?: number;
};

const MASTER_GAIN = 0.32;
const ATTACK = 0.012;

const tones: Record<RoomSound, Tone[]> = {
	// Acorde subindo em três notas: você entrou na sala.
	"self-joined": [
		{ freq: 440, start: 0, duration: 0.14 },
		{ freq: 659.25, start: 0.08, duration: 0.14 },
		{ freq: 880, start: 0.16, duration: 0.14 },
		{ freq: 1318.51, start: 0.24, duration: 0.4, gain: 0.9 },
	],
	// Os mesmos tons descendo e deslizando: você saiu ou a conexão caiu.
	"self-left": [
		{ freq: 880, start: 0, duration: 0.14, gain: 0.9 },
		{ freq: 659.25, start: 0.08, duration: 0.14, gain: 0.9 },
		{ freq: 493.88, start: 0.16, duration: 0.14, gain: 0.9 },
		{ freq: 329.63, start: 0.24, duration: 0.4, gain: 0.85, slideTo: 261.63 },
	],
	// Sino curto subindo: alguém entrou na sala.
	"member-joined": [
		{ freq: 587.33, start: 0, duration: 0.16 },
		{ freq: 880, start: 0.09, duration: 0.26 },
	],
	// O mesmo sino, descendo e mais suave: alguém saiu.
	"member-left": [
		{ freq: 739.99, start: 0, duration: 0.16, gain: 0.85 },
		{ freq: 493.88, start: 0.09, duration: 0.3, gain: 0.85 },
	],
	// Arpejo brilhante em triângulo: uma tela entrou no ar.
	"share-started": [
		{ freq: 523.25, start: 0, duration: 0.13, type: "triangle" },
		{ freq: 659.25, start: 0.07, duration: 0.13, type: "triangle" },
		{ freq: 987.77, start: 0.14, duration: 0.32, type: "triangle" },
	],
	// Mesmo timbre caindo: a tela foi fechada.
	"share-stopped": [
		{ freq: 659.25, start: 0, duration: 0.13, type: "triangle", gain: 0.9 },
		{ freq: 415.3, start: 0.08, duration: 0.34, type: "triangle", gain: 0.9, slideTo: 349.23 },
	],
};

let context: AudioContext | undefined;

const audioContext = () => {
	if (typeof window === "undefined") return undefined;
	const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
	if (!Ctor) return undefined;
	if (!context || context.state === "closed") context = new Ctor();
	if (context.state === "suspended") void context.resume().catch(() => undefined);
	return context;
};

export function playRoomSound(sound: RoomSound, volume = 1) {
	const ctx = audioContext();
	if (!ctx || volume <= 0) return;

	const master = ctx.createGain();
	master.gain.value = MASTER_GAIN * volume;
	const filter = ctx.createBiquadFilter();
	filter.type = "lowpass";
	filter.frequency.value = 4800;
	master.connect(filter);
	filter.connect(ctx.destination);

	const base = ctx.currentTime + 0.02;
	let last = base;
	for (const tone of tones[sound]) {
		const oscillator = ctx.createOscillator();
		const envelope = ctx.createGain();
		const startAt = base + tone.start;
		const endAt = startAt + tone.duration;
		const peak = tone.gain ?? 1;

		oscillator.type = tone.type ?? "sine";
		oscillator.frequency.setValueAtTime(tone.freq, startAt);
		if (tone.slideTo) oscillator.frequency.exponentialRampToValueAtTime(tone.slideTo, endAt);

		envelope.gain.setValueAtTime(0.0001, startAt);
		envelope.gain.exponentialRampToValueAtTime(peak, startAt + ATTACK);
		envelope.gain.exponentialRampToValueAtTime(0.0001, endAt);

		oscillator.connect(envelope);
		envelope.connect(master);
		oscillator.start(startAt);
		oscillator.stop(endAt + 0.02);
		last = Math.max(last, endAt);
	}

	window.setTimeout(
		() => {
			master.disconnect();
			filter.disconnect();
		},
		Math.ceil((last - ctx.currentTime + 0.2) * 1000),
	);
}
