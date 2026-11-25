/**
 * Búsqueda de productos por nombre o SKU dentro de una consulta en lenguaje natural.
 *
 * - Palabras cortas: "pan" encuentra "Pan Integral 700g"; "té" (con tilde) encuentra
 *   "Té Matcha", pero "te" sin tilde no, porque en español suele ser un pronombre.
 * - Plurales y variantes: "galleta" ↔ "galletas", "jabones" ↔ "jabón".
 * - Varios productos: "arroz y azúcar" devuelve los dos.
 * - Ambigüedad: "jabón" coincide con dos productos y se devuelve como ambigua para
 *   que el Supervisor pregunte cuál, salvo que otra palabra lo decida ("jabón corporal").
 */

export interface ProductoBuscable {
  sku: string;
  nombre: string;
}

export interface ResultadoBusqueda<P extends ProductoBuscable> {
  /** Productos identificados sin ambigüedad, en orden de aparición en la consulta. */
  productos: P[];
  /** Términos que coinciden con varios productos y ninguna otra palabra los distingue. */
  ambiguos: { termino: string; opciones: P[] }[];
}

/** Minúsculas, sin tildes. */
export function norm(s: string) {
  return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

/** Minúsculas conservando tildes (para distinguir "té" de "te"). */
const lower = (s: string) => s.toLowerCase().normalize("NFC");

const VACIAS = new Set([
  "de",
  "del",
  "la",
  "el",
  "los",
  "las",
  "en",
  "con",
  "y",
  "para",
  "por",
  "al",
  "a",
  "un",
  "una",
]);

/** Palabras de nombres que no identifican un producto por sí solas. */
const GENERICAS = new Set(["premium", "extra", "mixtas", "pk", "rollos", "roll", "on", "lata"]);

interface Token {
  raw: string; // con tildes
  n: string; // sin tildes
}

function tokens(texto: string): Token[] {
  return lower(texto)
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .map((raw) => ({ raw, n: norm(raw) }));
}

function tokensNombre(nombre: string): Token[] {
  return tokens(nombre).filter(
    (t) => !VACIAS.has(t.n) && !GENERICAS.has(t.n) && !/\d/.test(t.n) && t.n.length >= 2,
  );
}

/** ¿La palabra de la consulta `q` se refiere a la palabra del nombre `w`? */
function coincide(q: Token, w: Token): boolean {
  if (w.n.length <= 3 || q.n.length <= 3) {
    // Palabras cortas: igualdad exacta conservando tildes ("pan" = "pan", "té" = "té", "te" ≠ "té").
    return q.raw === w.raw;
  }
  if (q.n === w.n) return true;
  // Plurales y variantes simples: "galleta"/"galletas", "jabon"/"jabones".
  const [a, b] = q.n.length <= w.n.length ? [q.n, w.n] : [w.n, q.n];
  return b.startsWith(a) && b.length - a.length <= 2 && a.length >= 4;
}

export function buscarProductos<P extends ProductoBuscable>(
  consulta: string,
  catalogo: P[],
): ResultadoBusqueda<P> {
  const q = norm(consulta);
  const porSku = catalogo.filter((p) => q.includes(p.sku.toLowerCase()));
  const qTokens = tokens(consulta).filter((t) => !VACIAS.has(t.n));
  const nombres = new Map(catalogo.map((p) => [p.sku, tokensNombre(p.nombre)]));

  // Para cada palabra de la consulta, los productos cuyo nombre la contiene.
  const grupos: { termino: string; posicion: number; opciones: P[] }[] = [];
  qTokens.forEach((t, posicion) => {
    const opciones = catalogo.filter((p) => (nombres.get(p.sku) ?? []).some((w) => coincide(t, w)));
    if (opciones.length) grupos.push({ termino: t.raw, posicion, opciones });
  });

  // Puntaje por producto: cuántas palabras de su nombre aparecen en la consulta.
  const puntaje = new Map<string, number>();
  for (const g of grupos)
    for (const p of g.opciones) puntaje.set(p.sku, (puntaje.get(p.sku) ?? 0) + 1);

  const elegidos: P[] = [...porSku];
  const ambiguos: { termino: string; opciones: P[] }[] = [];
  const yaUsado = (p: P) => elegidos.some((e) => e.sku === p.sku);

  for (const g of grupos) {
    if (g.opciones.some(yaUsado)) continue;
    if (g.opciones.length === 1) {
      elegidos.push(g.opciones[0]!);
      continue;
    }
    // Varias opciones: gana la que tiene más palabras en común con la consulta.
    const max = Math.max(...g.opciones.map((p) => puntaje.get(p.sku) ?? 0));
    const mejores = g.opciones.filter((p) => (puntaje.get(p.sku) ?? 0) === max);
    if (mejores.length === 1) elegidos.push(mejores[0]!);
    else if (!ambiguos.some((a) => a.termino === g.termino))
      ambiguos.push({ termino: g.termino, opciones: mejores });
  }

  // Un término ambiguo deja de serlo si alguna de sus opciones ya fue elegida por otra palabra.
  const pendientes = ambiguos.filter((a) => !a.opciones.some(yaUsado));
  const orden = (p: P) => {
    const g = grupos.find((x) => x.opciones.some((o) => o.sku === p.sku));
    return g ? g.posicion : -1;
  };
  return { productos: elegidos.sort((a, b) => orden(a) - orden(b)), ambiguos: pendientes };
}

/** Productos parecidos a un texto que no coincidió (para sugerir alternativas). */
export function sugerirProductos<P extends ProductoBuscable>(
  texto: string,
  catalogo: P[],
  max = 4,
) {
  const q = norm(texto).replace(/[^a-z0-9]/g, "");
  const trigramas = new Set<string>();
  for (let i = 0; i + 3 <= q.length; i++) trigramas.add(q.slice(i, i + 3));
  if (!trigramas.size) return [];
  const minimo = Math.max(2, Math.ceil(trigramas.size * 0.4));
  return [...catalogo]
    .map((p) => {
      const n = norm(p.nombre).replace(/[^a-z0-9]/g, "");
      let s = 0;
      for (const t of trigramas) if (n.includes(t)) s++;
      return { p, s };
    })
    .filter((x) => x.s >= minimo)
    .sort((a, b) => b.s - a.s)
    .slice(0, max)
    .map((x) => x.p);
}
