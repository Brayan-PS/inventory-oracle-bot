import { createFileRoute } from "@tanstack/react-router";
import { handleMe } from "../server/auth.server";

export const Route = createFileRoute("/api/auth/me")({
  server: { handlers: { GET: ({ request }) => handleMe(request) } },
});
