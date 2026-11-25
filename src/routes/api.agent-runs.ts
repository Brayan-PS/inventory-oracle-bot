import { createFileRoute } from "@tanstack/react-router";
import { handleAgentRuns } from "../server/supervisor-http.server";

export const Route = createFileRoute("/api/agent-runs")({
  server: { handlers: { GET: ({ request }) => handleAgentRuns(request) } },
});
