import pg from "pg";
import type { BaseProduct } from "../lib/inventory";
import type { Decision } from "../lib/decisions";
import type { SupervisorReply } from "../lib/supervisor";

// En la nube (Render) se usa DATABASE_URL; en Docker Compose, las variables PG*.
const comunes = { max: 5, connectionTimeoutMillis: 5000, idleTimeoutMillis: 30000 };
const pool = new pg.Pool(
  process.env["DATABASE_URL"]
    ? {
        ...comunes,
        connectionString: process.env["DATABASE_URL"],
        ...(process.env["DATABASE_SSL"] === "true" ? { ssl: { rejectUnauthorized: false } } : {}),
      }
    : {
        ...comunes,
        host: process.env["PGHOST"] ?? "127.0.0.1",
        port: Number(process.env["PGPORT"] ?? "5433"),
        database: process.env["PGDATABASE"] ?? process.env["POSTGRES_DB"],
        user: process.env["PGUSER"] ?? process.env["POSTGRES_USER"],
        password: process.env["PGPASSWORD"] ?? process.env["POSTGRES_PASSWORD"],
      },
);
pool.on("error", () => console.error("Conexión PostgreSQL interrumpida."));
const productColumns = `sku, nombre, categoria, proveedor,
  precio_compra::float8 AS "precioCompra", precio_venta::float8 AS "precioVenta",
  stock, stock_min AS "stockMin", stock_max AS "stockMax", ventas7, ventas30,
  lead_time AS "leadTime", tendencia::float8 AS tendencia, estacionalidad`;
const decisionColumns = `id, sku, nombre, cantidad_sugerida AS "cantidadSugerida",
  cantidad_final AS "cantidadFinal", costo::float8 AS costo, estado, motivo,
  to_char(fecha AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS fecha, usuario`;

