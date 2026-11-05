/**
 * Intelli-Stock — capa de datos simulada pero coherente.
 *
 * Todas las métricas derivadas (demanda prevista, cobertura, riesgo,
 * rotación, cantidad recomendada) se CALCULAN a partir de los datos base,
 * de modo que nunca se contradicen entre sí:
 *  - poco stock + alta demanda  => riesgo alto/crítico
 *  - mucho stock + baja demanda => sobrestock
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
  historial: { dia: string; ventas: number }[];
  forecast: { dia: string; pronostico: number; min: number; max: number }[];
  reposiciones: { fecha: string; cantidad: number; costo: number; estado: string }[];
}

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

const round = (n: number, d = 1) => Math.round(n * 10 ** d) / 10 ** d;

export function deriveProduct(b: BaseProduct): Product {
  const rand = rng(seedFrom(b.sku));

  // Demanda diaria: promedio ponderado entre corto y largo plazo + tendencia.
  const corto = b.ventas7 / 7;
  const largo = b.ventas30 / 30;
  const base = corto * 0.65 + largo * 0.35;
  const demandaDiaria = round(base * (1 + b.tendencia * 0.5), 2);

  const demanda7 = Math.round(demandaDiaria * 7 * (1 + b.tendencia * 0.15));
  const demanda14 = Math.round(demandaDiaria * 14 * (1 + b.tendencia * 0.25));
  const demanda30 = Math.round(demandaDiaria * 30 * (1 + b.tendencia * 0.4));

  const cobertura = round(b.stock / Math.max(demandaDiaria, 0.1), 1);
  const rotacion = round((b.ventas30 * 12) / Math.max(b.stock, 1) / 12, 2); // veces/mes
  const diasHastaQuiebre = Math.max(0, Math.floor(cobertura));

  // Stock de seguridad: cubre variabilidad durante el lead time.
  const stockSeguridad = Math.ceil(demandaDiaria * Math.sqrt(b.leadTime) * 0.9);
  const puntoReorden = Math.ceil(demandaDiaria * b.leadTime + stockSeguridad);

  // Riesgo: relación entre cobertura y el tiempo que tarda reponer.
  const holgura = cobertura - b.leadTime;
  let score = 0;
  if (holgura <= 0) score = 95 - Math.min(10, cobertura * 2);
  else if (holgura <= 3) score = 82 - holgura * 4;
  else if (holgura <= 8) score = 66 - (holgura - 3) * 4;
  else if (holgura <= 20) score = 46 - (holgura - 8) * 2;
  else score = Math.max(4, 22 - (holgura - 20) * 0.5);
  if (b.stock < b.stockMin) score += 8;
  if (b.tendencia > 0.12) score += 6;
  if (b.tendencia < -0.05) score -= 4;
  score = Math.max(2, Math.min(98, Math.round(score)));

  const riesgo: RiskLevel =
    score >= 78 ? "critico" : score >= 60 ? "alto" : score >= 38 ? "moderado" : "saludable";

  const probQuiebre = Math.max(1, Math.min(97, Math.round(score * 0.96)));

  // Sobrestock: mucha cobertura, poca rotación y stock por encima del máximo útil.
  const sobrestock = cobertura > 45 && rotacion < 1.1 && b.stock > b.stockMax * 0.6;

  // Cantidad recomendada: cubrir horizonte objetivo (lead time + 14 días de ciclo)
  // más stock de seguridad, menos lo que ya hay, respetando el stock máximo.
  const horizonte = b.leadTime + 14;
  const objetivo = Math.ceil(demandaDiaria * horizonte + stockSeguridad);
  let cantidadRecomendada = Math.max(0, objetivo - b.stock);
  cantidadRecomendada = Math.min(cantidadRecomendada, b.stockMax - b.stock);
  cantidadRecomendada = cantidadRecomendada > 0 ? Math.ceil(cantidadRecomendada / 10) * 10 : 0;
  if (sobrestock) cantidadRecomendada = 0;

  const costoReposicion = round(cantidadRecomendada * b.precioCompra, 2);
  const margen = round(((b.precioVenta - b.precioCompra) / b.precioVenta) * 100, 1);
  const valorInventario = round(b.stock * b.precioCompra, 2);
  const prioridad = Math.round(score * 0.7 + Math.min(30, rotacion * 12));

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
  factores.push(`Stock de seguridad calculado en ${stockSeguridad} unidades.`);
  if (sobrestock)
    factores.push(
      `Capital inmovilizado estimado: ${valorInventario.toFixed(0)} en un producto de baja salida.`,
    );
  factores.push(`Estacionalidad registrada: ${b.estacionalidad.toLowerCase()}.`);

  // Historial de 56 días (8 semanas) determinista.
  const historial: { dia: string; ventas: number }[] = [];
  for (let i = 55; i >= 0; i--) {
    const dow = (56 - i) % 7;
    const finde = dow === 0 || dow === 6 ? 1.22 : 1;
    const drift = 1 + b.tendencia * ((56 - i) / 56);
    const ruido = 0.82 + rand() * 0.36;
    historial.push({
      dia: `D-${i}`,
      ventas: Math.max(0, Math.round(largo * finde * drift * ruido)),
    });
  }

  const forecast: { dia: string; pronostico: number; min: number; max: number }[] = [];
  for (let i = 1; i <= 30; i++) {
    const dow = i % 7;
    const finde = dow === 0 || dow === 6 ? 1.2 : 1;
    const drift = 1 + b.tendencia * (i / 30);
    const p = demandaDiaria * finde * drift;
    const banda = p * (0.1 + i * 0.006);
    forecast.push({
      dia: `+${i}`,
      pronostico: round(p, 1),
      min: round(Math.max(0, p - banda), 1),
      max: round(p + banda, 1),
    });
  }

  const reposiciones = [
    {
      fecha: "2026-08-12",
      cantidad: Math.ceil((objetivo * 0.6) / 10) * 10,
      costo: round(Math.ceil(objetivo * 0.6) * b.precioCompra, 2),
      estado: "Recibido",
    },
    {
      fecha: "2026-07-21",
      cantidad: Math.ceil((objetivo * 0.45) / 10) * 10,
      costo: round(Math.ceil(objetivo * 0.45) * b.precioCompra, 2),
      estado: "Recibido",
    },
    {
      fecha: "2026-06-30",
      cantidad: Math.ceil((objetivo * 0.5) / 10) * 10,
      costo: round(Math.ceil(objetivo * 0.5) * b.precioCompra, 2),
      estado: "Recibido",
    },
  ];

  return {
    ...b,
    demandaDiaria,
    demanda7,
    demanda14,
    demanda30,
    cobertura,
    rotacion,
    riesgo,
    riesgoScore: score,
    probQuiebre,
    diasHastaQuiebre,
    sobrestock,
    cantidadRecomendada,
    costoReposicion,
    prioridad,
    margen,
    valorInventario,
    puntoReorden,
    stockSeguridad,
    factores,
    historial,
    forecast,
    reposiciones,
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

/** Métricas del motor predictivo (evaluación con validación temporal). */
export const MODEL_METRICS = {
  modelo: "LightGBM + baseline promedio móvil",
  version: "v2.4",
  entrenado: "2026-09-02",
  mae: 3.1,
  rmse: 5.4,
  wape: 5.8,
  precision: 94.2,
  ventanaValidacion: "Validación temporal, 6 folds (rolling origin)",
  variables: [
    "Ventas históricas diarias",
    "Día de la semana",
    "Tendencia",
    "Estacionalidad",
    "Stock disponible",
    "Promociones activas",
    "Tiempo de reposición (lead time)",
    "Stock mínimo",
  ],
  comparativa: [
    { modelo: "Naive (última semana)", mae: 7.9, rmse: 12.1, wape: 14.2, precision: 85.8 },
    { modelo: "Promedio móvil 7d", mae: 6.2, rmse: 9.4, wape: 11.3, precision: 88.7 },
    { modelo: "XGBoost", mae: 3.5, rmse: 5.9, wape: 6.4, precision: 93.6 },
    { modelo: "LightGBM (seleccionado)", mae: 3.1, rmse: 5.4, wape: 5.8, precision: 94.2 },
  ],
};

