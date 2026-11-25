import { createFileRoute } from "@tanstack/react-router";
import { handleLogin } from "../server/auth.server";

export const Route = createFileRoute("/api/auth/login")({
  server: { handlers: { POST: ({ request }) => handleLogin(request) } },
});