export async function readProducts(): Promise<BaseProduct[]> {
  const { rows } = await pool.query<BaseProduct>(
    `SELECT ${productColumns} FROM products ORDER BY display_order, sku`,
  );
  if (!rows.length) throw new Error("El catálogo está vacío. Ejecuta la carga inicial.");
  return rows;
}
export async function readProduct(sku: string): Promise<BaseProduct | undefined> {
  const { rows } = await pool.query<BaseProduct>(
    `SELECT ${productColumns} FROM products WHERE sku = $1`,
    [sku],
  );
  return rows[0];
}
export async function readDecisions(): Promise<Decision[]> {
  return (
    await pool.query<Decision>(
      `SELECT ${decisionColumns} FROM decisions ORDER BY fecha DESC, created_order DESC`,
    )
  ).rows;
}
export async function insertDecisions(decisions: Decision[]): Promise<number> {
  const client = await pool.connect();
  let inserted = 0;
  try {
    await client.query("BEGIN");
    for (const d of [...decisions].reverse()) {
      const result = await client.query(
        `INSERT INTO decisions
        (id,sku,nombre,cantidad_sugerida,cantidad_final,costo,estado,motivo,fecha,usuario)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (id) DO NOTHING`,
        [
          d.id,
          d.sku,
          d.nombre,
          d.cantidadSugerida,
          d.cantidadFinal,
          d.costo,
          d.estado,
          d.motivo,
          d.fecha,
          d.usuario,
        ],
      );
      inserted += result.rowCount ?? 0;
    }
    await client.query("COMMIT");
    return inserted;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
export async function checkDatabase() {
  await pool.query("SELECT sku FROM products LIMIT 1");
  await pool.query("SELECT id FROM decisions LIMIT 1");
  await pool.query("SELECT id FROM agent_runs LIMIT 1");
}

export interface AgentRun {
  id: string;
  fecha: string;
  consulta: string;
  modo: "llm" | "reglas";
  modelo: string;
  motivo: string | null;
  intencion: string;
  respuesta: string;
  llamadas: SupervisorReply["traza"]["llamadas"];
  verificacion: SupervisorReply["traza"]["verificacion"] | null;
  tokensEntrada: number;
  tokensSalida: number;
  costoUsd: number;
  duracionMs: number;
}

export async function insertAgentRun(id: string, consulta: string, r: SupervisorReply) {
  await pool.query(
    `INSERT INTO agent_runs
    (id, consulta, modo, modelo, motivo, intencion, respuesta, llamadas, verificacion,
     tokens_entrada, tokens_salida, costo_usd, duracion_ms)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10,$11,$12,$13)`,
    [
      id,
      consulta,
      r.traza.modo,
      r.traza.modelo,
      r.traza.motivo ?? null,
      r.intencion,
      [r.titulo, r.resumen, ...r.bullets.map((b) => `- ${b}`)].join("\n"),
      JSON.stringify(r.traza.llamadas),
      r.traza.verificacion ? JSON.stringify(r.traza.verificacion) : null,
      r.traza.tokensEntrada,
      r.traza.tokensSalida,
      r.traza.costoUsd,
      r.traza.ms,
    ],
  );
}

export async function readAgentRuns(limit = 50): Promise<AgentRun[]> {
  const { rows } = await pool.query<AgentRun>(
    `SELECT id, to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS fecha,
      consulta, modo, modelo, motivo, intencion, respuesta, llamadas, verificacion,
      tokens_entrada AS "tokensEntrada", tokens_salida AS "tokensSalida",
      costo_usd::float8 AS "costoUsd", duracion_ms AS "duracionMs"
    FROM agent_runs ORDER BY created_at DESC LIMIT $1`,
    [Math.min(200, Math.max(1, limit))],
  );
  return rows;
}

// ---------- Uso de tokens (pantalla "Uso de tokens" y tope diario) ----------
const TZ = process.env["APP_TZ"] || "America/Lima";
const HOY = `(created_at AT TIME ZONE $1)::date = (now() AT TIME ZONE $1)::date`;

export async function tokensHoy(): Promise<number> {
  const { rows } = await pool.query<{ total: number }>(
    `SELECT COALESCE(SUM(tokens_entrada + tokens_salida), 0)::float8 AS total
     FROM agent_runs WHERE ${HOY}`,
    [TZ],
  );
  return Number(rows[0]?.total ?? 0);
}

export interface TokenUsageDb {
  zonaHoraria: string;
  horaActual: number;
  hoy: {
    entrada: number;
    salida: number;
    consultas: number;
    consultasLLM: number;
    costoUsd: number;
    primeraHora: number | null;
  };
  porHora: { hora: number; entrada: number; salida: number; consultas: number }[];
  porDia: { dia: string; entrada: number; salida: number; consultas: number }[];
  porModelo: { modelo: string; tokens: number; consultas: number }[];
}

export async function readTokenUsage(): Promise<TokenUsageDb> {
  const [hoy, porHora, porDia, porModelo, ahora] = await Promise.all([
    pool.query(
      `SELECT COALESCE(SUM(tokens_entrada), 0)::float8 AS entrada,
              COALESCE(SUM(tokens_salida), 0)::float8 AS salida,
              COUNT(*)::int AS consultas,
              COUNT(*) FILTER (WHERE modo = 'llm')::int AS "consultasLLM",
              COALESCE(SUM(costo_usd), 0)::float8 AS "costoUsd",
              MIN(EXTRACT(HOUR FROM created_at AT TIME ZONE $1)
                  + EXTRACT(MINUTE FROM created_at AT TIME ZONE $1) / 60)::float8 AS "primeraHora"
       FROM agent_runs WHERE ${HOY}`,
      [TZ],
    ),
    pool.query(
      `SELECT EXTRACT(HOUR FROM created_at AT TIME ZONE $1)::int AS hora,
              SUM(tokens_entrada)::float8 AS entrada, SUM(tokens_salida)::float8 AS salida,
              COUNT(*)::int AS consultas
       FROM agent_runs WHERE ${HOY} GROUP BY 1 ORDER BY 1`,
      [TZ],
    ),
    pool.query(
      `SELECT to_char((created_at AT TIME ZONE $1)::date, 'YYYY-MM-DD') AS dia,
              SUM(tokens_entrada)::float8 AS entrada, SUM(tokens_salida)::float8 AS salida,
              COUNT(*)::int AS consultas
       FROM agent_runs
       WHERE (created_at AT TIME ZONE $1)::date > (now() AT TIME ZONE $1)::date - 7
       GROUP BY 1 ORDER BY 1`,
      [TZ],
    ),
    pool.query(
      `SELECT split_part(modelo, ' ', 1) AS modelo,
              SUM(tokens_entrada + tokens_salida)::float8 AS tokens, COUNT(*)::int AS consultas
       FROM agent_runs WHERE ${HOY} AND modo = 'llm' GROUP BY 1 ORDER BY 2 DESC`,
      [TZ],
    ),
    pool.query(
      `SELECT (EXTRACT(HOUR FROM now() AT TIME ZONE $1)
               + EXTRACT(MINUTE FROM now() AT TIME ZONE $1) / 60)::float8 AS hora`,
      [TZ],
    ),
  ]);
  return {
    zonaHoraria: TZ,
    horaActual: Number(ahora.rows[0]?.hora ?? 0),
    hoy: hoy.rows[0],
    porHora: porHora.rows,
    porDia: porDia.rows,
    porModelo: porModelo.rows,
  };
}
