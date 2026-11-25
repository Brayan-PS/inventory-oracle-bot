import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import pg from "pg";
import { hashPassword, validarPassword } from "./password.mjs";

// Uso:
//   node scripts/db.mjs migrate                  aplica migraciones (con checksum)
//   node scripts/db.mjs seed                     carga los 30 productos si la base está vacía y,
//                                                si existen DEMO_USER y DEMO_PASSWORD, crea/actualiza
//                                                ese usuario de demostración
//   node scripts/db.mjs user <usuario> <rol> "<nombre>"
//                                                crea o actualiza un usuario; la contraseña se lee de
//                                                la variable USER_PASSWORD (nunca de la línea de comandos)
//
// En la nube (Render) se usa DATABASE_URL; en Docker Compose, las variables PG*.
const ssl =
  process.env.DATABASE_SSL === "true"
    ? { ssl: { rejectUnauthorized: process.env.DATABASE_SSL_INSECURE !== "true" } }
    : {};
const client = new pg.Client({
  connectionTimeoutMillis: 10000,
  ...(process.env.DATABASE_URL ? { connectionString: process.env.DATABASE_URL } : {}),
  ...ssl,
});

const ROLES = ["admin", "comprador", "lector"];

async function upsertUsuario(usuario, rol, nombre, password) {
  if (!/^[a-z0-9._-]{3,40}$/.test(usuario))
    throw new Error("Usuario inválido: 3 a 40 caracteres a-z, 0-9, punto, guion o guion bajo.");
  if (!ROLES.includes(rol)) throw new Error(`Rol inválido. Usa: ${ROLES.join(", ")}.`);
  const problema = validarPassword(password);
  if (problema) throw new Error(problema);
  await client.query(
    `INSERT INTO usuarios (usuario, nombre, rol, password_hash) VALUES ($1, $2, $3, $4)
     ON CONFLICT (usuario) DO UPDATE SET nombre = EXCLUDED.nombre, rol = EXCLUDED.rol,
       password_hash = EXCLUDED.password_hash, activo = true, intentos_fallidos = 0, bloqueado_hasta = NULL`,
    [usuario, nombre, rol, hashPassword(password)],
  );
  // Al cambiar la contraseña se cierran las sesiones abiertas de ese usuario.
  await client.query("DELETE FROM sesiones WHERE usuario = $1", [usuario]);
}

await client.connect();
try {
  await client.query("SELECT pg_advisory_lock(183714, 1)");
  const comando = process.argv[2];
  if (comando === "migrate") {
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
  } else if (comando === "seed") {
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
      if (process.env.DEMO_USER && process.env.DEMO_PASSWORD) {
        await upsertUsuario(
          process.env.DEMO_USER.toLowerCase(),
          process.env.DEMO_ROL || "admin",
          process.env.DEMO_NOMBRE || "Docente evaluador",
          process.env.DEMO_PASSWORD,
        );
        console.log(`Usuario de demostración listo: ${process.env.DEMO_USER.toLowerCase()}`);
      }
      const { rows: u } = await client.query("SELECT count(*)::int AS total FROM usuarios");
      if (u[0].total === 0 && !process.env.LOCAL_SETUP)
        console.log(
          'Aún no hay usuarios. Crea uno con: USER_PASSWORD=… node scripts/db.mjs user <usuario> admin "<nombre>"',
        );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  } else if (comando === "user") {
    const [usuario, rol, ...nombre] = process.argv.slice(3);
    if (!usuario || !rol || !nombre.length)
      throw new Error('Uso: USER_PASSWORD=… node scripts/db.mjs user <usuario> <rol> "<nombre>"');
    if (!process.env.USER_PASSWORD) throw new Error("Define la contraseña en USER_PASSWORD.");
    await upsertUsuario(usuario.toLowerCase(), rol, nombre.join(" "), process.env.USER_PASSWORD);
    console.log(`Usuario ${usuario.toLowerCase()} (${rol}) listo.`);
  } else {
    throw new Error("Uso: node scripts/db.mjs migrate|seed|user");
  }
} finally {
  await client.end();
}
