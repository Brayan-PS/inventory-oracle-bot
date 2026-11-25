import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";

// Aplica migraciones y semilla y crea dos usuarios de prueba con contraseñas aleatorias.
export default function globalSetup() {
  if (process.env.E2E_ALLOW_DB_RESET !== "1") {
    throw new Error(
      "Las pruebas E2E borran decisiones de la base configurada. Usa una base de prueba y define E2E_ALLOW_DB_RESET=1.",
    );
  }
  const run = (args, env = {}) => {
    const r = spawnSync(process.execPath, ["scripts/db.mjs", ...args], {
      env: { ...process.env, ...env },
      encoding: "utf8",
    });
    if (r.status !== 0) throw new Error(r.stderr || r.stdout);
  };
  run(["migrate"]);
  run(["seed"]);
  for (const [usuario, rol, nombre] of [
    ["e2e_comprador", "comprador", "Comprador E2E"],
    ["e2e_lector", "lector", "Lector E2E"],
  ]) {
    const password = `E2e-${randomBytes(9).toString("base64url")}1`;
    run(["user", usuario, rol, nombre], { USER_PASSWORD: password });
    process.env[`E2E_PASS_${rol.toUpperCase()}`] = password;
  }
}
