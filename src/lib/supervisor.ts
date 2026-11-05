/**
 * Agente Supervisor — interpreta la consulta en lenguaje natural,
 * decide qué agentes/herramientas invocar y consolida la respuesta
 * usando SIEMPRE los datos del sistema (nunca respuestas genéricas).
 *
 * Flujo del documento:
 * USUARIO → SUPERVISOR → AGENTES ESPECIALIZADOS → RESULTADOS → SUPERVISOR → USUARIO
 */

import { computeMetrics, MODEL_METRICS, type Product } from "./inventory";

export type AgentId = "supervisor" | "ventas" | "predictor" | "inventario" | "reposicion";

export interface AgentDef {
  id: AgentId;
  nombre: string;
  corto: string;
  inicial: string;
  responsabilidad: string;
  herramientas: string[];
  estadoTexto: string;
}

export const AGENTS: AgentDef[] = [
  {
    id: "supervisor",
    nombre: "Agente Supervisor",
    corto: "Supervisor",
    inicial: "S",
    responsabilidad: "Coordina agentes, interpreta consultas y consolida resultados.",
    herramientas: ["LLM + Function Calling", "generar_reporte()", "APIs internas"],
    estadoTexto: "Generando recomendación…",
  },
  {
    id: "ventas",
    nombre: "Agente Analista de Ventas",
    corto: "Analista de Ventas",
    inicial: "A",
    responsabilidad: "Analiza ventas, rotación y tendencias.",
    herramientas: ["consultar_ventas()", "analizar_rotacion()", "SQL + Pandas"],
    estadoTexto: "Analizando ventas…",
  },
  {
    id: "predictor",
    nombre: "Agente Predictor de Demanda",
    corto: "Predictor",
    inicial: "P",
    responsabilidad: "Pronostica demanda y aporta el riesgo de quiebre.",
    herramientas: ["predecir_demanda()", "calcular_riesgo_stock()", "LightGBM"],
    estadoTexto: "Prediciendo demanda…",
  },
  {
    id: "inventario",
    nombre: "Agente Gestor de Inventario",
    corto: "Gestor de Inventario",
    inicial: "G",
    responsabilidad: "Consulta stock, stock mínimo y cobertura.",
    herramientas: ["consultar_inventario()", "API de inventario"],
    estadoTexto: "Consultando inventario…",
  },
  {
    id: "reposicion",
    nombre: "Agente de Reposición",
    corto: "Reposición",
    inicial: "R",
    responsabilidad: "Calcula y prioriza cantidades y momentos de pedido.",
    herramientas: ["calcular_reposicion()", "Reglas de negocio + optimización"],
    estadoTexto: "Calculando reposición…",
  },
];

export const AGENT_BY_ID = Object.fromEntries(AGENTS.map((a) => [a.id, a])) as Record<
  AgentId,
  AgentDef
>;

export interface SupervisorStep {
  agent: AgentId;
  texto: string;
  detalle: string;
}

export interface SupervisorAnswer {
  intencion: string;
  pasos: SupervisorStep[];
  titulo: string;
  resumen: string;
  bullets: string[];
  productos: Product[];
  recomendacion?:
    | {
        sku: string;
        nombre: string;
        cantidad: number;
        costo: number;
        cuando: string;
        prioridad: string;
        porque: string;
      }
    | undefined;
  nota?: string | undefined;
}

const money = (n: number) =>
  n.toLocaleString("es-PE", { style: "currency", currency: "PEN", maximumFractionDigits: 0 });

