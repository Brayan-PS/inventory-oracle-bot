/**
 * Comprueba que una petición que escribe datos venga de la misma aplicación.
 * Funciona detrás de proxies HTTPS (Render, etc.): compara el host del encabezado
 * Origin con el host público (X-Forwarded-Host / Host) o con APP_ORIGIN.
 */
export function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    return false;
  }
  const permitidos = new Set<string>();
  try {
    permitidos.add(new URL(request.url).host);
  } catch {
    /* ignore */
  }
  const fwd = request.headers.get("x-forwarded-host");
  if (fwd) permitidos.add(fwd.split(",")[0]!.trim());
  const host = request.headers.get("host");
  if (host) permitidos.add(host);
  for (const o of (process.env["APP_ORIGIN"] ?? "").split(",")) {
    try {
      if (o.trim()) permitidos.add(new URL(o.trim()).host);
    } catch {
      /* ignore */
    }
  }
  return permitidos.has(originHost);
}
