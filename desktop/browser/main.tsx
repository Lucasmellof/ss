import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createRootRoute, createRoute, createRouter, Outlet, RouterProvider } from "@tanstack/react-router";
import { RoomSessionProvider } from "@/features/room/RoomSessionProvider";
import { LoginPage } from "@/features/room/LoginPage";
import { RoomPage } from "@/features/room/RoomPage";
import "@/styles.css";

const root = createRootRoute({ component: () => <RoomSessionProvider><Outlet /></RoomSessionProvider> });
const router = createRouter({ routeTree: root.addChildren([
  createRoute({ getParentRoute: () => root, path: "/", component: LoginPage }),
  createRoute({ getParentRoute: () => root, path: "/room", component: RoomPage }),
]) });
createRoot(document.getElementById("root")!).render(<StrictMode><RouterProvider router={router} /></StrictMode>);
