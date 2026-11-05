import pg from "pg";
import type { BaseProduct } from "../lib/inventory";
import type { Decision } from "../lib/decisions";

const pool = new pg.Pool({
  host: process.env["PGHOST"] ?? "127.0.0.1",
  port: Number(process.env["PGPORT"] ?? "5433"),
  database: process.env["PGDATABASE"] ?? process.env["POSTGRES_DB"],
  user: process.env["PGUSER"] ?? process.env["POSTGRES_USER"],
  password: process.env["PGPASSWORD"] ?? process.env["POSTGRES_PASSWORD"],
  max: 5,
  connectionTimeoutMillis: 5000,
  idleTimeoutMillis: 30000,
});
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
}
