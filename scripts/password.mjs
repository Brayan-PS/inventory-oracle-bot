// Hash de contraseñas con scrypt (node:crypto). Lo usan el servidor y scripts/db.mjs.
// Formato: scrypt$N$r$p$salt(base64url)$hash(base64url)
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const N = 16384;
const R = 8;
const P = 1;
const LARGO = 64;

export function validarPassword(password) {
  if (typeof password !== "string" || password.length < 10 || password.length > 200) {
    return "La contraseña debe tener entre 10 y 200 caracteres.";
  }
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) {
    return "La contraseña debe combinar letras y números.";
  }
  return null;
}

export function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = scryptSync(password.normalize("NFKC"), salt, LARGO, { N, r: R, p: P });
  return `scrypt$${N}$${R}$${P}$${salt.toString("base64url")}$${hash.toString("base64url")}`;
}

export function verifyPassword(password, almacenado) {
  const partes = String(almacenado ?? "").split("$");
  if (partes.length !== 6 || partes[0] !== "scrypt") return false;
  const [, n, r, p, salt, hash] = partes;
  const esperado = Buffer.from(hash, "base64url");
  const calculado = scryptSync(
    String(password).normalize("NFKC"),
    Buffer.from(salt, "base64url"),
    esperado.length,
    {
      N: Number(n),
      r: Number(r),
      p: Number(p),
    },
  );
  return esperado.length === calculado.length && timingSafeEqual(esperado, calculado);
}

// Hash de una contraseña aleatoria: se verifica contra él cuando el usuario no existe,
// para que el tiempo de respuesta no revele qué usuarios existen.
export const HASH_FICTICIO = hashPassword(randomBytes(18).toString("base64url"));
