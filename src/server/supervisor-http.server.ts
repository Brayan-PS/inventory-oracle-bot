import { z } from "zod";
import { deriveProduct } from "../lib/inventory";
import {
  insertAgentRun,
  readAgentRuns,
  readProducts,
  readTokenUsage,
  tokensHoy,
} from "./database.server";
import { sameOrigin } from "./origin.server";
import { configFromEnv, runSupervisorLLM } from "./supervisor-llm.server";

const bodySchema = z.object({
  consulta: z.string().trim().min(1).max(500),
  contextoSku: z.string().max(100).optional(),
});

// Límites de uso (control de costo): por IP y por día. Configurables por entorno.
const POR_MINUTO = Number(process.env["LLM_RATE_PER_MIN"] ?? 10);
const POR_DIA = Number(process.env["LLM_DAILY_CAP"] ?? 300);
// Tope diario de tokens (presupuesto propio del equipo). Al alcanzarlo, responde el motor de reglas.
const TOKENS_DIA = Number(process.env["LLM_DAILY_TOKEN_CAP"] ?? 1_000_000);
const ventanas = new Map<string, number[]>();
let dia = new Date().toISOString().slice(0, 10);
let usadasHoy = 0;

function limiteAlcanzado(ip: string): string | undefined {
  const hoy = new Date().toISOString().slice(0, 10);
  if (hoy !== dia) {
    dia = hoy;
    usadasHoy = 0;
  }
  if (usadasHoy >= POR_DIA) return `Tope diario de ${POR_DIA} consultas al LLM alcanzado`;
  const ahora = Date.now();
  const v = (ventanas.get(ip) ?? []).filter((t) => ahora - t < 60_000);
  if (v.length >= POR_MINUTO) return `Límite de ${POR_MINUTO} consultas por minuto alcanzado`;
  v.push(ahora);
  ventanas.set(ip, v);
  if (ventanas.size > 5000) ventanas.clear();
  usadasHoy++;
  return undefined;
}

export async function handleSupervisor(request: Request): Promise<Response> {
  if (!sameOrigin(request)) {
    return Response.json({ error: "Origen de solicitud no permitido." }, { status: 403 });
  }
  if (!request.headers.get("content-type")?.startsWith("application/json")) {
    return Response.json({ error: "Se requiere JSON." }, { status: 415 });
  }
  let body: z.infer<typeof bodySchema>;
  try {
    const parsed = bodySchema.safeParse(await request.json());
    if (!parsed.success)
      return Response.json({ error: "Consulta inválida (1 a 500 caracteres)." }, { status: 400 });
    body = parsed.data;
  } catch {
    return Response.json({ error: "La solicitud no contiene JSON válido." }, { status: 400 });
  }

  let products;
  try {
    products = (await readProducts()).map(deriveProduct);
  } catch {
    return Response.json({ error: "No se pudo leer el catálogo en PostgreSQL." }, { status: 503 });
  }

  const ip = (request.headers.get("x-forwarded-for") ?? "local").split(",")[0]!.trim();
  const usados = await tokensHoy().catch(() => 0);
  const topeTokens =
    usados >= TOKENS_DIA
      ? `Tope diario de ${TOKENS_DIA.toLocaleString("es-PE")} tokens alcanzado (control de costo)`
      : undefined;
  const reply = await runSupervisorLLM(body.consulta, products, {
    config: configFromEnv(),
    contextoSku: body.contextoSku,
    forzarReglas: topeTokens ?? limiteAlcanzado(ip),
  });

  const runId = crypto.randomUUID();
  try {
    await insertAgentRun(runId, body.consulta, reply);
    reply.runId = runId;
  } catch {
    console.error("No se pudo registrar la traza en agent_runs.");
  }
  return Response.json(reply, { headers: { "Cache-Control": "no-store" } });
}

export async function handleAgentRuns(request: Request): Promise<Response> {
  const limit = Number(new URL(request.url).searchParams.get("limit") ?? 50);
  try {
    return Response.json(await readAgentRuns(Number.isFinite(limit) ? limit : 50), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return Response.json({ error: "No se pudo leer el registro de agentes." }, { status: 503 });
  }
}

export async function handleTokenUsage(): Promise<Response> {
  try {
    const [uso, registros] = await Promise.all([readTokenUsage(), readAgentRuns(200)]);
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
    return Response.json(
      {
        ...uso,
        topes: {
          tokensDia: TOKENS_DIA,
          consultasDia: POR_DIA,
          consultasMinuto: POR_MINUTO,
          maxTokensSalida: cfg.maxOutputTokens,
          maxLlamadasAgentes: cfg.maxToolCalls,
        },
        modelo: { principal: cfg.model, respaldo: cfg.fallbackModels },
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
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return Response.json({ error: "No se pudo leer el uso de tokens." }, { status: 503 });
  }
}
