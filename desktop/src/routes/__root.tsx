/* oxlint-disable import/no-unassigned-import */
import { HeadContent, Outlet, Scripts, createRootRoute } from "@tanstack/react-router";
import "../styles.css";
import { RoomSessionProvider } from "@/features/room/RoomSessionProvider";

export const Route = createRootRoute({
	component: () => (
		<html lang="pt-BR" className="dark [color-scheme:dark]">
			<head>
				<HeadContent />
			</head>
			<body className="min-h-screen min-w-[320px] bg-app-bg font-sans text-app-text antialiased">
				<RoomSessionProvider>
					<Outlet />
				</RoomSessionProvider>
				<Scripts />
			</body>
		</html>
	),
});
