import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import pg from "pg";

const client = new pg.Client({ connectionTimeoutMillis: 10000 });
await client.connect();
try {
  await client.query("SELECT pg_advisory_lock(183714, 1)");
  if (process.argv[2] === "migrate") {
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now()
    )`);
    const directory = new URL("../migrations/", import.meta.url);
    for (const name of (await readdir(directory)).filter((n) => n.endsWith(".sql")).sort()) {
      const sql = await readFile(new URL(name, directory), "utf8");
      const checksum = createHash("sha256").update(sql).digest("hex");
      const applied = await client.query("SELECT checksum FROM schema_migrations WHERE name = $1", [
        name,
      ]);
      if (applied.rows[0]) {
        if (applied.rows[0].checksum !== checksum)
          throw new Error(`Migración aplicada modificada: ${name}`);
        console.log(`Sin cambios: ${name}`);
        continue;
      }
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)", [
          name,
          checksum,
        ]);
        await client.query("COMMIT");
        console.log(`Aplicada: ${name}`);
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
  } else if (process.argv[2] === "seed") {
    await client.query("BEGIN");
    try {
      const { rows } = await client.query("SELECT count(*)::int AS total FROM products");
      if (rows[0].total === 0) {
        const products = JSON.parse(
          await readFile(new URL("../seeds/products.json", import.meta.url), "utf8"),
        );
        for (const [index, p] of products.entries()) {
          await client.query(
            `INSERT INTO products
            (sku,nombre,categoria,proveedor,precio_compra,precio_venta,stock,stock_min,stock_max,ventas7,ventas30,lead_time,tendencia,estacionalidad,display_order)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
            [
              p.sku,
              p.nombre,
              p.categoria,
              p.proveedor,
              p.precioCompra,
              p.precioVenta,
              p.stock,
              p.stockMin,
              p.stockMax,
              p.ventas7,
              p.ventas30,
              p.leadTime,
              p.tendencia,
              p.estacionalidad,
              index,
            ],
          );
        }
        console.log(`Catálogo inicial: ${products.length} productos.`);
      } else {
        console.log("Catálogo existente conservado; no se aplica semilla.");
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  } else {
    throw new Error("Uso: node scripts/db.mjs migrate|seed");
  }
} finally {
  await client.end();
}
