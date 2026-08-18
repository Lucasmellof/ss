import { createFileRoute } from "@tanstack/react-router";
import { RoomPage } from "@/features/room/RoomPage";

export const Route = createFileRoute("/room")({ component: RoomPage });
