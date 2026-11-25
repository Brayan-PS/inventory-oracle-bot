import { createFileRoute } from "@tanstack/react-router";
import { handleSupervisor } from "../server/supervisor-http.server";

export const Route = createFileRoute("/api/supervisor")({
  server: { handlers: { POST: ({ request }) => handleSupervisor(request) } },
});
