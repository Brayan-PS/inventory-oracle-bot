import { createFileRoute } from "@tanstack/react-router";
import { handleDecisions } from "../server/decisions-http.server";

export const Route = createFileRoute("/api/decisions/import")({
  server: { handlers: { POST: ({ request }) => handleDecisions(request) } },
});
