/**
 * Límites de uso.
 *
 * - IP del cliente: detrás de un proxy (Render), X-Forwarded-For es "cliente, proxy1, …"
 *   y el CLIENTE puede escribir valores falsos al inicio. Solo son confiables los últimos
 *   TRUSTED_PROXY_HOPS valores, que agregan los proxies propios. Por eso se toma el valor
 *   en la posición (largo − TRUSTED_PROXY_HOPS), nunca el primero.
 * - Los límites por minuto viven en memoria (una ventana corta); los topes diarios se
 *   cuentan en PostgreSQL y por eso sobreviven a reinicios del servidor.
 */

/**
 * Número desde una variable de entorno. Una variable vacía (por ejemplo `LOGIN_RATE_PER_MIN=`
 * copiada de .env.example) usa el valor por defecto en lugar de convertirse en 0.
 */
export function envNum(nombre: string, porDefecto: number): number {
  const v = process.env[nombre];
  if (v === undefined || v.trim() === "") return porDefecto;
  const n = Number(v);
  return Number.isFinite(n) ? n : porDefecto;
}

export function clientIp(request: Request, hops = envNum("TRUSTED_PROXY_HOPS", 1)): string {
  const xff = request.headers.get("x-forwarded-for");
  if (!xff || hops <= 0) return "directo";
  const ips = xff
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (!ips.length) return "directo";
  return ips[Math.max(0, ips.length - hops)] ?? "directo";
}

/** Ventana deslizante en memoria: como máximo `max` eventos por `ventanaMs` y clave. */
export class RateLimiter {
  private readonly eventos = new Map<string, number[]>();
  private readonly max: number;
  private readonly ventanaMs: number;

  constructor(max: number, ventanaMs: number) {
    this.max = max;
    this.ventanaMs = ventanaMs;
  }

  permitir(clave: string, ahora = Date.now()): boolean {
    const v = (this.eventos.get(clave) ?? []).filter((t) => ahora - t < this.ventanaMs);
    if (v.length >= this.max) {
      this.eventos.set(clave, v);
      return false;
    }
    v.push(ahora);
    this.eventos.set(clave, v);
    if (this.eventos.size > 10_000) this.eventos.clear();
    return true;
  }
}
