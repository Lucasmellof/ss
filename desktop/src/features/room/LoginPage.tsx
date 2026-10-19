import { useEffect } from "react";
import { useNavigate } from "@tanstack/react-router";
import { ExternalLink } from "lucide-react";
import { desktopRoomLink } from "@/lib/room-link";
import { JoinPanel } from "./JoinPanel";
import { useRoomApp } from "./RoomSessionProvider";

export function LoginPage() {
	const navigate = useNavigate();
	const { session } = useRoomApp();
	const desktopLink = desktopRoomLink(session.room.trim());

	useEffect(() => {
		if (session.joined) void navigate({ to: "/room", replace: true });
	}, [session.joined, navigate]);

	return (
		<div className="flex items-center justify-center mx-auto min-h-screen w-full bg-app-bg  text-app-text">
			<main>
				<JoinPanel
					room={session.room}
					name={session.name}
					joining={session.joining}
					status={session.status}
					onRoomChange={session.setRoom}
					onNameChange={session.setName}
					onSubmit={session.join}
				/>
				{desktopLink && (
					<div className="mx-auto mt-4 flex w-full max-w-[620px] justify-center">
						<a
							className="inline-flex items-center gap-1.5 rounded-[9px] border border-app-line px-[13px] py-2.5 text-xs font-extrabold text-app-muted transition hover:border-app-accent/40 hover:text-app-accent"
							href={desktopLink}
						>
							<ExternalLink className="size-3.5" /> Abrir no app desktop
						</a>
					</div>
				)}
			</main>
		</div>
	);
}
