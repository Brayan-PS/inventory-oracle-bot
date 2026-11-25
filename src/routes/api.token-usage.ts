import { createFileRoute } from "@tanstack/react-router";
import { handleTokenUsage } from "../server/supervisor-http.server";

export const Route = createFileRoute("/api/token-usage")({
  server: { handlers: { GET: ({ request }) => handleTokenUsage(request) } },
});
