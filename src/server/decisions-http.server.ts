import { createDecisionSchema, importDecisionsSchema } from "../lib/decisions";
import { insertDecisions, readDecisions } from "./database.server";

export async function handleDecisions(request: Request): Promise<Response> {
  if (request.method === "GET") {
    try {
      return Response.json(await readDecisions(), { headers: { "Cache-Control": "no-store" } });
    } catch {
      return Response.json({ error: "No se pudo leer el historial." }, { status: 503 });
    }
  }
  if (request.headers.get("origin") !== new URL(request.url).origin) {
    return Response.json({ error: "Origen de solicitud no permitido." }, { status: 403 });
  }
  if (!request.headers.get("content-type")?.startsWith("application/json")) {
    return Response.json({ error: "Se requiere JSON." }, { status: 415 });
  }
  try {
    const body: unknown = await request.json();
    const importing = new URL(request.url).pathname.endsWith("/import");
    const parsed = importing
      ? importDecisionsSchema.safeParse(body)
      : createDecisionSchema.safeParse(body);
    if (!parsed.success)
      return Response.json(
        { error: "Datos de decisión inválidos. Revisa cantidades, fechas y estados." },
        { status: 400 },
      );
    const decisions = Array.isArray(parsed.data)
      ? parsed.data
      : [
          {
            ...parsed.data,
            fecha: new Date().toISOString(),
            usuario: "M. Gutiérrez · Encargado de compras",
          },
        ];
    const inserted = await insertDecisions(decisions);
    return Response.json({ decisions: await readDecisions(), inserted });
  } catch (error) {
    if (error instanceof SyntaxError)
      return Response.json(
        { error: "El archivo o la solicitud no contiene JSON válido." },
        { status: 400 },
      );
    if (error && typeof error === "object" && "code" in error && error.code === "23503") {
      return Response.json(
        { error: "Hay decisiones con un SKU que no existe en el catálogo. No se importó el lote." },
        { status: 400 },
      );
    }
    return Response.json(
      { error: "No se pudo guardar. Comprueba la conexión y vuelve a intentarlo." },
      { status: 503 },
    );
  }
}
