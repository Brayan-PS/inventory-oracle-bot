import { createFileRoute } from "@tanstack/react-router";
import { checkDatabase } from "../server/database.server";

export const Route = createFileRoute("/health/ready")({
  server: {
    handlers: {
      GET: async () => {
        try {
          await checkDatabase();
          return Response.json({ status: "ready" });
        } catch {
          return Response.json({ status: "unavailable" }, { status: 503 });
        }
      },
    },
  },
});
