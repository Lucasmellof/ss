import { createFileRoute } from "@tanstack/react-router";
import { LoginPage } from "@/features/room/LoginPage";

export const Route = createFileRoute("/")({ component: LoginPage });
