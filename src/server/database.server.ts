import pg from "pg";
import type { BaseProduct } from "../lib/inventory";
import type { Decision } from "../lib/decisions";
import type { SupervisorReply } from "../lib/supervisor";

// En la nube (Render) se usa DATABASE_URL; en Docker Compose, las variables PG*.
// DATABASE_SSL=true activa TLS verificando el certificado; DATABASE_SSL_INSECURE=true
// lo desactiva solo si el proveedor usa un certificado autofirmado.
const comunes = { max: 5, connectionTimeoutMillis: 5000, idleTimeoutMillis: 30000 };
const ssl =
  process.env["DATABASE_SSL"] === "true"
    ? { ssl: { rejectUnauthorized: process.env["DATABASE_SSL_INSECURE"] !== "true" } }
    : {};
const pool = new pg.Pool(
  process.env["DATABASE_URL"]
    ? { ...comunes, connectionString: process.env["DATABASE_URL"], ...ssl }
    : {
        ...comunes,
        // `||` y no `??`: una variable vacía en .env no debe anular el valor siguiente.
        host: process.env["PGHOST"] || "127.0.0.1",
        port: Number(process.env["PGPORT"] || "5433"),
        database: process.env["PGDATABASE"] || process.env["POSTGRES_DB"],
        user: process.env["PGUSER"] || process.env["POSTGRES_USER"],
        password: process.env["PGPASSWORD"] || process.env["POSTGRES_PASSWORD"],
        ...ssl,
      },
);
pool.on("error", () => console.error("Conexión PostgreSQL interrumpida."));
const productColumns = `sku, nombre, categoria, proveedor,
  precio_compra::float8 AS "precioCompra", precio_venta::float8 AS "precioVenta",
  stock, stock_min AS "stockMin", stock_max AS "stockMax", ventas7, ventas30,
  lead_time AS "leadTime", tendencia::float8 AS tendencia, estacionalidad`;
