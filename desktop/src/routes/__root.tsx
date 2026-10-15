/* oxlint-disable import/no-unassigned-import */
import { HeadContent, Outlet, Scripts, createRootRoute } from "@tanstack/react-router";
import "../styles.css";
import { RoomSessionProvider } from "@/features/room/RoomSessionProvider";
import { UpdateBanner } from "@/features/update/UpdateBanner";

export const Route = createRootRoute({
	head: () => ({
		links: [
			{ rel: "icon", href: "/favicon.ico", sizes: "any" },
			{ rel: "icon", type: "image/png", href: "/icon.png" },
		],
	}),
	component: () => (
		<html lang="pt-BR" className="dark [color-scheme:dark]">
			<head>
				<HeadContent />
			</head>
			<body className="min-h-screen min-w-[320px] bg-app-bg font-sans text-app-text antialiased">
				<RoomSessionProvider>
					<Outlet />
				</RoomSessionProvider>
				<UpdateBanner />
				<Scripts />
			</body>
		</html>
	),
});
