import { cn } from "@/lib/utils";
import type { JoinPanelProps } from "./types";

const fieldClass =
	"w-full rounded-[9px] border border-app-line bg-[#0d1014] px-[13px] py-3 text-app-text outline-none transition focus:border-app-accent-strong focus:ring-[3px] focus:ring-app-accent-strong/15 placeholder:text-[#606c78]";
const buttonBase =
	"inline-flex min-h-[39px] items-center justify-center gap-2 rounded-[9px] border border-transparent px-[13px] text-xs font-extrabold transition duration-150 hover:-translate-y-px disabled:cursor-not-allowed disabled:opacity-55";

export function JoinPanel({ room, name, joining, status, onRoomChange, onNameChange, onSubmit }: JoinPanelProps) {
	return (
		<section className="mx-auto mt-[5vh] w-full max-w-[620px] rounded-[18px] border border-app-line-soft bg-app-panel p-5 shadow-app sm:mt-[9vh] sm:p-9">
			<div className="mb-7">
				<p className="mb-1.5 text-[10px] font-extrabold tracking-[.16em] text-app-accent uppercase">Um espaço para compartilhar</p>
				<h2 className="text-[clamp(27px,4vw,38px)] font-semibold tracking-[-.055em]">Entre em uma sala</h2>
				<p className="mt-3 max-w-[480px] text-sm leading-[1.6] text-app-muted">
					Conecte-se ao relay, escolha uma tela e compartilhe com quem estiver usando o mesmo código.
				</p>
			</div>
			<form className="grid gap-[17px]" onSubmit={onSubmit}>
				<div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
					<label className="grid gap-2 text-xs font-bold text-app-muted">
						Sala
						<input
							className={fieldClass}
							value={room}
							onChange={(event) => onRoomChange(event.target.value)}
							placeholder="sala-da-equipe"
							minLength={8}
							maxLength={64}
							autoComplete="off"
						/>
					</label>
					<label className="grid gap-2 text-xs font-bold text-app-muted">
						Seu nome
						<input
							className={fieldClass}
							value={name}
							onChange={(event) => onNameChange(event.target.value)}
							placeholder="Participante"
							maxLength={32}
							autoComplete="nickname"
						/>
					</label>
				</div>
				<button
					className={cn(buttonBase, "mt-0.5 w-full bg-app-accent text-[#07150f] hover:bg-[#b0efd5]")}
					type="submit"
					disabled={joining}
				>
					{joining ? "Conectando..." : "Entrar na sala"}
				</button>
				<p className="min-h-[18px] text-xs leading-6 text-app-muted" role="status">
					{status}
				</p>
			</form>
		</section>
	);
}
