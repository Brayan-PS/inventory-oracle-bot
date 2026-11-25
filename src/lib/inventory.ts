/**
 * Intelli-Stock — capa de cálculo del inventario (datos de demostración).
 *
 * Los cálculos están separados en funciones puras, una por especialidad. Los
 * agentes (src/lib/agents.ts) las usan después de pedirse datos entre ellos por
 * mensajes, y `deriveProduct` las compone para las pantallas. Así el resultado
 * de los agentes y el de las pantallas es siempre el mismo.
 *
 *  - Analista de Ventas  → rotación y tendencia
 *  - Predictor           → demanda prevista y riesgo de quiebre
 *  - Gestor de Inventario→ cobertura, sobrestock y valor del stock
 *  - Reposición          → stock de seguridad, cantidad, costo y prioridad
 */

export type RiskLevel = "critico" | "alto" | "moderado" | "saludable";

export interface BaseProduct {
  sku: string;
  nombre: string;
  categoria: string;
  precioCompra: number;
  precioVenta: number;
  stock: number;
  stockMin: number;
  stockMax: number;
  ventas7: number;
  ventas30: number;
  leadTime: number;
  proveedor: string;
  /** Tendencia semanal de la demanda (-0.25 .. +0.35) */
  tendencia: number;
  estacionalidad: string;
}

export interface Product extends BaseProduct {
  demandaDiaria: number;
  demanda7: number;
  demanda14: number;
  demanda30: number;
  cobertura: number;
  rotacion: number;
  riesgo: RiskLevel;
  riesgoScore: number;
  probQuiebre: number;
  diasHastaQuiebre: number;
  sobrestock: boolean;
  cantidadRecomendada: number;
  costoReposicion: number;
  prioridad: number;
  margen: number;
  valorInventario: number;
  puntoReorden: number;
  stockSeguridad: number;
  factores: string[];
  /** 56 días simulados; la suma de los últimos 7 y 30 días coincide con ventas7 y ventas30. */
  historial: { dia: string; ventas: number }[];
  forecast: { dia: string; pronostico: number; min: number; max: number }[];
}

export const round = (n: number, d = 1) => Math.round(n * 10 ** d) / 10 ** d;

/** Días de ciclo que cubre cada compra, además del lead time. */
export const CICLO_DIAS = 14;
/** Umbrales de sobrestock (Gestor de Inventario). */
export const SOBRESTOCK = { coberturaMin: 45, rotacionMax: 1.1, fraccionStockMax: 0.6 };

// ---------------------------------------------------------------------------
// Predictor de Demanda
// ---------------------------------------------------------------------------

/** Demanda diaria: promedio ponderado 65 % corto plazo (7 d) y 35 % largo plazo (30 d) + tendencia. */
export function pronosticarDemanda(v: { ventas7: number; ventas30: number; tendencia: number }) {
  const corto = v.ventas7 / 7;
  const largo = v.ventas30 / 30;
  const base = corto * 0.65 + largo * 0.35;
  const demandaDiaria = round(base * (1 + v.tendencia * 0.5), 2);
  return {
    demandaDiaria,
    demanda7: Math.round(demandaDiaria * 7 * (1 + v.tendencia * 0.15)),
    demanda14: Math.round(demandaDiaria * 14 * (1 + v.tendencia * 0.25)),
    demanda30: Math.round(demandaDiaria * 30 * (1 + v.tendencia * 0.4)),
  };
}

