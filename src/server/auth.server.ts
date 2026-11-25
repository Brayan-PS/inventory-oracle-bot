/**
 * Autenticación y autorización.
 *
 * - Contraseñas con scrypt (scripts/password.mjs) y comparación en tiempo constante.
 * - Sesión del lado del servidor: la cookie lleva un token aleatorio de 256 bits y la
 *   base guarda solo su hash SHA-256. Cerrar sesión la invalida de inmediato.
 * - Cookie HttpOnly + SameSite=Lax (+ Secure en HTTPS) y verificación de Origin en
 *   todas las escrituras: protección contra CSRF.
 * - Bloqueo de la cuenta tras 5 intentos fallidos (15 min) y límite por IP.
 * - Roles: admin (todo), comprador (consulta y decide), lector (solo consulta).
 */

import { createHash, randomBytes } from "node:crypto";
import { HASH_FICTICIO, verifyPassword } from "../../scripts/password.mjs";
import {
  borrarSesion,
  crearSesion,
  readSesion,
  readUsuarioParaLogin,
  registrarAcceso,
  registrarFallo,
  type Rol,
  type Usuario,
} from "./database.server";
import { sameOrigin } from "./origin.server";
import { clientIp, envNum, RateLimiter } from "./limits.server";
import { z } from "zod";

export type { Rol, Usuario };

export const COOKIE = "intelli_sesion";
const HORAS_SESION = envNum("SESSION_HOURS", 8);
const MAX_FALLOS = 5;
const MINUTOS_BLOQUEO = 15;
const loginPorIp = new RateLimiter(envNum("LOGIN_RATE_PER_MIN", 10), 60_000);

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

export function leerCookie(request: Request, nombre = COOKIE): string | undefined {
  const header = request.headers.get("cookie") ?? "";
  for (const parte of header.split(";")) {
    const [k, ...v] = parte.trim().split("=");
    if (k === nombre) return decodeURIComponent(v.join("="));
  }
  return undefined;
}

function esHttps(request: Request) {
  const proto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  if (proto) return proto === "https";
  try {
    return new URL(request.url).protocol === "https:";
  } catch {
    return false;
  }
}

function cookieSesion(request: Request, valor: string, maxAge: number) {
  return [
    `${COOKIE}=${encodeURIComponent(valor)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAge}`,
    ...(esHttps(request) ? ["Secure"] : []),
  ].join("; ");
}

/** Usuario de la sesión, o undefined. */
export async function usuarioDeSesion(request: Request): Promise<Usuario | undefined> {
  const token = leerCookie(request);
  if (!token || !/^[A-Za-z0-9_-]{40,60}$/.test(token)) return undefined;
  try {
    return await readSesion(sha256(token));
  } catch {
    return undefined;
  }
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store", ...headers } });

/**
 * Exige sesión (y un rol, si se indica). Devuelve el usuario o una respuesta 401/403
 * lista para devolver al cliente.
 */
export async function exigirUsuario(request: Request, roles?: Rol[]): Promise<Usuario | Response> {
  const u = await usuarioDeSesion(request);
  if (!u) return json({ error: "Inicia sesión para continuar." }, 401);
  if (roles && !roles.includes(u.rol))
    return json({ error: "Tu rol no tiene permiso para esta acción." }, 403);
  return u;
}

const loginSchema = z.object({
  usuario: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9._-]{3,40}$/),
  password: z.string().min(1).max(200),
});

export async function handleLogin(request: Request): Promise<Response> {
  if (!sameOrigin(request)) return json({ error: "Origen de solicitud no permitido." }, 403);
  const ip = clientIp(request);
  if (!loginPorIp.permitir(ip))
    return json({ error: "Demasiados intentos. Espera un minuto." }, 429);
  let datos: z.infer<typeof loginSchema>;
  try {
    const parsed = loginSchema.safeParse(await request.json());
    if (!parsed.success) return json({ error: "Usuario o contraseña incorrectos." }, 401);
    datos = parsed.data;
  } catch {
    return json({ error: "Solicitud inválida." }, 400);
  }
  try {
    const u = await readUsuarioParaLogin(datos.usuario);
    // Se verifica siempre (con un hash ficticio si el usuario no existe) para no revelar usuarios por tiempo.
    const ok = verifyPassword(datos.password, u?.passwordHash ?? HASH_FICTICIO);
    if (u?.bloqueado) {
      await registrarAcceso(datos.usuario, "login_fallido", ip);
      return json(
        { error: `Cuenta bloqueada temporalmente. Intenta en ${MINUTOS_BLOQUEO} minutos.` },
        423,
      );
    }
    if (!u || !u.activo || !ok) {
      if (u) {
        const bloqueada = await registrarFallo(u.usuario, MAX_FALLOS, MINUTOS_BLOQUEO);
        await registrarAcceso(u.usuario, bloqueada ? "bloqueo" : "login_fallido", ip);
      } else {
        await registrarAcceso(datos.usuario, "login_fallido", ip);
      }
      return json({ error: "Usuario o contraseña incorrectos." }, 401);
    }
    const token = randomBytes(32).toString("base64url");
    await crearSesion(sha256(token), u.usuario, HORAS_SESION);
    await registrarAcceso(u.usuario, "login_ok", ip);
    return json({ usuario: { usuario: u.usuario, nombre: u.nombre, rol: u.rol } }, 200, {
      "Set-Cookie": cookieSesion(request, token, HORAS_SESION * 3600),
    });
  } catch {
    return json({ error: "No se pudo iniciar sesión. Comprueba la base de datos." }, 503);
  }
}

export async function handleLogout(request: Request): Promise<Response> {
  if (!sameOrigin(request)) return json({ error: "Origen de solicitud no permitido." }, 403);
  const token = leerCookie(request);
  if (token) {
    try {
      const u = await usuarioDeSesion(request);
      await borrarSesion(sha256(token));
      if (u) await registrarAcceso(u.usuario, "logout", clientIp(request));
    } catch {
      /* la cookie se borra igual */
    }
  }
  return json({ ok: true }, 200, { "Set-Cookie": cookieSesion(request, "", 0) });
}

export async function handleMe(request: Request): Promise<Response> {
  const u = await usuarioDeSesion(request);
  return u ? json({ usuario: u }) : json({ usuario: null }, 401);
}
