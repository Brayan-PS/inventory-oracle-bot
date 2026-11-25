// Ejecuta Intelli-Stock en tu PC SIN Docker y SIN instalar PostgreSQL:
//   1. Inicia un PostgreSQL 17 embebido (lo instala npm; los datos quedan en la carpeta .pgdata)
//   2. Aplica las migraciones y carga los 30 productos (solo si la base está vacía)
//   3. Levanta la aplicación
//
// Uso:
//   npm run local        → modo desarrollo (recarga al guardar). La URL aparece en la consola.
//   npm run local:prod   → compila igual que en la nube y abre http://localhost:3000
//   npm run local:reset  → borra la base local (.pgdata) para empezar de cero
//
// El Supervisor usa Gemini si tu archivo .env tiene GEMINI_API_KEY; si no, responde con reglas.
// Ctrl + C detiene la aplicación y la base de datos.
import EmbeddedPostgres from "embedded-postgres";
import { spawn } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const DATA = path.join(ROOT, ".pgdata");
const DB_PORT = Number(process.env.LOCAL_DB_PORT ?? 5433);
const DB = { user: "intelli_stock", password: "intelli_local", database: "intelli_stock" };
const args = process.argv.slice(2);

if (args.includes("--reset")) {
  rmSync(DATA, { recursive: true, force: true });
  console.log("Base local eliminada (.pgdata). Ejecuta de nuevo: npm run local");
  process.exit(0);
}

const pg = new EmbeddedPostgres({
  databaseDir: DATA,
  port: DB_PORT,
  user: DB.user,
  password: DB.password,
  persistent: true,
  onLog: () => {},
  onError: (e) => console.error(String(e).trim()),
});

let app;
let cerrando = false;
async function salir(code = 0) {
  if (cerrando) return;
  cerrando = true;
  if (app && app.exitCode === null) app.kill();
  await pg.stop().catch(() => {});
  process.exit(code);
}
process.on("SIGINT", () => salir(0));
process.on("SIGTERM", () => salir(0));

function run(cmdArgs, extraEnv = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, cmdArgs, {
      cwd: ROOT,
      env: { ...env, ...extraEnv },
      stdio: "inherit",
    });
    p.on("exit", (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`"${cmdArgs.join(" ")}" terminó con código ${code}`)),
    );
  });
}

const env = {
  ...process.env,
  PGHOST: "127.0.0.1",
  PGPORT: String(DB_PORT),
  PGDATABASE: DB.database,
  PGUSER: DB.user,
  PGPASSWORD: DB.password,
};
delete env.DATABASE_URL;
delete env.DATABASE_SSL;

try {
  if (!existsSync(path.join(DATA, "PG_VERSION"))) {
    console.log("Creando la base PostgreSQL local (solo la primera vez)…");
    await pg.initialise();
  }
  await pg.start();
  console.log(`PostgreSQL local activo en 127.0.0.1:${DB_PORT}`);

  const admin = pg.getPgClient("postgres", "127.0.0.1");
  await admin.connect();
  const existe = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [DB.database]);
  if (!existe.rowCount) await admin.query(`CREATE DATABASE ${DB.database}`);
  await admin.end();

  await run(["scripts/db.mjs", "migrate"]);
  await run(["scripts/db.mjs", "seed"]);

  console.log(
    process.env.GEMINI_API_KEY
      ? "Supervisor: Gemini activado (GEMINI_API_KEY encontrada en .env)."
      : "Supervisor: sin GEMINI_API_KEY en .env → responderá el motor de reglas.",
  );

  if (args.includes("--prod")) {
    await run(["node_modules/vite/bin/vite.js", "build"], { NITRO_PRESET: "node_server" });
    const port = process.env.PORT ?? "3000";
    app = spawn(process.execPath, [".output/server/index.mjs"], {
      cwd: ROOT,
      env: { ...env, PORT: port, HOST: "127.0.0.1", NODE_ENV: "production" },
      stdio: "inherit",
    });
    console.log(`\n  Intelli-Stock listo: http://localhost:${port}\n  (Ctrl + C para detener)\n`);
  } else {
    app = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "dev", "--host", "127.0.0.1"], {
      cwd: ROOT,
      env,
      stdio: "inherit",
    });
  }
  app.on("exit", (code) => salir(code ?? 0));
} catch (e) {
  console.error(`\nNo se pudo iniciar: ${e instanceof Error ? e.message : e}`);
  await salir(1);
}