/** Riesgo de quiebre según la holgura entre cobertura y lead time. */
export function calcularRiesgo(i: {
  cobertura: number;
  leadTime: number;
  stock: number;
  stockMin: number;
  tendencia: number;
}) {
  const holgura = i.cobertura - i.leadTime;
  let score = 0;
  if (holgura <= 0) score = 95 - Math.min(10, i.cobertura * 2);
  else if (holgura <= 3) score = 82 - holgura * 4;
  else if (holgura <= 8) score = 66 - (holgura - 3) * 4;
  else if (holgura <= 20) score = 46 - (holgura - 8) * 2;
  else score = Math.max(4, 22 - (holgura - 20) * 0.5);
  if (i.stock < i.stockMin) score += 8;
  if (i.tendencia > 0.12) score += 6;
  if (i.tendencia < -0.05) score -= 4;
  const riesgoScore = Math.max(2, Math.min(98, Math.round(score)));
  const riesgo: RiskLevel =
    riesgoScore >= 78
      ? "critico"
      : riesgoScore >= 60
        ? "alto"
        : riesgoScore >= 38
          ? "moderado"
          : "saludable";
  return {
    riesgo,
    riesgoScore,
    probQuiebre: Math.max(1, Math.min(97, Math.round(riesgoScore * 0.96))),
    diasHastaQuiebre: Math.max(0, Math.floor(i.cobertura)),
  };
}

// ---------------------------------------------------------------------------
// Analista de Ventas
// ---------------------------------------------------------------------------

/** Rotación mensual: unidades vendidas en 30 días / stock actual. */
export function calcularRotacion(ventas30: number, stock: number) {
  return round(ventas30 / Math.max(stock, 1), 2);
}

// ---------------------------------------------------------------------------
// Gestor de Inventario
// ---------------------------------------------------------------------------

export function calcularCobertura(stock: number, demandaDiaria: number) {
  return round(stock / Math.max(demandaDiaria, 0.1), 1);
}

export function esSobrestock(i: {
  cobertura: number;
  rotacion: number;
  stock: number;
  stockMax: number;
}) {
  return (
    i.cobertura > SOBRESTOCK.coberturaMin &&
    i.rotacion < SOBRESTOCK.rotacionMax &&
    i.stock > i.stockMax * SOBRESTOCK.fraccionStockMax
  );
}

// ---------------------------------------------------------------------------
// Agente de Reposición
// ---------------------------------------------------------------------------

/**
 * Cantidad = demanda diaria × (lead time + ciclo) + stock de seguridad − stock,
 * redondeada a múltiplos de 10 y limitada por el stock máximo. Cero si hay sobrestock.
 */
export function calcularReposicion(i: {
  demandaDiaria: number;
  leadTime: number;
  stock: number;
  stockMax: number;
  precioCompra: number;
  sobrestock: boolean;
}) {
  const stockSeguridad = Math.ceil(i.demandaDiaria * Math.sqrt(i.leadTime) * 0.9);
  const puntoReorden = Math.ceil(i.demandaDiaria * i.leadTime + stockSeguridad);
  const objetivo = Math.ceil(i.demandaDiaria * (i.leadTime + CICLO_DIAS) + stockSeguridad);
  let cantidad = Math.max(0, objetivo - i.stock);
  cantidad = Math.min(cantidad, i.stockMax - i.stock);
  cantidad = cantidad > 0 ? Math.ceil(cantidad / 10) * 10 : 0;
  if (i.sobrestock) cantidad = 0;
  return {
    stockSeguridad,
    puntoReorden,
    objetivo,
    cantidadRecomendada: cantidad,
    costoReposicion: round(cantidad * i.precioCompra, 2),
  };
}

export function calcularPrioridad(riesgoScore: number, rotacion: number) {
  return Math.round(riesgoScore * 0.7 + Math.min(30, rotacion * 12));
}

// ---------------------------------------------------------------------------
// Historial simulado (coherente con ventas7 y ventas30)
// ---------------------------------------------------------------------------

