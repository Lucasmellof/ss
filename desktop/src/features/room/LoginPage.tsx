import { useEffect } from "react";
import { useNavigate } from "@tanstack/react-router";
import { JoinPanel } from "./JoinPanel";
import { useRoomApp } from "./RoomSessionProvider";

export function LoginPage() {
	const navigate = useNavigate();
	const { session } = useRoomApp();

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
			</main>
		</div>
	);
}
