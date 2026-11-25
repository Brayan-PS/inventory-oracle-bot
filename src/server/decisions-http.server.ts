import { createDecisionSchema, importDecisionsSchema } from "../lib/decisions";
import { exigirUsuario } from "./auth.server";
import { insertDecisions, readDecisions } from "./database.server";
import { envNum, RateLimiter } from "./limits.server";
import { sameOrigin } from "./origin.server";

const escrituras = new RateLimiter(envNum("DECISIONS_RATE_PER_MIN", 30), 60_000);
const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function handleDecisions(request: Request): Promise<Response> {
  if (request.method === "GET") {
    const usuario = await exigirUsuario(request);
    if (usuario instanceof Response) return usuario;
    try {
      return json(await readDecisions());
    } catch {
      return json({ error: "No se pudo leer el historial." }, 503);
    }
  }
  if (!sameOrigin(request)) return json({ error: "Origen de solicitud no permitido." }, 403);
  // Solo quien compra (o el admin) registra decisiones; el lector solo consulta.
  const usuario = await exigirUsuario(request, ["admin", "comprador"]);
  if (usuario instanceof Response) return usuario;
  if (!escrituras.permitir(usuario.usuario))
    return json({ error: "Demasiadas escrituras seguidas. Espera un minuto." }, 429);
  if (!request.headers.get("content-type")?.startsWith("application/json")) {
    return json({ error: "Se requiere JSON." }, 415);
  }
  try {
    const body: unknown = await request.json();
    const importing = new URL(request.url).pathname.endsWith("/import");
    if (importing) {
      const parsed = importDecisionsSchema.safeParse(body);
      if (!parsed.success)
        return json(
          { error: "Datos de decisión inválidos. Revisa cantidades, fechas y estados." },
          400,
        );
      // Se conservan la fecha y el usuario originales del historial anterior, pero el
      // registro queda marcado como importado y con quién lo importó y cuándo (lo fija el servidor).
      const inserted = await insertDecisions(parsed.data, usuario.usuario, "importado");
      return json({ decisions: await readDecisions(), inserted });
    }
    const parsed = createDecisionSchema.safeParse(body);
    if (!parsed.success)
      return json(
        { error: "Datos de decisión inválidos. Revisa cantidades, fechas y estados." },
        400,
      );
    // Fecha y usuario los pone el servidor con la sesión: el cliente no puede falsificarlos.
    const decision = {
      ...parsed.data,
      fecha: new Date().toISOString(),
      usuario: `${usuario.nombre} (${usuario.usuario})`,
    };
    const inserted = await insertDecisions([decision], usuario.usuario, "app");
    return json({ decisions: await readDecisions(), inserted });
  } catch (error) {
    if (error instanceof SyntaxError)
      return json({ error: "El archivo o la solicitud no contiene JSON válido." }, 400);
    if (error && typeof error === "object" && "code" in error && error.code === "23503") {
      return json(
        { error: "Hay decisiones con un SKU que no existe en el catálogo. No se importó el lote." },
        400,
      );
    }
    return json({ error: "No se pudo guardar. Comprueba la conexión y vuelve a intentarlo." }, 503);
  }
}
