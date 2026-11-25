import { createFileRoute } from "@tanstack/react-router";
import { handleDecisions } from "../server/decisions-http.server";

export const Route = createFileRoute("/api/decisions")({
  server: {
    handlers: {
      GET: ({ request }) => handleDecisions(request),
      POST: ({ request }) => handleDecisions(request),
    },
  },
});