/** PRNG determinista para que el historial no cambie entre renders/SSR. */
function seedFrom(sku: string) {
  let h = 2166136261;
  for (let i = 0; i < sku.length; i++) {
    h ^= sku.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export const HISTORIAL_DIAS = 56;
/** Día de la semana del índice i del historial (0 = domingo, 6 = sábado). */
export const diaSemana = (i: number) => (i + 1) % 7;
export const esFinDeSemana = (i: number) => {
  const d = diaSemana(i);
  return d === 0 || d === 6;
};

/** Reparte `total` en enteros proporcionales a `pesos` (método del mayor resto). */
function repartirEntero(pesos: number[], total: number): number[] {
  const suma = pesos.reduce((a, v) => a + v, 0);
  if (total <= 0 || suma <= 0) return pesos.map(() => 0);
  const exactos = pesos.map((w) => (w / suma) * total);
  const base = exactos.map(Math.floor);
  let resto = total - base.reduce((a, v) => a + v, 0);
  const orden = exactos.map((v, i) => ({ i, f: v - Math.floor(v) })).sort((a, b) => b.f - a.f);
  for (const { i } of orden) {
    if (resto <= 0) break;
    base[i] = (base[i] ?? 0) + 1;
    resto--;
  }
  return base;
}

/**
 * 56 días de ventas simuladas con fin de semana más alto, tendencia y ruido.
 * Se escala por tramos para que los últimos 7 días sumen ventas7 y los últimos 30
 * sumen ventas30; el tramo anterior conserva el nivel y la tendencia.
 */
export function generarHistorial(b: BaseProduct): number[] {
  const rand = rng(seedFrom(b.sku));
  const raw: number[] = [];
  for (let i = 0; i < HISTORIAL_DIAS; i++) {
    const finde = esFinDeSemana(i) ? 1.22 : 1;
    const drift = 1 + b.tendencia * ((i + 1) / HISTORIAL_DIAS);
    raw.push(finde * drift * (0.82 + rand() * 0.36));
  }
  const n = HISTORIAL_DIAS;
  const tramoA = raw.slice(n - 7); // últimos 7 días
  const tramoB = raw.slice(n - 30, n - 7); // días 8 a 30
  const tramoC = raw.slice(0, n - 30); // días 31 a 56
  const objetivoB = Math.max(0, b.ventas30 - b.ventas7);
  const sumaB = tramoB.reduce((a, v) => a + v, 0);
  const escalaB = sumaB > 0 ? objetivoB / sumaB : 0;
  const objetivoC = Math.round(tramoC.reduce((a, v) => a + v, 0) * escalaB);
  return [
    ...repartirEntero(tramoC, objetivoC),
    ...repartirEntero(tramoB, objetivoB),
    ...repartirEntero(tramoA, b.ventas7),
  ];
}

/** Factor fin de semana / día laborable estimado de una serie (acotado a 0.8–1.6). */
export function factorFinDeSemana(serie: number[], desde = 0) {
  let fin = 0;
  let nFin = 0;
  let lab = 0;
  let nLab = 0;
  serie.forEach((v, k) => {
    if (esFinDeSemana(desde + k)) {
      fin += v;
      nFin++;
    } else {
      lab += v;
      nLab++;
    }
  });
  if (!nFin || !nLab || lab <= 0) return 1;
  return Math.max(0.8, Math.min(1.6, fin / nFin / (lab / nLab)));
}

// ---------------------------------------------------------------------------
// Producto completo para las pantallas
// ---------------------------------------------------------------------------

export function deriveProduct(b: BaseProduct): Product {
  const demanda = pronosticarDemanda(b);
  const rotacion = calcularRotacion(b.ventas30, b.stock);
  const cobertura = calcularCobertura(b.stock, demanda.demandaDiaria);
  const riesgo = calcularRiesgo({ ...b, cobertura });
  const sobrestock = esSobrestock({ cobertura, rotacion, stock: b.stock, stockMax: b.stockMax });
  const repo = calcularReposicion({
    demandaDiaria: demanda.demandaDiaria,
    leadTime: b.leadTime,
    stock: b.stock,
    stockMax: b.stockMax,
    precioCompra: b.precioCompra,
    sobrestock,
  });
  const margen = round(((b.precioVenta - b.precioCompra) / b.precioVenta) * 100, 1);
  const valorInventario = round(b.stock * b.precioCompra, 2);
  const prioridad = calcularPrioridad(riesgo.riesgoScore, rotacion);

  const factores: string[] = [];
  factores.push(
    `Cobertura actual de ${cobertura} días frente a un lead time de ${b.leadTime} días.`,
  );
  if (b.stock < b.stockMin)
    factores.push(`Stock (${b.stock}) por debajo del mínimo operativo (${b.stockMin}).`);
  if (b.tendencia > 0.08)
    factores.push(
      `Tendencia de demanda al alza: +${Math.round(b.tendencia * 100)}% en las últimas semanas.`,
    );
  if (b.tendencia < -0.03)
    factores.push(`Tendencia de demanda a la baja: ${Math.round(b.tendencia * 100)}%.`);
  factores.push(`Rotación de ${rotacion} veces al mes (${b.ventas30} unidades en 30 días).`);
  factores.push(`Stock de seguridad calculado en ${repo.stockSeguridad} unidades.`);
  if (sobrestock)
    factores.push(
      `Capital inmovilizado estimado: S/ ${valorInventario.toFixed(0)} en un producto de baja salida.`,
    );
  factores.push(`Estacionalidad registrada: ${b.estacionalidad.toLowerCase()}.`);

  const serie = generarHistorial(b);
  const historial = serie.map((ventas, i) => ({ dia: `D-${HISTORIAL_DIAS - 1 - i}`, ventas }));

  // Pronóstico diario: la demanda diaria repartida según el patrón semanal estimado del historial.
  const fw = factorFinDeSemana(serie.slice(-28), HISTORIAL_DIAS - 28);
  const normal = (5 + 2 * fw) / 7;
  const forecast: Product["forecast"] = [];
  for (let i = 1; i <= 30; i++) {
    const idx = HISTORIAL_DIAS - 1 + i;
    const drift = 1 + b.tendencia * (i / 30);
    const p = ((demanda.demandaDiaria * (esFinDeSemana(idx) ? fw : 1)) / normal) * drift;
    const banda = p * (0.1 + i * 0.006);
    forecast.push({
      dia: `+${i}`,
      pronostico: round(p, 1),
      min: round(Math.max(0, p - banda), 1),
      max: round(p + banda, 1),
    });
  }

  return {
    ...b,
    ...demanda,
    cobertura,
    rotacion,
    ...riesgo,
    sobrestock,
    cantidadRecomendada: repo.cantidadRecomendada,
    costoReposicion: repo.costoReposicion,
    prioridad,
    margen,
    valorInventario,
    puntoReorden: repo.puntoReorden,
    stockSeguridad: repo.stockSeguridad,
    factores,
    historial,
    forecast,
  };
}

export const RISK_LABEL: Record<RiskLevel, string> = {
  critico: "Crítico",
  alto: "Alto",
  moderado: "Moderado",
  saludable: "Saludable",
};

export interface Metrics {
  totalSkus: number;
  criticos: number;
  altos: number;
  moderados: number;
  saludables: number;
  sobrestock: number;
  coberturaPromedio: number;
  riesgoMedio: number;
  valorInventario: number;
  capitalInmovilizado: number;
  pedidosPendientes: number;
  costoPendiente: number;
  ventas30: number;
  unidadesEnRiesgo: number;
}

export function computeMetrics(products: Product[]): Metrics {
  const criticos = products.filter((p) => p.riesgo === "critico");
  const altos = products.filter((p) => p.riesgo === "alto");
  const moderados = products.filter((p) => p.riesgo === "moderado");
  const saludables = products.filter((p) => p.riesgo === "saludable");
  const sobrestock = products.filter((p) => p.sobrestock);
  const pendientes = products.filter((p) => p.cantidadRecomendada > 0);
  return {
    totalSkus: products.length,
    criticos: criticos.length,
    altos: altos.length,
    moderados: moderados.length,
    saludables: saludables.length,
    sobrestock: sobrestock.length,
    coberturaPromedio: round(
      products.reduce((a, p) => a + p.cobertura, 0) / Math.max(products.length, 1),
      1,
    ),
    riesgoMedio: Math.round(
      products.reduce((a, p) => a + p.riesgoScore, 0) / Math.max(products.length, 1),
    ),
    valorInventario: Math.round(products.reduce((a, p) => a + p.valorInventario, 0)),
    capitalInmovilizado: Math.round(sobrestock.reduce((a, p) => a + p.valorInventario, 0)),
    pedidosPendientes: pendientes.length,
    costoPendiente: Math.round(pendientes.reduce((a, p) => a + p.costoReposicion, 0)),
    ventas30: products.reduce((a, p) => a + p.ventas30, 0),
    unidadesEnRiesgo: criticos.concat(altos).reduce((a, p) => a + p.cantidadRecomendada, 0),
  };
}

// ---------------------------------------------------------------------------
// Backtest del pronóstico
// ---------------------------------------------------------------------------

/**
 * Evaluación del pronóstico con backtest: los parámetros se ESTIMAN con los
 * primeros 42 días (nivel, patrón semanal y tendencia) y se mide el error en los
 * 14 días siguientes. No se usa el campo `tendencia` de la semilla, para no
 * evaluar el método con el mismo dato que generó la serie.
 * El historial es simulado: las métricas miden el método, no ventas reales.
 */
export interface ModelEval {
  modelo: string;
  mae: number;
  rmse: number;
  wape: number;
  precision: number;
}

export const BT_TRAIN = 42;

const media = (xs: number[]) => (xs.length ? xs.reduce((a, v) => a + v, 0) / xs.length : 0);

/** Parámetros del método del sistema estimados con los datos de ajuste. */
export function ajustarPronostico(train: number[]) {
  const ventana = train.slice(-28);
  const desde = train.length - ventana.length;
  const fw = factorFinDeSemana(ventana, desde);
  const normal = (5 + 2 * fw) / 7;
  const nivel = (media(train.slice(-7)) * 0.65 + media(train.slice(-30)) * 0.35) / normal;
  // Tendencia: pendiente de una regresión lineal sobre la serie desestacionalizada.
  const ys = ventana.map((v, k) => v / (esFinDeSemana(desde + k) ? fw : 1));
  const xm = (ys.length - 1) / 2;
  const ym = media(ys);
  let num = 0;
  let den = 0;
  ys.forEach((y, k) => {
    num += (k - xm) * (y - ym);
    den += (k - xm) ** 2;
  });
  const pendienteRel = ym > 0 && den > 0 ? num / den / ym : 0;
  return { fw, nivel, pendienteRel: Math.max(-0.01, Math.min(0.01, pendienteRel)) };
}

function forecastSistema(serie: number[], idx: number) {
  const { fw, nivel, pendienteRel } = ajustarPronostico(serie.slice(0, BT_TRAIN));
  const h = idx - BT_TRAIN + 1;
  return nivel * (esFinDeSemana(idx) ? fw : 1) * (1 + pendienteRel * h);
}

const METODOS: { modelo: string; f: (serie: number[], idx: number) => number }[] = [
  { modelo: "Naive estacional (mismo día de la semana previa)", f: (s, i) => s[i - 7] ?? 0 },
  {
    modelo: "Promedio móvil 7 días",
    f: (s) => media(s.slice(BT_TRAIN - 7, BT_TRAIN)),
  },
  { modelo: "Ponderado 7/30 + patrón semanal + tendencia estimada", f: forecastSistema },
];

/** Serie real vs pronóstico del método del sistema en los 14 días de prueba. */
export function backtestProduct(p: Product) {
  const serie = p.historial.map((h) => h.ventas);
  const out: { dia: string; real: number; pred: number }[] = [];
  for (let i = BT_TRAIN; i < serie.length; i++) {
    out.push({
      dia: p.historial[i]?.dia ?? `D${i}`,
      real: serie[i] ?? 0,
      pred: round(forecastSistema(serie, i), 1),
    });
  }
  return out;
}

export function computeModelMetrics(products: Product[]) {
  const comparativa: ModelEval[] = METODOS.map(({ modelo, f }) => {
    let abs = 0;
    let sq = 0;
    let real = 0;
    let n = 0;
    for (const p of products) {
      const serie = p.historial.map((h) => h.ventas);
      for (let i = BT_TRAIN; i < serie.length; i++) {
        const e = (serie[i] ?? 0) - f(serie, i);
        abs += Math.abs(e);
        sq += e * e;
        real += serie[i] ?? 0;
        n++;
      }
    }
    const wape = real > 0 ? (abs / real) * 100 : 0;
    return {
      modelo,
      mae: round(abs / Math.max(n, 1), 1),
      rmse: round(Math.sqrt(sq / Math.max(n, 1)), 1),
      wape: round(wape, 1),
      precision: round(100 - wape, 1),
    };
  });
  const sistema = comparativa[comparativa.length - 1]!;
  const mejor = [...comparativa].sort((a, b) => a.wape - b.wape)[0]!;
  return {
    modelo: "Promedio ponderado 7/30 días + patrón semanal + tendencia",
    version: "reglas v2",
    evaluacion: "Backtest 14 días",
    ventanaValidacion: `${BT_TRAIN} días de ajuste / 14 de prueba · ${products.length} SKUs · historial simulado`,
    mae: sistema.mae,
    rmse: sistema.rmse,
    wape: sistema.wape,
    precision: sistema.precision,
    mejorMetodo: mejor.modelo,
    comparativa,
    variables: [
      "Ventas de los últimos 7 días",
      "Ventas de los últimos 30 días",
      "Patrón semanal (fin de semana vs. laborables)",
      "Tendencia",
      "Stock disponible",
      "Stock mínimo y máximo",
      "Tiempo de reposición (lead time)",
    ],
  };
}

/**
 * Serie semanal del catálogo para el dashboard.
 *  - demanda: ventas reales del historial (8 semanas).
 *  - pronostico: en semanas pasadas, pronóstico a una semana hecho SOLO con los datos
 *    anteriores a esa semana; en semanas futuras, la suma del pronóstico diario.
 *  - stock: solo el actual (S-0) y su proyección sin reposición. No hay historial de stock.
 */
export function aggregateSeries(PRODUCTS: Product[]) {
  const semanas: {
    semana: string;
    demanda: number | null;
    pronostico: number | null;
    stock: number | null;
  }[] = [];
  const totalStock = PRODUCTS.reduce((a, p) => a + p.stock, 0);
  const n = HISTORIAL_DIAS;
  for (let i = 7; i >= 0; i--) {
    const fin = n - 1 - i * 7; // último día de la semana
    const inicio = fin - 6;
    let demanda = 0;
    let pronostico = 0;
    let conPronostico = inicio >= 14;
    for (const p of PRODUCTS) {
      const serie = p.historial.map((h) => h.ventas);
      demanda += serie.slice(inicio, fin + 1).reduce((a, v) => a + v, 0);
      if (conPronostico) {
        const previo = serie.slice(0, inicio);
        pronostico += (media(previo.slice(-7)) * 0.65 + media(previo.slice(-30)) * 0.35) * 7;
      }
    }
    if (!PRODUCTS.length) conPronostico = false;
    semanas.push({
      semana: `S-${i}`,
      demanda,
      pronostico: conPronostico ? Math.round(pronostico) : null,
      stock: i === 0 ? totalStock : null,
    });
  }
  let acumulado = 0;
  for (let w = 1; w <= 4; w++) {
    const semana = PRODUCTS.reduce(
      (a, p) => a + p.forecast.slice((w - 1) * 7, w * 7).reduce((s, f) => s + f.pronostico, 0),
      0,
    );
    acumulado += semana;
    semanas.push({
      semana: `S+${w}`,
      demanda: null,
      pronostico: Math.round(semana),
      stock: Math.round(Math.max(0, totalStock - acumulado)),
    });
  }
  return semanas;
}
