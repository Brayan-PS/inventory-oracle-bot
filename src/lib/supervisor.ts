/**
 * Agente Supervisor — tipos compartidos, catálogo de agentes y motor de reglas.
 *
 * El Supervisor principal usa Gemini (src/server/supervisor-llm.server.ts). Este
 * archivo contiene el motor de reglas de RESPALDO: se usa cuando no hay clave,
 * cuando el LLM falla o supera sus límites, o cuando el navegador no llega al
 * servidor. Responde siempre con datos del sistema, nunca con texto genérico.
 *
 * Flujo: USUARIO → SUPERVISOR → AGENTES ESPECIALIZADOS → RESULTADOS → SUPERVISOR → USUARIO
 */

import { buscarProductos, norm, sugerirProductos } from "./catalogo.ts";
import {
  computeMetrics,
  deriveProduct,
  RISK_LABEL,
  SOBRESTOCK,
  type BaseProduct,
  type Product,
} from "./inventory.ts";

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
    responsabilidad:
      "Interpreta la consulta con Gemini, decide a qué agentes delegar, verifica las cifras y consolida la respuesta.",
    herramientas: ["Gemini (function calling)", "Verificación de cifras", "Respaldo por reglas"],
    estadoTexto: "Generando recomendación…",
  },
  {
    id: "ventas",
    nombre: "Agente Analista de Ventas",
    corto: "Analista de Ventas",
    inicial: "A",
    responsabilidad:
      "Analiza ventas, rotación, tendencia y margen. Pide el stock al Gestor de Inventario para calcular la rotación.",
    herramientas: ["consultar_ventas()", "PostgreSQL (tabla products)"],
    estadoTexto: "Analizando ventas…",
  },
  {
    id: "predictor",
    nombre: "Agente Predictor de Demanda",
    corto: "Predictor",
    inicial: "P",
    responsabilidad:
      "Pronostica la demanda con las ventas que le entrega el Analista y calcula el riesgo de quiebre con la cobertura del Gestor.",
    herramientas: [
      "predecir_demanda()",
      "calcular_riesgo_stock()",
      "Promedio ponderado + tendencia",
    ],
    estadoTexto: "Prediciendo demanda…",
  },
  {
    id: "inventario",
    nombre: "Agente Gestor de Inventario",
    corto: "Gestor de Inventario",
    inicial: "G",
    responsabilidad:
      "Consulta stock, mínimos, máximos y proveedores; calcula cobertura y detecta sobrestock.",
    herramientas: ["consultar_inventario()", "buscar_producto()", "PostgreSQL"],
    estadoTexto: "Consultando inventario…",
  },
  {
    id: "reposicion",
    nombre: "Agente de Reposición",
    corto: "Reposición",
    inicial: "R",
    responsabilidad:
      "Pide demanda y riesgo al Predictor y stock al Gestor; decide cantidad, momento y prioridad de compra.",
    herramientas: ["calcular_reposicion()", "Reglas de negocio auditables"],
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

export interface Recomendacion {
  sku: string;
  nombre: string;
  cantidad: number;
  costo: number;
  cuando: string;
  prioridad: string;
  porque: string;
}

export interface SupervisorAnswer {
  intencion: string;
  pasos: SupervisorStep[];
  titulo: string;
  resumen: string;
  bullets: string[];
  productos: Product[];
  recomendacion?: Recomendacion | undefined;
  nota?: string | undefined;
}

const money = (n: number) =>
  n.toLocaleString("es-PE", { style: "currency", currency: "PEN", maximumFractionDigits: 0 });

export { norm };

/** Producto mencionado sin ambigüedad (compatibilidad: devuelve el primero). */
export function matchProduct(q: string, PRODUCTS: Product[]): Product | undefined {
  return buscarProductos(q, PRODUCTS).productos[0];
}

const step = (agent: AgentId, texto: string, detalle: string): SupervisorStep => ({
  agent,
  texto,
  detalle,
});

export const cuandoComprar = (p: { cobertura: number; leadTime: number; puntoReorden: number }) => {
  const margen = Math.floor(p.cobertura - p.leadTime);
  if (margen <= 0) return "Hoy mismo (ya estás dentro del lead time)";
  if (margen <= 2) return `En máximo ${margen} día(s)`;
  return `Antes de ${margen} días (punto de reorden: ${p.puntoReorden} u.)`;
};

export const prioridadTexto = (p: { riesgo: Product["riesgo"] }) =>
  p.riesgo === "critico"
    ? "Máxima"
    : p.riesgo === "alto"
      ? "Alta"
      : p.riesgo === "moderado"
        ? "Media"
        : "Baja";

export function recoOf(p: Product): Recomendacion {
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

/** Datos base de un producto (sin campos derivados), para recalcular escenarios. */
export function toBase(p: BaseProduct): BaseProduct {
  return {
    sku: p.sku,
    nombre: p.nombre,
    categoria: p.categoria,
    precioCompra: p.precioCompra,
    precioVenta: p.precioVenta,
    stock: p.stock,
    stockMin: p.stockMin,
    stockMax: p.stockMax,
    ventas7: p.ventas7,
    ventas30: p.ventas30,
    leadTime: p.leadTime,
    proveedor: p.proveedor,
    tendencia: p.tendencia,
    estacionalidad: p.estacionalidad,
  };
}

/** Escenario "¿qué pasa si la demanda cambia X%?": recalcula todo con ventas ajustadas. */
export function escenarioDemanda(products: BaseProduct[], pct: number): Product[] {
  const f = 1 + pct / 100;
  return products.map((p) =>
    deriveProduct({
      ...toBase(p),
      ventas7: Math.max(0, Math.round(p.ventas7 * f)),
      ventas30: Math.max(0, Math.round(p.ventas30 * f)),
    }),
  );
}

/** Llamada de un agente registrada en la traza. */
export interface TraceCall {
  agente: AgentId;
  herramienta: string;
  argumentos: Record<string, unknown>;
  resumen: string;
  ms: number;
}

/** Mensaje entre agentes (solicitud o respuesta) registrado en la traza. */
export interface AgentMessage {
  n: number;
  de: AgentId;
  para: AgentId;
  tipo: "solicitud" | "respuesta";
  asunto: string;
  contenido: string;
}

export interface SupervisorTrace {
  modo: "llm" | "reglas";
  modelo: string;
  motivo?: string | undefined;
  ms: number;
  tokensEntrada: number;
  tokensSalida: number;
  costoUsd: number;
  llamadas: TraceCall[];
  /** Mensajes entre agentes durante la consulta (delegación). */
  mensajes?: AgentMessage[] | undefined;
  verificacion?: { revisados: number; noEncontrados: string[] } | undefined;
  /** true si el Supervisor tuvo que pedir a Gemini que corrigiera cifras sin respaldo. */
  correccion?: boolean | undefined;
}

export interface SupervisorReply {
  intencion: string;
  pasos: SupervisorStep[];
  titulo: string;
  resumen: string;
  bullets: string[];
  productos: { sku: string; nombre: string }[];
  recomendacion?: Recomendacion | undefined;
  nota?: string | undefined;
  traza: SupervisorTrace;
  runId?: string | undefined;
}

const HERRAMIENTA_POR_AGENTE: Record<AgentId, string> = {
  supervisor: "interpretar_consulta",
  ventas: "consultar_ventas",
  predictor: "predecir_demanda",
  inventario: "consultar_inventario",
  reposicion: "calcular_reposicion",
};

/** Convierte la respuesta del motor de reglas al formato con traza. */
export function rulesReply(answer: SupervisorAnswer, motivo: string, ms: number): SupervisorReply {
  const unico = answer.productos.length === 1 ? answer.productos[0] : undefined;
  return {
    intencion: answer.intencion,
    pasos: answer.pasos,
    titulo: answer.titulo,
    resumen: answer.resumen,
    bullets: answer.bullets,
    productos: answer.productos.map((p) => ({ sku: p.sku, nombre: p.nombre })),
    recomendacion: answer.recomendacion,
    nota: answer.nota,
    traza: {
      modo: "reglas",
      modelo: "motor de reglas (palabras clave)",
      motivo,
      ms,
      tokensEntrada: 0,
      tokensSalida: 0,
      costoUsd: 0,
      llamadas: answer.pasos
        .filter((p) => p.agent !== "supervisor")
        .map((p) => ({
          agente: p.agent,
          herramienta:
            p.agent === "predictor" && /riesgo|quiebre|critic/i.test(answer.intencion)
              ? "calcular_riesgo_stock"
              : HERRAMIENTA_POR_AGENTE[p.agent],
          argumentos: unico ? { producto: unico.sku } : {},
          resumen: p.detalle,
          ms: 0,
        })),
    },
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

// --- Intenciones (sobre texto normalizado sin tildes) ---------------------
const RE = {
  escenario:
    /(sube|subir|aumenta|aumentar|incrementa|crece|baja|bajar|disminuye|cae|reduce)[^\d-]{0,30}(\d{1,3})\s*%/,
  aprobar:
    /(aprueba|aprobar|apruebalo|ejecuta|ejecutar|envia la orden|confirma la compra|compra automatic)/,
  porQue: /(por que|porqu|explica|justific|razon|como calcul)/,
  contexto: /\b(esa|ese|eso|esos|esas|ello|lo mismo|por que|porque|el anterior|ese producto)\b/,
  compra: /(compr|repon|pedir|pedido|orden de compra|abastec)/,
  sobrestock: /(sobrestock|sobre stock|exceso|inmoviliz|baja rotacion|no se vende)/,
  rankingVentas:
    /(mas vendid|menos vendid|se venden? (mas|menos)|(mas|menos) se venden?|mejor(es)? vendid|top\b.*vend|ranking.*vent|(mayor|menor)(es)? ventas|venden? (mas|menos)|vendido mas|vendido menos)/,
  ventasProducto: /(vend|ventas|rotacion|salida)/,
  margen: /(margen|rentab|ganancia)/,
  proveedor: /(proveedor|lead time|tiempo de entrega|tarda|demora|entrega)/,
  stockProducto: /(stock|existencia|inventario|cuant[oa]s? (hay|tengo|queda|quedan)|queda|quedan)/,
  demanda: /(demanda|pronostic|prevision|se vendera|proyecc)/,
  rotacion: /(rotacion)/,
  riesgo: /(critic|riesgo|quiebre|urgente|alerta|peligro)/,
  cobertura: /(cobertura|duran|alcanza|dias de stock|menor cobertura)/,
  enTema:
    /(repon|reponer|compr|pedido|orden|abastec|plan|semana|stock|inventario|producto|vend|venta|margen|proveedor|demanda|riesgo|cobertura|rotacion)/,
};

const AGENTES_COMPLETOS = (p: Product): SupervisorStep[] => [
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
];

function limiteDe(n: string, def: number) {
  const m = n.match(/\btop\s*(\d{1,2})\b|\b(\d{1,2})\s+productos\b/);
  const v = Number(m?.[1] ?? m?.[2]);
  return Number.isFinite(v) && v > 0 ? Math.min(30, v) : def;
}

export function askSupervisor(
  query: string,
  PRODUCTS: Product[],
  contexto?: Product,
): SupervisorAnswer {
  const METRICS = computeMetrics(PRODUCTS);
  const n = norm(query);
  const busqueda = buscarProductos(query, PRODUCTS);
  const varios = busqueda.productos.length > 1 ? busqueda.productos : undefined;
  const producto =
    busqueda.productos.length === 1
      ? busqueda.productos[0]
      : !varios && !busqueda.ambiguos.length && RE.contexto.test(n)
        ? contexto
        : undefined;

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

  // --- Escenario: la demanda cambia X% -----------------------------------
  const mEsc = n.match(RE.escenario);
  if (mEsc) {
    const signo = /(baja|bajar|disminuye|cae|reduce)/.test(mEsc[1] ?? "") ? -1 : 1;
    const pct = signo * Number(mEsc[2]);
    const esc = escenarioDemanda(PRODUCTS, pct);
    const M2 = computeMetrics(esc);
    const pasos = [
      step(
        "supervisor",
        "Interpretando la consulta…",
        `Intención: escenario con demanda ${pct > 0 ? "+" : ""}${pct}%.`,
      ),
      step(
        "ventas",
        "Analizando ventas…",
        `Ventas de 7 y 30 días ajustadas en ${pct > 0 ? "+" : ""}${pct}%.`,
      ),
      step(
        "predictor",
        "Prediciendo demanda…",
        "Demanda, cobertura y riesgo recalculados con el ajuste.",
      ),
      step("reposicion", "Calculando reposición…", "Cantidades recalculadas con la nueva demanda."),
      step("supervisor", "Generando recomendación…", "Comparación escenario vs situación actual."),
    ];
    if (producto) {
      const p2 = esc.find((x) => x.sku === producto.sku) ?? producto;
      return {
        intencion: `Escenario de demanda ${pct > 0 ? "+" : ""}${pct}% (${producto.sku})`,
        pasos,
        titulo: `${producto.nombre}: demanda ${pct > 0 ? "+" : ""}${pct}%`,
        resumen: `Con la demanda ${pct > 0 ? "+" : ""}${pct}%, la cobertura de ${producto.nombre} pasa de ${producto.cobertura} a ${p2.cobertura} días y la compra recomendada de ${producto.cantidadRecomendada} a ${p2.cantidadRecomendada} u (${money(p2.costoReposicion)}).`,
        bullets: [
          `Demanda diaria: ${producto.demandaDiaria} → ${p2.demandaDiaria} u/día.`,
          `Riesgo: ${producto.riesgoScore}/100 → ${p2.riesgoScore}/100.`,
          `Lead time del proveedor: ${producto.leadTime} días.`,
        ],
        productos: [producto],
        nota: "Es una simulación: no cambia los datos ni genera pedidos.",
      };
    }
    return {
      intencion: `Escenario de demanda ${pct > 0 ? "+" : ""}${pct}% (catálogo)`,
      pasos,
      titulo: `Escenario: demanda ${pct > 0 ? "+" : ""}${pct}%`,
      resumen: `Si la demanda cambia ${pct > 0 ? "+" : ""}${pct}%, los productos en riesgo crítico pasan de ${METRICS.criticos} a ${M2.criticos} y la compra sugerida de ${METRICS.pedidosPendientes} productos (${money(METRICS.costoPendiente)}) a ${M2.pedidosPendientes} productos (${money(M2.costoPendiente)}).`,
      bullets: [
        `Cobertura promedio: ${METRICS.coberturaPromedio} → ${M2.coberturaPromedio} días.`,
        `Productos en sobrestock: ${METRICS.sobrestock} → ${M2.sobrestock}.`,
        `Capital inmovilizado: ${money(METRICS.capitalInmovilizado)} → ${money(M2.capitalInmovilizado)}.`,
      ],
      productos: [],
      nota: "Es una simulación: no cambia los datos ni genera pedidos.",
    };
  }

  // --- Pedidos de aprobar/ejecutar compras: solo la persona puede hacerlo --
  if (RE.aprobar.test(n)) {
    return {
      intencion: "Solicitud de aprobación (no permitida a los agentes)",
      pasos: [
        step(
          "supervisor",
          "Interpretando la consulta…",
          "Solicitud de aprobar o ejecutar compras: fuera de los permisos de los agentes.",
        ),
      ],
      titulo: "No puedo aprobar ni ejecutar compras",
      resumen:
        "Los agentes solo consultan datos y recomiendan. La aprobación la hace el encargado de compras con los botones Aprobar, Modificar o Posponer de cada recomendación.",
      bullets: [],
      productos: [],
      nota: "Control humano obligatorio: ninguna compra se ejecuta automáticamente.",
    };
  }

  // --- Producto ambiguo: pedir aclaración ----------------------------------
  if (!producto && !varios && busqueda.ambiguos.length) {
    const a = busqueda.ambiguos[0]!;
    return {
      intencion: "Aclaración (producto ambiguo)",
      pasos: [
        step(
          "supervisor",
          "Interpretando la consulta…",
          `«${a.termino}» coincide con ${a.opciones.length} productos: se pide aclaración antes de delegar.`,
        ),
      ],
      titulo: `¿Cuál de estos productos?`,
      resumen: `«${a.termino}» coincide con ${a.opciones.length} productos del catálogo. Indica cuál quieres analizar.`,
      bullets: a.opciones.map((p) => `${p.nombre} (${p.sku})`),
      productos: a.opciones,
    };
  }

  // --- ¿Por qué esa cantidad? -------------------------------------------
  if (RE.porQue.test(n)) {
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
          `Demanda diaria estimada ${p.demandaDiaria} u/día (promedio ponderado 7/30 días + tendencia).`,
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
      resumen: `La cantidad sale de una fórmula determinística: objetivo de cobertura menos stock actual. Demanda diaria ${p.demandaDiaria} u × (lead time ${p.leadTime}d + ciclo 14d) = ${Math.ceil(p.demandaDiaria * (p.leadTime + 14))} u, más ${p.stockSeguridad} u de stock de seguridad, menos ${p.stock} u en almacén, redondeado a múltiplo de 10 y limitado por el stock máximo (${p.stockMax}).`,
      bullets: p.factores,
      productos: [p],
      recomendacion: p.cantidadRecomendada > 0 ? recoOf(p) : undefined,
      nota: "El Predictor entrega la demanda; el Agente de Reposición aplica reglas de negocio auditables.",
    };
  }

  // --- Sobrestock --------------------------------------------------------
  if (RE.sobrestock.test(n)) {
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
        ? `Detecté ${sobrestock.length} SKUs con cobertura superior a ${SOBRESTOCK.coberturaMin} días y rotación menor a ${SOBRESTOCK.rotacionMax}×/mes. Tienen ${money(capital)} de capital inmovilizado. Mi recomendación es no reponerlos y mover el stock con promoción.`
        : `No hay productos en sobrestock según los umbrales configurados (cobertura > ${SOBRESTOCK.coberturaMin} días y rotación < ${SOBRESTOCK.rotacionMax}×/mes).`,
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

  // --- Varios productos en la misma consulta ------------------------------
  if (varios) {
    const conCompra = varios
      .filter((p) => p.cantidadRecomendada > 0)
      .sort((a, b) => b.prioridad - a.prioridad);
    const costo = conCompra.reduce((a, p) => a + p.costoReposicion, 0);
    return {
      intencion: `Análisis de ${varios.length} productos (${varios.map((p) => p.sku).join(", ")})`,
      pasos: [
        step(
          "supervisor",
          "Interpretando la consulta…",
          `Productos identificados: ${varios.map((p) => p.nombre).join(", ")}.`,
        ),
        step(
          "ventas",
          "Analizando ventas…",
          `Ventas de 7 y 30 días de ${varios.length} productos.`,
        ),
        step("predictor", "Prediciendo demanda…", "Demanda diaria y riesgo por producto."),
        step("inventario", "Consultando inventario…", "Stock, mínimos y cobertura por producto."),
        step(
          "reposicion",
          "Calculando reposición…",
          `${conCompra.length} de ${varios.length} productos necesitan compra (${money(costo)}).`,
        ),
        step("supervisor", "Generando recomendación…", "Comparación y priorización."),
      ],
      titulo: `Análisis de ${varios.length} productos`,
      resumen: conCompra.length
        ? `De los ${varios.length} productos consultados, ${conCompra.length} necesitan compra por un total de ${money(costo)}. El más urgente es ${conCompra[0]!.nombre}.`
        : `Ninguno de los ${varios.length} productos consultados necesita compra ahora.`,
      bullets: varios.map((p) =>
        p.cantidadRecomendada > 0
          ? `${p.nombre} — comprar ${p.cantidadRecomendada} u (${money(p.costoReposicion)}), stock ${p.stock} u, cobertura ${p.cobertura}d, riesgo ${RISK_LABEL[p.riesgo].toLowerCase()}.`
          : `${p.nombre} — sin compra: ${p.stock} u cubren ${p.cobertura} días${p.sobrestock ? " (sobrestock)" : ""}.`,
      ),
      productos: varios,
      recomendacion: conCompra[0] ? recoOf(conCompra[0]) : undefined,
      nota:
        conCompra.length > 1
          ? "Cada compra se aprueba por separado (Reposición o ficha del producto)."
          : undefined,
    };
  }

  // --- Consultas específicas sobre UN producto ----------------------------
  if (producto && !RE.compra.test(n)) {
    const p = producto;
    const base = step(
      "supervisor",
      "Interpretando la consulta…",
      `Producto identificado: ${p.nombre} (${p.sku}).`,
    );
    const cierre = step("supervisor", "Generando recomendación…", "Consolidando la respuesta.");
    if (RE.ventasProducto.test(n) && !RE.riesgo.test(n)) {
      return {
        intencion: `Ventas del producto (${p.sku})`,
        pasos: [
          base,
          step(
            "ventas",
            "Analizando ventas…",
            `${p.ventas7} u en 7 días, ${p.ventas30} u en 30 días.`,
          ),
          step(
            "inventario",
            "Consultando inventario…",
            `Stock ${p.stock} u para calcular la rotación.`,
          ),
          cierre,
        ],
        titulo: `Ventas de ${p.nombre}`,
        resumen: `${p.nombre} vendió ${p.ventas7} unidades en los últimos 7 días y ${p.ventas30} en los últimos 30 días. Su rotación es de ${p.rotacion} veces al mes.`,
        bullets: [
          `Tendencia: ${p.tendencia >= 0 ? "+" : ""}${Math.round(p.tendencia * 100)}% en las últimas semanas.`,
          `Margen: ${p.margen}% (compra S/ ${p.precioCompra}, venta S/ ${p.precioVenta}).`,
          `Estacionalidad: ${p.estacionalidad.toLowerCase()}.`,
        ],
        productos: [p],
      };
    }
    if (RE.proveedor.test(n)) {
      return {
        intencion: `Proveedor del producto (${p.sku})`,
        pasos: [
          base,
          step(
            "inventario",
            "Consultando inventario…",
            `Proveedor ${p.proveedor}, lead time ${p.leadTime} días.`,
          ),
          cierre,
        ],
        titulo: `Proveedor de ${p.nombre}`,
        resumen: `${p.nombre} lo abastece ${p.proveedor}, que tarda ${p.leadTime} días en entregar. Con ${p.stock} u en almacén la cobertura es de ${p.cobertura} días.`,
        bullets: [
          `Precio de compra: S/ ${p.precioCompra}.`,
          `Punto de reorden: ${p.puntoReorden} u.`,
        ],
        productos: [p],
      };
    }
    if (RE.margen.test(n)) {
      return {
        intencion: `Margen del producto (${p.sku})`,
        pasos: [base, step("ventas", "Analizando ventas…", `Margen ${p.margen}%.`), cierre],
        titulo: `Margen de ${p.nombre}`,
        resumen: `${p.nombre} tiene un margen de ${p.margen}%: se compra a S/ ${p.precioCompra} y se vende a S/ ${p.precioVenta}.`,
        bullets: [`Ventas de 30 días: ${p.ventas30} u.`],
        productos: [p],
      };
    }
    if (RE.demanda.test(n)) {
      return {
        intencion: `Demanda prevista (${p.sku})`,
        pasos: [
          base,
          step(
            "ventas",
            "Analizando ventas…",
            `${p.ventas7} u en 7 días, ${p.ventas30} u en 30 días.`,
          ),
          step("predictor", "Prediciendo demanda…", `${p.demandaDiaria} u/día.`),
          cierre,
        ],
        titulo: `Demanda prevista de ${p.nombre}`,
        resumen: `La demanda estimada de ${p.nombre} es de ${p.demandaDiaria} u/día: ${p.demanda7} u a 7 días, ${p.demanda14} u a 14 días y ${p.demanda30} u a 30 días.`,
        bullets: [`Método: promedio ponderado 7/30 días + tendencia.`],
        productos: [p],
      };
    }
    if (RE.stockProducto.test(n) && !RE.riesgo.test(n)) {
      return {
        intencion: `Inventario del producto (${p.sku})`,
        pasos: [
          base,
          step(
            "inventario",
            "Consultando inventario…",
            `Stock ${p.stock} u (mín ${p.stockMin}, máx ${p.stockMax}).`,
          ),
          step(
            "predictor",
            "Prediciendo demanda…",
            `${p.demandaDiaria} u/día para convertir el stock en días.`,
          ),
          cierre,
        ],
        titulo: `Stock de ${p.nombre}`,
        resumen: `Hay ${p.stock} unidades de ${p.nombre} en almacén (mínimo ${p.stockMin}, máximo ${p.stockMax}). Con ${p.demandaDiaria} u/día alcanzan para ${p.cobertura} días.`,
        bullets: [
          p.cantidadRecomendada > 0
            ? `Reposición sugerida: ${p.cantidadRecomendada} u (${money(p.costoReposicion)}).`
            : "No necesita reposición ahora.",
          `Proveedor ${p.proveedor}, lead time ${p.leadTime} días.`,
        ],
        productos: [p],
        recomendacion: p.cantidadRecomendada > 0 ? recoOf(p) : undefined,
      };
    }
  }

  // --- Rankings del catálogo ---------------------------------------------
  if (!producto && RE.rankingVentas.test(n)) {
    const asc = /(menos|menor|peor)/.test(n);
    const top = [...PRODUCTS]
      .sort((a, b) => (asc ? a.ventas30 - b.ventas30 : b.ventas30 - a.ventas30))
      .slice(0, limiteDe(n, 6));
    return {
      intencion: `Ranking de ventas (${asc ? "menos" : "más"} vendidos)`,
      pasos: [
        step(
          "supervisor",
          "Interpretando la consulta…",
          "Intención: ranking por unidades vendidas en 30 días.",
        ),
        step(
          "ventas",
          "Analizando ventas…",
          `${METRICS.ventas30} u vendidas en 30 días en el catálogo.`,
        ),
        step("supervisor", "Generando recomendación…", "Ordenamiento por ventas de 30 días."),
      ],
      titulo: `Productos ${asc ? "menos" : "más"} vendidos`,
      resumen: `Ranking por unidades vendidas en los últimos 30 días. ${asc ? "El que menos vende" : "El más vendido"} es ${top[0]?.nombre ?? "—"} con ${top[0]?.ventas30 ?? 0} u.`,
      bullets: top.map(
        (p) => `${p.nombre} — ${p.ventas30} u en 30 días (${p.ventas7} u en 7 días).`,
      ),
      productos: top,
    };
  }
  if (!producto && RE.margen.test(n)) {
    const asc = /(menor|menos|bajo|peor)/.test(n);
    const top = [...PRODUCTS]
      .sort((a, b) => (asc ? a.margen - b.margen : b.margen - a.margen))
      .slice(0, limiteDe(n, 6));
    return {
      intencion: `Ranking de margen (${asc ? "menor" : "mayor"})`,
      pasos: [
        step("supervisor", "Interpretando la consulta…", "Intención: ranking por margen de venta."),
        step(
          "ventas",
          "Analizando ventas…",
          "Margen = (precio de venta − precio de compra) / precio de venta.",
        ),
        step("supervisor", "Generando recomendación…", "Ordenamiento por margen."),
      ],
      titulo: `Productos con ${asc ? "menor" : "mayor"} margen`,
      resumen: `${asc ? "El de menor" : "El de mayor"} margen es ${top[0]?.nombre ?? "—"} con ${top[0]?.margen ?? 0}%.`,
      bullets: top.map(
        (p) =>
          `${p.nombre} — margen ${p.margen}% (compra S/ ${p.precioCompra}, venta S/ ${p.precioVenta}).`,
      ),
      productos: top,
    };
  }
  if (!producto && RE.proveedor.test(n)) {
    const asc = /(menos tarda|mas rapido|menor|menos)/.test(n);
    const top = [...PRODUCTS]
      .sort((a, b) => (asc ? a.leadTime - b.leadTime : b.leadTime - a.leadTime))
      .slice(0, limiteDe(n, 6));
    return {
      intencion: `Proveedores por tiempo de entrega (${asc ? "más rápidos" : "más lentos"})`,
      pasos: [
        step(
          "supervisor",
          "Interpretando la consulta…",
          "Intención: comparar proveedores por lead time.",
        ),
        step(
          "inventario",
          "Consultando inventario…",
          `${new Set(PRODUCTS.map((p) => p.proveedor)).size} proveedores en el catálogo.`,
        ),
        step("supervisor", "Generando recomendación…", "Ordenamiento por lead time."),
      ],
      titulo: `Proveedores ${asc ? "más rápidos" : "que más tardan"}`,
      resumen: `${top[0]?.proveedor ?? "—"} es ${asc ? "el más rápido" : "el que más tarda"}: ${top[0]?.leadTime ?? 0} días para ${top[0]?.nombre ?? "—"}.`,
      bullets: top.map(
        (p) => `${p.proveedor} — ${p.leadTime} días (${p.nombre}, cobertura ${p.cobertura}d).`,
      ),
      productos: top,
    };
  }
  if (!producto && RE.rotacion.test(n)) {
    const asc = /(menor|menos|baja)/.test(n);
    const top = [...PRODUCTS]
      .sort((a, b) => (asc ? a.rotacion - b.rotacion : b.rotacion - a.rotacion))
      .slice(0, limiteDe(n, 6));
    return {
      intencion: `Ranking de rotación (${asc ? "menor" : "mayor"})`,
      pasos: [
        step(
          "supervisor",
          "Interpretando la consulta…",
          "Intención: ranking por rotación mensual.",
        ),
        step("ventas", "Analizando ventas…", "Rotación = ventas de 30 días / stock actual."),
        step("inventario", "Consultando inventario…", "Stock actual por SKU."),
        step("supervisor", "Generando recomendación…", "Ordenamiento por rotación."),
      ],
      titulo: `Productos con ${asc ? "menor" : "mayor"} rotación`,
      resumen: `${top[0]?.nombre ?? "—"} rota ${top[0]?.rotacion ?? 0} veces al mes.`,
      bullets: top.map(
        (p) => `${p.nombre} — ${p.rotacion}×/mes (${p.ventas30} u en 30 días, stock ${p.stock} u).`,
      ),
      productos: top,
    };
  }

  // --- Riesgo crítico ----------------------------------------------------
  if (RE.riesgo.test(n) && !producto) {
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
          "Promedio ponderado 7/30 días + tendencia, horizonte 7/14/30 días.",
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
  if (RE.cobertura.test(n) && !producto) {
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

  // --- Consulta sobre un producto concreto (compra, riesgo, quiebre) -------
  if (producto) {
    const p = producto;
    const quiebre = /(no repon|no compro|se acaba|quiebre)/.test(n);
    const riesgoQ = !quiebre && /(riesgo|critic|peligro)/.test(n);
    return {
      intencion: riesgoQ ? `Riesgo de quiebre (${p.sku})` : `Análisis de producto (${p.sku})`,
      pasos: [
        step(
          "supervisor",
          "Interpretando la consulta…",
          `Producto identificado: ${p.nombre} (${p.sku}).`,
        ),
        ...AGENTES_COMPLETOS(p),
        step(
          "supervisor",
          "Generando recomendación…",
          "Consolidando el resultado de los 4 agentes.",
        ),
      ],
      titulo: `${p.nombre} · ${p.sku}`,
      resumen: riesgoQ
        ? `${p.nombre} tiene riesgo ${RISK_LABEL[p.riesgo].toLowerCase()} (${p.riesgoScore}/100): sus ${p.stock} u cubren ${p.cobertura} días y el proveedor tarda ${p.leadTime} días. Probabilidad de quiebre antes del próximo pedido: ${p.probQuiebre}%.`
        : quiebre
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

  // --- Producto mencionado que no existe en el catálogo -------------------
  const mNombre = n.match(
    /(?:comprar|compro|reponer|repongo|pedir|stock|riesgo|demanda|ventas|vendi|vende)\s+(?:de|del)\s+(?:(?:el|la|los|las)\s+)?([a-z0-9]{3,})/,
  );
  const NO_PRODUCTO = [
    "productos",
    "catalogo",
    "semana",
    "inventario",
    "todo",
    "todos",
    "cada",
    "quiebre",
    "esta",
    "este",
  ];
  if (mNombre && !NO_PRODUCTO.includes(mNombre[1] ?? "")) {
    const parecidos = sugerirProductos(mNombre[1] ?? "", PRODUCTS);
    const ejemplos = (parecidos.length ? parecidos : PRODUCTS.slice(0, 4)).map((p) => p.nombre);
    return {
      intencion: "Producto no encontrado",
      pasos: [
        step("supervisor", "Interpretando la consulta…", `Producto buscado: «${mNombre[1]}».`),
        step("inventario", "Consultando inventario…", "No hay coincidencias en el catálogo."),
      ],
      titulo: `No encontré «${mNombre[1]}» en el catálogo`,
      resumen: `No existe un producto que coincida con «${mNombre[1]}». ${parecidos.length ? "Productos parecidos" : "Algunos productos del catálogo"}: ${ejemplos.join(", ")}.`,
      bullets: [],
      productos: [],
    };
  }

  // --- Consulta fuera de tema: pedir aclaración --------------------------
  if (!RE.enTema.test(n)) {
    return {
      intencion: "Aclaración (consulta fuera de alcance)",
      pasos: [
        step(
          "supervisor",
          "Interpretando la consulta…",
          "No se identificó un producto ni una intención de inventario: no se invocan agentes.",
        ),
      ],
      titulo: "¿En qué te ayudo con el inventario?",
      resumen:
        "Solo respondo sobre ventas, demanda, inventario y compras del catálogo. Prueba, por ejemplo: «¿Qué productos debo reponer esta semana?» o «¿Cuánto debería comprar de café?».",
      bullets: [],
      productos: [],
    };
  }

  // --- Reposición semanal ------------------------------------------------
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
        "Pronóstico a 7/14/30 días con promedio ponderado + tendencia.",
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
