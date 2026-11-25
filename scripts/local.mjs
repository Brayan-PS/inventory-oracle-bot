// Ejecuta Intelli-Stock en tu PC SIN Docker y SIN instalar PostgreSQL:
//   1. Inicia un PostgreSQL 17 embebido (lo instala npm; los datos quedan en la carpeta .pgdata)
//   2. Aplica las migraciones, carga los 30 productos y, la primera vez, crea un usuario "demo"
//   3. Levanta la aplicación
//
// Uso:
//   npm run local        → modo desarrollo (recarga al guardar). La URL aparece en la consola.
//   npm run local:prod   → compila igual que en la nube y abre http://localhost:3000
//   npm run local:reset  → borra la base local (.pgdata) para empezar de cero
//
// No hay contraseñas fijas en el código: la de la base local se genera al azar la primera vez y
// se guarda en .pgdata/.clave-db (carpeta excluida de Git). La del usuario "demo" se genera al azar,
// se muestra una vez en la consola y se guarda en .pgdata/credenciales-demo.txt.
// El Supervisor usa Gemini si tu archivo .env tiene GEMINI_API_KEY; si no, responde con reglas.
// Ctrl + C detiene la aplicación y la base de datos.
import EmbeddedPostgres from "embedded-postgres";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import net from "node:net";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const DATA = path.join(ROOT, ".pgdata");
const CLAVE = path.join(DATA, ".clave-db");
const args = process.argv.slice(2);

/** ¿Está libre el puerto en 127.0.0.1? */
const puertoLibre = (port) =>
  new Promise((resolve) => {
    const srv = net.createServer();
    srv.once("error", () => resolve(false));
    srv.once("listening", () => srv.close(() => resolve(true)));
    srv.listen(port, "127.0.0.1");
  });

// Puerto de la base local: LOCAL_DB_PORT si se indica; si no, el primero libre desde 5433.
// (Si otra base PostgreSQL —por ejemplo la de una versión anterior del proyecto— ocupa el 5433,
// se usa el siguiente en lugar de fallar.)
let DB_PORT = Number(process.env.LOCAL_DB_PORT || 5433);
if (!args.includes("--reset")) {
  if (process.env.LOCAL_DB_PORT) {
    if (!(await puertoLibre(DB_PORT))) {
      console.error(
        `El puerto ${DB_PORT} (LOCAL_DB_PORT) está ocupado. Cierra el programa que lo usa o elige otro puerto.`,
      );
      process.exit(1);
    }
  } else {
    while (!(await puertoLibre(DB_PORT)) && DB_PORT < 5460) DB_PORT++;
    if (DB_PORT !== 5433)
      console.log(`El puerto 5433 está ocupado; la base local usará el ${DB_PORT}.`);
  }
}

if (args.includes("--reset")) {
  rmSync(DATA, { recursive: true, force: true });
  console.log("Base local eliminada (.pgdata). Ejecuta de nuevo: npm run local");
  process.exit(0);
}

let nueva = !existsSync(path.join(DATA, "PG_VERSION"));
// Variable vacía en .env (LOCAL_DB_PASSWORD=) = no definida.
let password = process.env.LOCAL_DB_PASSWORD?.trim() || undefined;
if (!password && existsSync(CLAVE)) password = readFileSync(CLAVE, "utf8").trim() || undefined;
if (!nueva && existsSync(CLAVE) && !password) {
  // Clave guardada vacía: base creada por un intento fallido (nunca pudo usarse). Se recrea.
  console.log("La base local quedó incompleta en un intento anterior: se creará de nuevo.");
  rmSync(DATA, { recursive: true, force: true });
  nueva = true;
}
if (!password && !nueva) {
  console.error(
    "La base local (.pgdata) se creó con una versión anterior. Define LOCAL_DB_PASSWORD en tu .env\n" +
      "con la contraseña que usaba esa versión, o ejecuta npm run local:reset para crearla de nuevo.",
  );
  process.exit(1);
}
password ||= randomBytes(18).toString("base64url");
const DB = { user: "intelli_stock", password, database: "intelli_stock" };

// Se guardan las últimas líneas del registro de PostgreSQL para mostrarlas si algo falla.
const registro = [];
const anotar = (m) => {
  for (const linea of String(m).split(/\r?\n/)) {
    if (linea.trim()) registro.push(linea.trim());
  }
  if (registro.length > 40) registro.splice(0, registro.length - 40);
};
const pg = new EmbeddedPostgres({
  databaseDir: DATA,
  port: DB_PORT,
  user: DB.user,
  password: DB.password,
  persistent: true,
  onLog: anotar,
  onError: (e) => anotar(e),
});