const iso = (col: string) => `to_char(${col} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;
const decisionColumns = `id, sku, nombre, cantidad_sugerida AS "cantidadSugerida",
  cantidad_final AS "cantidadFinal", costo::float8 AS costo, estado, motivo,
  ${iso("fecha")} AS fecha, usuario, origen, registrado_por AS "registradoPor",
  ${iso("registrado_en")} AS "registradoEn"`;

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

export type DecisionRow = Decision & {
  origen: "app" | "importado";
  registradoPor: string | null;
  registradoEn: string;
};

export async function readDecisions(): Promise<DecisionRow[]> {
  return (
    await pool.query<DecisionRow>(
      `SELECT ${decisionColumns} FROM decisions ORDER BY fecha DESC, created_order DESC`,
    )
  ).rows;
}

/**
 * Inserta decisiones. `registradoPor` y `registrado_en` los fija el servidor con la
 * sesión; `origen` distingue lo registrado en la app de lo importado.
 */
export async function insertDecisions(
  decisions: Decision[],
  registradoPor: string,
  origen: "app" | "importado",
): Promise<number> {
  const client = await pool.connect();
  let inserted = 0;
  try {
    await client.query("BEGIN");
    for (const d of [...decisions].reverse()) {
      const result = await client.query(
        `INSERT INTO decisions
        (id,sku,nombre,cantidad_sugerida,cantidad_final,costo,estado,motivo,fecha,usuario,origen,registrado_por)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT (id) DO NOTHING`,
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
          origen,
          registradoPor,
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
  await pool.query("SELECT usuario FROM usuarios LIMIT 1");
}

// ---------- Usuarios y sesiones ----------

export type Rol = "admin" | "comprador" | "lector";
export interface Usuario {
  usuario: string;
  nombre: string;
  rol: Rol;
}

export async function readUsuarioParaLogin(usuario: string) {
  const { rows } = await pool.query<
    Usuario & { passwordHash: string; activo: boolean; bloqueado: boolean }
  >(
    `SELECT usuario, nombre, rol, password_hash AS "passwordHash", activo,
       COALESCE(bloqueado_hasta > now(), false) AS bloqueado
     FROM usuarios WHERE usuario = $1`,
    [usuario],
  );
  return rows[0];
}

/** Registra un intento fallido; tras `maximo` intentos bloquea la cuenta `minutos`. Devuelve true si quedó bloqueada. */
export async function registrarFallo(usuario: string, maximo: number, minutos: number) {
  const { rows } = await pool.query<{ bloqueado: boolean }>(
    `UPDATE usuarios SET
       intentos_fallidos = CASE WHEN intentos_fallidos + 1 >= $2 THEN 0 ELSE intentos_fallidos + 1 END,
       bloqueado_hasta = CASE WHEN intentos_fallidos + 1 >= $2 THEN now() + make_interval(mins => $3) ELSE bloqueado_hasta END
     WHERE usuario = $1
     RETURNING bloqueado_hasta > now() AS bloqueado`,
    [usuario, maximo, minutos],
  );
  return Boolean(rows[0]?.bloqueado);
}

export async function crearSesion(tokenHash: string, usuario: string, horas: number) {
  await pool.query(
    "UPDATE usuarios SET intentos_fallidos = 0, bloqueado_hasta = NULL WHERE usuario = $1",
    [usuario],
  );
  await pool.query("DELETE FROM sesiones WHERE expira_en < now()");
  await pool.query(
    `INSERT INTO sesiones (token_hash, usuario, expira_en) VALUES ($1, $2, now() + make_interval(hours => $3))`,
    [tokenHash, usuario, horas],
  );
}

export async function readSesion(tokenHash: string): Promise<Usuario | undefined> {
  const { rows } = await pool.query<Usuario>(
    `SELECT u.usuario, u.nombre, u.rol FROM sesiones s
     JOIN usuarios u ON u.usuario = s.usuario
     WHERE s.token_hash = $1 AND s.expira_en > now() AND u.activo`,
    [tokenHash],
  );
  return rows[0];
}

export async function borrarSesion(tokenHash: string) {
  await pool.query("DELETE FROM sesiones WHERE token_hash = $1", [tokenHash]);
}

export async function registrarAcceso(usuario: string, evento: string, ip: string) {
  await pool.query("INSERT INTO auditoria_accesos (usuario, evento, ip) VALUES ($1, $2, $3)", [
    usuario.slice(0, 60),
    evento,
    ip.slice(0, 60),
  ]);
}

// ---------- Trazas de agentes ----------

export interface AgentRun {
  id: string;
  fecha: string;
  usuario: string | null;
  consulta: string;
  modo: "llm" | "reglas";
  modelo: string;
  motivo: string | null;
  intencion: string;
  respuesta: string;
  llamadas: SupervisorReply["traza"]["llamadas"];
  mensajes: NonNullable<SupervisorReply["traza"]["mensajes"]>;
  verificacion: SupervisorReply["traza"]["verificacion"] | null;
  correccion: boolean;
  tokensEntrada: number;
  tokensSalida: number;
  costoUsd: number;
  duracionMs: number;
}

export async function insertAgentRun(
  id: string,
  usuario: string,
  consulta: string,
  r: SupervisorReply,
) {
  await pool.query(
    `INSERT INTO agent_runs
    (id, usuario, consulta, modo, modelo, motivo, intencion, respuesta, llamadas, mensajes,
     verificacion, correccion, tokens_entrada, tokens_salida, costo_usd, duracion_ms)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11::jsonb,$12,$13,$14,$15,$16)`,
    [
      id,
      usuario,
      consulta,
      r.traza.modo,
      r.traza.modelo,
      r.traza.motivo ?? null,
      r.intencion,
      [r.titulo, r.resumen, ...r.bullets.map((b) => `- ${b}`)].join("\n"),
      JSON.stringify(r.traza.llamadas),
      JSON.stringify(r.traza.mensajes ?? []),
      r.traza.verificacion ? JSON.stringify(r.traza.verificacion) : null,
      Boolean(r.traza.correccion),
      r.traza.tokensEntrada,
      r.traza.tokensSalida,
      r.traza.costoUsd,
      r.traza.ms,
    ],
  );
}

/** Trazas recientes. Si se indica `usuario`, solo las de ese usuario. */
export async function readAgentRuns(limit = 50, usuario?: string): Promise<AgentRun[]> {
  const { rows } = await pool.query<AgentRun>(
    `SELECT id, ${iso("created_at")} AS fecha, usuario,
      consulta, modo, modelo, motivo, intencion, respuesta, llamadas, mensajes, verificacion, correccion,
      tokens_entrada AS "tokensEntrada", tokens_salida AS "tokensSalida",
      costo_usd::float8 AS "costoUsd", duracion_ms AS "duracionMs"
    FROM agent_runs WHERE ($2::text IS NULL OR usuario = $2)
    ORDER BY created_at DESC LIMIT $1`,
    [Math.min(200, Math.max(1, limit)), usuario ?? null],
  );
  return rows;
}

// ---------- Uso de tokens y topes (persistentes: sobreviven a reinicios) ----------
const TZ = process.env["APP_TZ"] || "America/Lima";
const HOY = `(created_at AT TIME ZONE $1)::date = (now() AT TIME ZONE $1)::date`;

export async function usoHoy(usuario: string): Promise<{
  tokens: number;
  consultasLLM: number;
  consultasLLMUsuario: number;
}> {
  const { rows } = await pool.query<{
    tokens: number;
    consultasLLM: number;
    consultasLLMUsuario: number;
  }>(
    `SELECT COALESCE(SUM(tokens_entrada + tokens_salida), 0)::float8 AS tokens,
            COUNT(*) FILTER (WHERE modo = 'llm')::int AS "consultasLLM",
            COUNT(*) FILTER (WHERE modo = 'llm' AND usuario = $2)::int AS "consultasLLMUsuario"
     FROM agent_runs WHERE ${HOY}`,
    [TZ, usuario],
  );
  const r = rows[0];
  return {
    tokens: Number(r?.tokens ?? 0),
    consultasLLM: Number(r?.consultasLLM ?? 0),
    consultasLLMUsuario: Number(r?.consultasLLMUsuario ?? 0),
  };
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
