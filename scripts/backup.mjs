// Respaldo de PostgreSQL con pg_dump (dentro del contenedor "db" de Docker Compose).
// Uso: npm run db:backup   → crea backups/intelli_stock_AAAAMMDD_HHMM.sql
// Restaurar: docker compose exec -T db psql -U <usuario> -d <base> < backups/<archivo>.sql
import { spawn } from "node:child_process";
import { createWriteStream, mkdirSync } from "node:fs";

const user = process.env.POSTGRES_USER || "intelli_stock";
const db = process.env.POSTGRES_DB || "intelli_stock";
const stamp = new Date().toISOString().replace(/[-:]/g, "").replace("T", "_").slice(0, 13);
mkdirSync("backups", { recursive: true });
const file = `backups/${db}_${stamp}.sql`;
const out = createWriteStream(file);
const child = spawn(
  "docker",
  [
    "compose",
    "exec",
    "-T",
    "db",
    "pg_dump",
    "-U",
    user,
    "-d",
    db,
    "--no-owner",
    "--clean",
    "--if-exists",
  ],
  { stdio: ["ignore", "pipe", "inherit"] },
);
child.stdout.pipe(out);
child.on("close", (code) => {
  if (code === 0) console.log(`Respaldo creado: ${file}`);
  else {
    console.error(`pg_dump terminó con código ${code}. ¿Está corriendo "docker compose up"?`);
    process.exitCode = 1;
  }
});