function norm(s: string) {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

/** Busca un producto mencionado por nombre o SKU en la consulta. */
export function matchProduct(q: string, PRODUCTS: Product[]): Product | undefined {
  const n = norm(q);
  const bySku = PRODUCTS.find((p) => n.includes(p.sku.toLowerCase()));
  if (bySku) return bySku;
  let best: { p: Product; score: number } | undefined;
  for (const p of PRODUCTS) {
    const words = norm(p.nombre)
      .split(/[\s\d]+/)
      .filter((w) => w.length > 3);
    let score = 0;
    for (const w of words) if (n.includes(w)) score += w.length;
    if (score > 0 && (!best || score > best.score)) best = { p, score };
  }
  return best?.p;
}

const step = (agent: AgentId, texto: string, detalle: string): SupervisorStep => ({
  agent,
  texto,
  detalle,
});

const cuandoComprar = (p: Product) => {
  const margen = Math.floor(p.cobertura - p.leadTime);
  if (margen <= 0) return "Hoy mismo (ya estás dentro del lead time)";
  if (margen <= 2) return `En máximo ${margen} día(s)`;
  return `Antes de ${margen} días (punto de reorden: ${p.puntoReorden} u.)`;
};

const prioridadTexto = (p: Product) =>
  p.riesgo === "critico"
    ? "Máxima"
    : p.riesgo === "alto"
      ? "Alta"
      : p.riesgo === "moderado"
        ? "Media"
        : "Baja";

function recoOf(p: Product) {
  return {
    sku: p.sku,
    nombre: p.nombre,
    cantidad: p.cantidadRecomendada,
    costo: p.costoReposicion,
    cuando: cuandoComprar(p),
    prioridad: prioridadTexto(p),
    porque: `Cobertura ${p.cobertura}d vs lead time ${p.leadTime}d. Demanda prevista 7d: ${p.demanda7} u. Stock de seguridad: ${p.stockSeguridad} u.`,
  };
}

export const SUGERENCIAS = [
  "¿Qué productos debo reponer esta semana?",
  "¿Qué productos tienen riesgo crítico?",
  "¿Cuánto debería comprar de café?",
  "¿Por qué recomiendas esa cantidad?",
  "¿Qué productos tienen sobrestock?",
  "Muéstrame los productos con menor cobertura",
];

export function askSupervisor(
  query: string,
  PRODUCTS: Product[],
  contexto?: Product,
): SupervisorAnswer {
  const METRICS = computeMetrics(PRODUCTS);
  const n = norm(query);
  const producto =
    matchProduct(query, PRODUCTS) ??
    (/(esa|ese|eso|ello|lo mismo|por que|porque)/.test(n) ? contexto : undefined);

  const criticos = PRODUCTS.filter((p) => p.riesgo === "critico").sort(
    (a, b) => b.riesgoScore - a.riesgoScore,
  );
  const reponer = PRODUCTS.filter((p) => p.cantidadRecomendada > 0).sort(
    (a, b) => b.prioridad - a.prioridad,
  );
  const sobrestock = PRODUCTS.filter((p) => p.sobrestock).sort(
    (a, b) => b.valorInventario - a.valorInventario,
  );
  const menorCobertura = [...PRODUCTS].sort((a, b) => a.cobertura - b.cobertura);

  // --- ¿Por qué esa cantidad? -------------------------------------------
  if (/(por que|porqu|explica|justific|razon|como calcul)/.test(n)) {
    const p = producto ?? criticos[0] ?? reponer[0];
    if (!p) throw new Error("No hay productos disponibles para explicar una recomendación.");
    return {
      intencion: "Explicar la recomendación (explicar_recomendacion)",
      pasos: [
        step(
          "supervisor",
          "Interpretando la consulta…",
          "Intención: explicación de una recomendación existente.",
        ),
        step(
          "predictor",
          "Prediciendo demanda…",
          `Demanda diaria estimada ${p.demandaDiaria} u/día (LightGBM v2.4, WAPE ${MODEL_METRICS.wape}%).`,
        ),
        step(
          "reposicion",
          "Calculando reposición…",
          `Objetivo = demanda diaria × (lead time ${p.leadTime}d + ciclo 14d) + seguridad ${p.stockSeguridad} u.`,
        ),
        step(
          "supervisor",
          "Generando recomendación…",
          "Consolidando factores y trazabilidad del cálculo.",
        ),
      ],
      titulo: `Por qué ${p.cantidadRecomendada} unidades de ${p.nombre}`,
      resumen: `La cantidad sale de una fórmula determinística, no del modelo de lenguaje: objetivo de cobertura menos stock actual. Demanda diaria ${p.demandaDiaria} u × (lead time ${p.leadTime}d + ciclo 14d) = ${Math.ceil(p.demandaDiaria * (p.leadTime + 14))} u, más ${p.stockSeguridad} u de stock de seguridad, menos ${p.stock} u en almacén, redondeado a múltiplo de 10 y limitado por el stock máximo (${p.stockMax}).`,
      bullets: p.factores,
      productos: [p],
      recomendacion: p.cantidadRecomendada > 0 ? recoOf(p) : undefined,
      nota: "El motor predictivo entrega la demanda; el Agente de Reposición aplica reglas de negocio auditables.",
    };
  }

  // --- Sobrestock --------------------------------------------------------
  if (/(sobrestock|sobre stock|exceso|inmoviliz|baja rotacion|no se vende)/.test(n)) {
    const capital = sobrestock.reduce((a, p) => a + p.valorInventario, 0);
    return {
      intencion: "Detectar sobrestock (analizar_rotacion + consultar_inventario)",
      pasos: [
        step(
          "supervisor",
          "Interpretando la consulta…",
          "Intención: identificar exceso de inventario.",
        ),
        step(
          "ventas",
          "Analizando ventas…",
          "Rotación mensual y tendencia por SKU en los últimos 30 días.",
        ),
        step(
          "inventario",
          "Consultando inventario…",
          "Stock actual vs stock máximo y cobertura en días.",
        ),
        step(
          "supervisor",
          "Generando recomendación…",
          "Cruce de baja rotación con alta cobertura.",
        ),
      ],
      titulo: `${sobrestock.length} productos con sobrestock`,
      resumen: sobrestock.length
        ? `Detecté ${sobrestock.length} SKUs con cobertura superior a 45 días y rotación menor a 1.1×/mes. Tienen ${money(capital)} de capital inmovilizado. Mi recomendación es no reponerlos y mover el stock con promoción.`
        : "No hay productos en sobrestock según los umbrales configurados (cobertura > 45 días y rotación < 1.1×/mes).",
      bullets: sobrestock
        .slice(0, 6)
        .map(
          (p) =>
            `${p.nombre} — ${p.stock} u, cobertura ${p.cobertura}d, rotación ${p.rotacion}×/mes, ${money(p.valorInventario)} inmovilizados.`,
        ),
      productos: sobrestock,
      nota: "Ninguno de estos productos entra en la propuesta de compra de esta semana.",
    };
  }

  // --- Riesgo crítico ----------------------------------------------------
  if (/(critic|riesgo|quiebre|urgente|alerta|peligro)/.test(n) && !producto) {
    const enRiesgo = PRODUCTS.filter((p) => p.riesgo === "critico" || p.riesgo === "alto").sort(
      (a, b) => b.riesgoScore - a.riesgoScore,
    );
    return {
      intencion: "Consultar productos críticos (calcular_riesgo_stock)",
      pasos: [
        step(
          "supervisor",
          "Interpretando la consulta…",
          "Intención: detectar riesgo de quiebre de stock.",
        ),
        step(
          "inventario",
          "Consultando inventario…",
          `${METRICS.totalSkus} SKUs revisados: stock actual, mínimo y cobertura.`,
        ),
        step(
          "predictor",
          "Prediciendo demanda…",
          "Modelo LightGBM v2.4, horizonte 7/14/30 días con validación temporal.",
        ),
        step("supervisor", "Generando recomendación…", "Priorización por probabilidad de quiebre."),
      ],
      titulo: `${criticos.length} productos en riesgo crítico`,
      resumen: `De ${METRICS.totalSkus} SKUs, ${criticos.length} están en riesgo crítico y ${METRICS.altos} en riesgo alto. El caso más urgente es ${criticos[0]?.nombre ?? "—"}: ${criticos[0]?.stock ?? 0} unidades para ${criticos[0]?.cobertura ?? 0} días de venta, con ${criticos[0]?.leadTime ?? 0} días de reposición.`,
      bullets: enRiesgo
        .slice(0, 6)
        .map(
          (p) =>
            `${p.nombre} — riesgo ${p.riesgoScore}/100, quiebre en ~${p.diasHastaQuiebre}d, probabilidad ${p.probQuiebre}%, reponer ${p.cantidadRecomendada} u.`,
        ),
      productos: enRiesgo,
      recomendacion: criticos[0] ? recoOf(criticos[0]) : undefined,
      nota: "Los pedidos no se ejecutan automáticamente: requieren tu aprobación.",
    };
  }

  // --- Menor cobertura ---------------------------------------------------
  if (/(cobertura|duran|alcanza|dias de stock|menor cobertura)/.test(n) && !producto) {
    const top = menorCobertura.slice(0, 8);
    return {
      intencion: "Ranking por cobertura (consultar_inventario)",
      pasos: [
        step(
          "supervisor",
          "Interpretando la consulta…",
          "Intención: ordenar el catálogo por días de cobertura.",
        ),
        step("inventario", "Consultando inventario…", "Stock disponible por SKU."),
        step(
          "predictor",
          "Prediciendo demanda…",
          "Demanda diaria estimada para convertir stock en días.",
        ),
        step("supervisor", "Generando recomendación…", "Ordenamiento ascendente por cobertura."),
      ],
      titulo: "Productos con menor cobertura",
      resumen: `La cobertura promedio del catálogo es de ${METRICS.coberturaPromedio} días. Estos ${top.length} productos están muy por debajo y son los primeros candidatos a quiebre.`,
      bullets: top.map(
        (p) =>
          `${p.nombre} — ${p.cobertura} días (stock ${p.stock} u, demanda ${p.demandaDiaria} u/día, lead ${p.leadTime}d).`,
      ),
      productos: top,
      recomendacion: top[0]?.cantidadRecomendada ? recoOf(top[0]) : undefined,
    };
  }

  // --- Consulta sobre un producto concreto -------------------------------
  if (producto) {
    const p = producto;
    const quiebre = /(no repon|no compro|se acaba|quiebre)/.test(n);
    return {
      intencion: `Análisis de producto (${p.sku})`,
      pasos: [
        step(
          "supervisor",
          "Interpretando la consulta…",
          `Producto identificado: ${p.nombre} (${p.sku}).`,
        ),
        step(
          "ventas",
          "Analizando ventas…",
          `${p.ventas7} u en 7 días, ${p.ventas30} u en 30 días, rotación ${p.rotacion}×/mes.`,
        ),
        step(
          "predictor",
          "Prediciendo demanda…",
          `Pronóstico: ${p.demanda7} u a 7d, ${p.demanda14} u a 14d, ${p.demanda30} u a 30d.`,
        ),
        step(
          "inventario",
          "Consultando inventario…",
          `Stock ${p.stock} u (mín ${p.stockMin}, máx ${p.stockMax}), cobertura ${p.cobertura}d.`,
        ),
        step(
          "reposicion",
          "Calculando reposición…",
          `Cantidad sugerida ${p.cantidadRecomendada} u por ${money(p.costoReposicion)}.`,
        ),
        step(
          "supervisor",
          "Generando recomendación…",
          "Consolidando el resultado de los 4 agentes.",
        ),
      ],
      titulo: `${p.nombre} · ${p.sku}`,
      resumen: quiebre
        ? `Si no repones ${p.nombre}, el stock actual (${p.stock} u) se agota en aproximadamente ${p.diasHastaQuiebre} días con la demanda proyectada de ${p.demandaDiaria} u/día. La probabilidad de quiebre antes de que llegue un pedido nuevo es del ${p.probQuiebre}%.`
        : p.cantidadRecomendada > 0
          ? `Te recomiendo comprar ${p.cantidadRecomendada} unidades de ${p.nombre} por ${money(p.costoReposicion)}. Tienes ${p.stock} u en almacén, que cubren ${p.cobertura} días, y el proveedor ${p.proveedor} tarda ${p.leadTime} días en entregar.`
          : `${p.nombre} no necesita reposición ahora: ${p.stock} u cubren ${p.cobertura} días de demanda${p.sobrestock ? " y el producto está en sobrestock" : ""}.`,
      bullets: p.factores,
      productos: [p],
      recomendacion: p.cantidadRecomendada > 0 ? recoOf(p) : undefined,
      nota:
        p.cantidadRecomendada > 0
          ? "Requiere tu aprobación antes de generar la orden de compra."
          : undefined,
    };
  }

  // --- Reposición semanal (intención por defecto) ------------------------
  const top = reponer.slice(0, 6);
  const costoTotal = reponer.reduce((a, p) => a + p.costoReposicion, 0);
  return {
    intencion: "Propuesta de reposición semanal (calcular_reposicion)",
    pasos: [
      step(
        "supervisor",
        "Interpretando la consulta…",
        "Intención: plan de compra para los próximos 7 días.",
      ),
      step(
        "ventas",
        "Analizando ventas…",
        `Ventas de ${METRICS.ventas30.toLocaleString("es-PE")} u en 30 días sobre ${METRICS.totalSkus} SKUs.`,
      ),
      step(
        "predictor",
        "Prediciendo demanda…",
        `Forecast a 7/14/30 días. Precisión del modelo ${MODEL_METRICS.precision}% (WAPE ${MODEL_METRICS.wape}%).`,
      ),
      step(
        "inventario",
        "Consultando inventario…",
        `Cobertura promedio ${METRICS.coberturaPromedio} días, ${METRICS.criticos} SKUs bajo mínimo crítico.`,
      ),
      step(
        "reposicion",
        "Calculando reposición…",
        `${reponer.length} propuestas de compra por ${money(costoTotal)}.`,
      ),
      step("supervisor", "Generando recomendación…", "Priorización por riesgo y rotación."),
    ],
    titulo: `${reponer.length} productos a reponer esta semana`,
    resumen: `Debes reponer ${reponer.length} productos por un total estimado de ${money(costoTotal)}. La prioridad máxima es ${top[0]?.nombre ?? "—"}: ${top[0]?.cantidadRecomendada ?? 0} unidades, porque su cobertura (${top[0]?.cobertura ?? 0} días) ya es menor que el tiempo de entrega del proveedor.`,
    bullets: top.map(
      (p) =>
        `${p.nombre} — comprar ${p.cantidadRecomendada} u (${money(p.costoReposicion)}), ${cuandoComprar(p).toLowerCase()}, riesgo ${p.riesgoScore}/100.`,
    ),
    productos: reponer,
    recomendacion: top[0] ? recoOf(top[0]) : undefined,
    nota: "Toda compra requiere aprobación humana. El sistema no ejecuta pedidos por su cuenta.",
  };
}