function explicarFallo(e) {
  const detalle = e instanceof Error ? e.message : e ? String(e) : "";
  console.error(`\nNo se pudo iniciar: ${detalle || "PostgreSQL se cerró al arrancar."}`);
  const texto = registro.join("\n");
  if (registro.length) {
    console.error("\nÚltimas líneas del registro de PostgreSQL:");
    console.error(
      registro
        .slice(-15)
        .map((l) => `  ${l}`)
        .join("\n"),
    );
  }
  const pistas = [];
  if (/administrat|administrador/i.test(texto))
    pistas.push(
      "PostgreSQL no se ejecuta con permisos de administrador: abre una terminal NORMAL (no «Ejecutar como administrador») y vuelve a intentarlo.",
    );
  if (/address already in use|could not bind|ya se est|en uso/i.test(texto))
    pistas.push(
      `El puerto ${DB_PORT} está ocupado: define LOCAL_DB_PORT con otro puerto en tu .env.`,
    );
  if (/lock file|postmaster\.pid/i.test(texto))
    pistas.push(
      "Quedó un PostgreSQL anterior abierto con esta carpeta: ciérralo desde el Administrador de tareas (procesos postgres.exe) o reinicia la PC.",
    );
  if (!pistas.length)
    pistas.push(
      "Revisa que la terminal no esté abierta como administrador y que ningún antivirus bloquee postgres.exe. Si .pgdata quedó dañada, ejecuta npm run local:reset.",
    );
  console.error(`\nQué hacer:\n${pistas.map((p) => `  - ${p}`).join("\n")}`);
}

let app;
let cerrando = false;
let iniciado = false;
const borrarDatos = () => {
  try {
    rmSync(DATA, { recursive: true, force: true });
  } catch {
    /* si Windows aún bloquea algún archivo, npm run local:reset lo borra después */
  }
};
async function salir(code = 0) {
  if (cerrando) return;
  cerrando = true;
  if (app && app.exitCode === null) app.kill();
  // Solo se detiene PostgreSQL si llegó a arrancar (si no, stop() esperaría para siempre).
  if (iniciado) await pg.stop().catch(() => {});
  process.exit(code);
}
process.on("SIGINT", () => salir(0));
process.on("SIGTERM", () => salir(0));

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

try {
  if (nueva) {
    console.log("Creando la base PostgreSQL local (solo la primera vez)…");
    // Si .pgdata quedó a medias de un intento anterior fallido, se empieza de cero.
    borrarDatos();
    try {
      await pg.initialise();
      writeFileSync(CLAVE, DB.password, { mode: 0o600 });
    } catch (e) {
      // Una base recién creada que no se pudo inicializar no tiene datos: se borra para reintentar limpio.
      borrarDatos();
      throw e;
    }
  }
  try {
    await pg.start();
    iniciado = true;
  } catch (e) {
    // Si la base se creó en ESTE intento y no arrancó, se borra (no tiene datos) para reintentar limpio.
    if (nueva) borrarDatos();
    throw e;
  }
  console.log(`PostgreSQL local activo en 127.0.0.1:${DB_PORT}`);

  const admin = pg.getPgClient("postgres", "127.0.0.1");
  await admin.connect();
  const existe = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [DB.database]);
  if (!existe.rowCount) await admin.query(`CREATE DATABASE ${DB.database}`);
  await admin.end();

  await run(["scripts/db.mjs", "migrate"]);
  await run(["scripts/db.mjs", "seed"], { LOCAL_SETUP: "1" });

  // Primera vez: usuario "demo" (admin) con contraseña aleatoria.
  const cred = path.join(DATA, "credenciales-demo.txt");
  if (!existsSync(cred)) {
    const demoPass = `Demo-${randomBytes(9).toString("base64url")}1`;
    await run(["scripts/db.mjs", "user", "demo", "admin", "Usuario de demostración"], {
      USER_PASSWORD: demoPass,
    });
    writeFileSync(cred, `usuario: demo\ncontraseña: ${demoPass}\n`, { mode: 0o600 });
    console.log(`\n  Usuario local creado → usuario: demo · contraseña: ${demoPass}`);
    console.log(`  (guardado en .pgdata/credenciales-demo.txt)\n`);
  } else {
    console.log("Credenciales del usuario local: .pgdata/credenciales-demo.txt");
  }

  console.log(
    process.env.GEMINI_API_KEY
      ? "Supervisor: Gemini activado (GEMINI_API_KEY encontrada en .env)."
      : "Supervisor: sin GEMINI_API_KEY en .env → responderá el motor de reglas.",
  );

  if (args.includes("--prod")) {
    await run(["node_modules/vite/bin/vite.js", "build"], { NITRO_PRESET: "node_server" });
    const port = process.env.PORT || "3000";
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
  explicarFallo(e);
  await salir(1);
}