/** Serie agregada demanda histórica vs pronóstico vs stock (8 semanas + 4 futuras). */
export function aggregateSeries(PRODUCTS: Product[]) {
  const semanas: { semana: string; demanda: number | null; pronostico: number; stock: number }[] =
    [];
  const totalStock = PRODUCTS.reduce((a, p) => a + p.stock, 0);
  const demandaSemanal = PRODUCTS.reduce((a, p) => a + p.demandaDiaria * 7, 0);
  for (let i = 7; i >= 0; i--) {
    const idxStart = 55 - i * 7;
    const demanda = PRODUCTS.reduce((a, p) => {
      let s = 0;
      for (let d = 0; d < 7; d++) s += p.historial[Math.max(0, idxStart - 6 + d)]?.ventas ?? 0;
      return a + s;
    }, 0);
    semanas.push({
      semana: `S-${i}`,
      demanda,
      pronostico: Math.round(demanda * (0.97 + (i % 3) * 0.02)),
      stock: Math.round(totalStock * (0.82 + i * 0.025)),
    });
  }
  for (let i = 1; i <= 4; i++) {
    semanas.push({
      semana: `S+${i}`,
      demanda: null,
      pronostico: Math.round(demandaSemanal * (1 + i * 0.035)),
      stock: Math.round(Math.max(0, totalStock - demandaSemanal * i)),
    });
  }
  return semanas;
}
