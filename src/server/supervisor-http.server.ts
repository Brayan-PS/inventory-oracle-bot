import { z } from "zod";
import { deriveProduct } from "../lib/inventory";
import { exigirUsuario } from "./auth.server";
import {
  insertAgentRun,
  readAgentRuns,
  readProducts,
  readTokenUsage,
  usoHoy,
} from "./database.server";
import { envNum, RateLimiter } from "./limits.server";
import { sameOrigin } from "./origin.server";
import { configFromEnv, runSupervisorLLM } from "./supervisor-llm.server";

const bodySchema = z.object({
  consulta: z.string().trim().min(1).max(500),
  contextoSku: z.string().max(100).optional(),
  historial: z
    .array(
      z.object({
        pregunta: z.string().max(500),
        respuesta: z.string().max(1500),
      }),
    )
    .max(4)
    .optional(),
});

// Límites de uso (control de costo). Los diarios se cuentan en PostgreSQL.
const POR_MINUTO = envNum("LLM_RATE_PER_MIN", 10);
const POR_DIA = envNum("LLM_DAILY_CAP", 300);
const POR_DIA_USUARIO = envNum("LLM_DAILY_CAP_PER_USER", 100);
const TOKENS_DIA = envNum("LLM_DAILY_TOKEN_CAP", 1_000_000);
const porMinuto = new RateLimiter(POR_MINUTO, 60_000);
// Límite duro de solicitudes por usuario (protege el servidor aunque se responda con reglas).
const duro = new RateLimiter(envNum("SUPERVISOR_MAX_PER_MIN", 30), 60_000);

const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

/** Motivo para responder con reglas en vez de Gemini (control de costo), o undefined. */
async function limiteAlcanzado(usuario: string): Promise<string | undefined> {
  if (!porMinuto.permitir(usuario)) return `Límite de ${POR_MINUTO} consultas por minuto alcanzado`;
  const uso = await usoHoy(usuario);
  if (uso.tokens >= TOKENS_DIA)
    return `Tope diario de ${TOKENS_DIA.toLocaleString("es-PE")} tokens alcanzado (control de costo)`;
  if (uso.consultasLLM >= POR_DIA) return `Tope diario de ${POR_DIA} consultas al LLM alcanzado`;
  if (uso.consultasLLMUsuario >= POR_DIA_USUARIO)
    return `Tope diario de ${POR_DIA_USUARIO} consultas al LLM por usuario alcanzado`;
  return undefined;
}

export async function handleSupervisor(request: Request): Promise<Response> {
  if (!sameOrigin(request)) return json({ error: "Origen de solicitud no permitido." }, 403);
  const usuario = await exigirUsuario(request);
  if (usuario instanceof Response) return usuario;
  if (!duro.permitir(usuario.usuario))
    return json({ error: "Demasiadas consultas. Espera un minuto." }, 429);
  if (!request.headers.get("content-type")?.startsWith("application/json")) {
    return json({ error: "Se requiere JSON." }, 415);
  }
  let body: z.infer<typeof bodySchema>;
  try {
    const parsed = bodySchema.safeParse(await request.json());
    if (!parsed.success) return json({ error: "Consulta inválida (1 a 500 caracteres)." }, 400);
    body = parsed.data;
  } catch {
    return json({ error: "La solicitud no contiene JSON válido." }, 400);
  }

  let products;
  try {
    products = (await readProducts()).map(deriveProduct);
  } catch {
    return json({ error: "No se pudo leer el catálogo en PostgreSQL." }, 503);
  }

  const limite = await limiteAlcanzado(usuario.usuario).catch(
    () => "No se pudo verificar el uso diario (control de costo)",
  );
  const reply = await runSupervisorLLM(body.consulta, products, {
    config: configFromEnv(),
    contextoSku: body.contextoSku,
    historial: body.historial,
    forzarReglas: limite,
  });

  const runId = crypto.randomUUID();
  try {
    await insertAgentRun(runId, usuario.usuario, body.consulta, reply);
    reply.runId = runId;
  } catch {
    console.error("No se pudo registrar la traza en agent_runs.");
  }
  return json(reply);
}

/** Trazas: el admin ve todas; los demás, solo las suyas. */
export async function handleAgentRuns(request: Request): Promise<Response> {
  const usuario = await exigirUsuario(request);
  if (usuario instanceof Response) return usuario;
  const limit = Number(new URL(request.url).searchParams.get("limit") ?? 50);
  try {
    return json(
      await readAgentRuns(
        Number.isFinite(limit) ? limit : 50,
        usuario.rol === "admin" ? undefined : usuario.usuario,
      ),
    );
  } catch {
    return json({ error: "No se pudo leer el registro de agentes." }, 503);
  }
}

export async function handleTokenUsage(request: Request): Promise<Response> {
  const usuario = await exigirUsuario(request);
  if (usuario instanceof Response) return usuario;
  try {
    const [uso, registros] = await Promise.all([
      readTokenUsage(),
      readAgentRuns(200, usuario.rol === "admin" ? undefined : usuario.usuario),
    ]);
    const cfg = configFromEnv();
    const usadosHoy = uso.hoy.entrada + uso.hoy.salida;
    const llm = Math.max(uso.hoy.consultasLLM, 1);
    const promedio = uso.hoy.consultasLLM ? usadosHoy / llm : 0;
    // Ritmo: tokens de hoy repartidos desde la primera consulta del día (mínimo 15 min).
    const horas =
      uso.hoy.primeraHora === null ? 0 : Math.max(0.25, uso.horaActual - uso.hoy.primeraHora);
    const ritmoHora = horas ? usadosHoy / horas : 0;
    const restantes = Math.max(0, TOKENS_DIA - usadosHoy);
    const horaTope = ritmoHora > 0 ? uso.horaActual + restantes / ritmoHora : null;
    return json({
      ...uso,
      alcance: usuario.rol === "admin" ? "todos" : "propio",
      topes: {
        tokensDia: TOKENS_DIA,
        consultasDia: POR_DIA,
        consultasDiaUsuario: POR_DIA_USUARIO,
        consultasMinuto: POR_MINUTO,
        maxTokensSalida: cfg.maxOutputTokens,
        maxLlamadasAgentes: cfg.maxToolCalls,
      },
      modelo: {
        principal: cfg.model,
        respaldo: cfg.fallbackModels,
        groq: cfg.groq.apiKey ? [cfg.groq.model, ...cfg.groq.fallbackModels] : [],
      },
      precios: { entradaPorMillon: cfg.priceInPerM, salidaPorMillon: cfg.priceOutPerM },
      proyeccion: {
        usadosHoy,
        restantes,
        porcentaje: TOKENS_DIA ? Math.min(100, (usadosHoy / TOKENS_DIA) * 100) : 0,
        promedioPorConsulta: Math.round(promedio),
        consultasRestantes: promedio ? Math.floor(restantes / promedio) : null,
        ritmoTokensHora: Math.round(ritmoHora),
        horaEstimadaTope: horaTope !== null && horaTope < 24 ? horaTope : null,
      },
      registros,
    });
  } catch {
    return json({ error: "No se pudo leer el uso de tokens." }, 503);
  }
}
