// Respaldo lógico en JSON que funciona en cualquier entorno (Docker, Render o local), sin pg_dump.
//
//   node scripts/respaldo.mjs exportar            → backups/intelli_stock_<fecha>.json
//   node scripts/respaldo.mjs restaurar <archivo> → restaura productos, decisiones y trazas
//                                                   en una base migrada (dentro de una transacción)
//
// Usa DATABASE_URL o las variables PG*. No exporta contraseñas ni sesiones: tras restaurar en una
// base nueva, crea los usuarios con `npm run db:user`.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import pg from "pg";

const TABLAS = {
  products: [
    "sku",
    "nombre",
    "categoria",
    "proveedor",
    "precio_compra",
    "precio_venta",
    "stock",
    "stock_min",
    "stock_max",
    "ventas7",
    "ventas30",
    "lead_time",
    "tendencia",
    "estacionalidad",
    "display_order",
  ],
  decisions: [
    "id",
    "sku",
    "nombre",
    "cantidad_sugerida",
    "cantidad_final",
    "costo",
    "estado",
    "motivo",
    "fecha",
    "usuario",
    "origen",
    "registrado_por",
    "registrado_en",
  ],
  agent_runs: [
    "id",
    "created_at",
    "usuario",
    "consulta",
    "modo",
    "modelo",
    "motivo",
    "intencion",
    "respuesta",
    "llamadas",
    "mensajes",
    "verificacion",
    "correccion",
    "tokens_entrada",
    "tokens_salida",
    "costo_usd",
    "duracion_ms",
  ],
};

const ssl =
  process.env.DATABASE_SSL === "true"
    ? { ssl: { rejectUnauthorized: process.env.DATABASE_SSL_INSECURE !== "true" } }
    : {};
const client = new pg.Client({
  connectionTimeoutMillis: 10000,
  ...(process.env.DATABASE_URL ? { connectionString: process.env.DATABASE_URL } : {}),
  ...ssl,
});
await client.connect();
try {
  const [comando, archivo] = process.argv.slice(2);
  if (comando === "exportar") {
    const datos = { version: 1, exportado_en: new Date().toISOString(), tablas: {} };
    for (const [tabla, cols] of Object.entries(TABLAS)) {
      const { rows } = await client.query(`SELECT ${cols.join(", ")} FROM ${tabla}`);
      datos.tablas[tabla] = rows;
    }
    mkdirSync("backups", { recursive: true });
    const sello = new Date().toISOString().replace(/[-:]/g, "").replace("T", "_").slice(0, 13);
    const destino = `backups/intelli_stock_${sello}.json`;
    writeFileSync(destino, JSON.stringify(datos));
    const resumen = Object.entries(datos.tablas)
      .map(([t, r]) => `${t}: ${r.length}`)
      .join(", ");
    console.log(`Respaldo creado: ${destino} (${resumen})`);
  } else if (comando === "restaurar" && archivo) {
    const datos = JSON.parse(readFileSync(archivo, "utf8"));
    if (datos.version !== 1) throw new Error("Formato de respaldo desconocido.");
    await client.query("BEGIN");
    try {
      for (const [tabla, cols] of Object.entries(TABLAS)) {
        for (const fila of datos.tablas[tabla] ?? []) {
          const valores = cols.map((c) =>
            c === "llamadas" || c === "mensajes" || c === "verificacion"
              ? fila[c] == null
                ? null
                : JSON.stringify(fila[c])
              : fila[c],
          );
          await client.query(
            `INSERT INTO ${tabla} (${cols.join(", ")}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(", ")})
             ON CONFLICT DO NOTHING`,
            valores,
          );
        }
      }
      await client.query("COMMIT");
      console.log("Respaldo restaurado.");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    }
  } else {
    throw new Error("Uso: node scripts/respaldo.mjs exportar | restaurar <archivo.json>");
  }
} finally {
  await client.end();
}
