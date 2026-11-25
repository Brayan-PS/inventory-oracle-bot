/**
 * Agentes especializados expuestos como herramientas (function calling).
 *
 * El Supervisor (LLM) decide qué herramienta llamar y con qué argumentos.
 * Cada herramienta pertenece a un agente, trabaja SOLO con los datos del
 * catálogo (PostgreSQL) y devuelve JSON estructurado. Ninguna herramienta
 * escribe datos ni ejecuta compras: son de solo lectura.
 */

import { computeMetrics, RISK_LABEL, type Product } from "./inventory.ts";
import {
  cuandoComprar,
  escenarioDemanda,
  matchProduct,
  prioridadTexto,
  type AgentId,
} from "./supervisor.ts";

interface JsonSchema {
  type: "object";
  properties: Record<string, Record<string, unknown>>;
  required?: string[];
}

export interface ToolDef {
  name: string;
  agente: AgentId;
  description: string;
  parameters: JsonSchema;
}

const P_PRODUCTO = {
  type: "string",
  description:
    "Nombre o SKU de un producto (por ejemplo 'café' o 'SKU-1042'). Omitir para analizar todo el catálogo.",
};
const P_LIMITE = {
  type: "integer",
  description: "Cantidad máxima de productos a devolver (1 a 30). Por defecto 8.",
};
const P_AJUSTE = {
  type: "number",
  description:
    "Escenario hipotético: cambio porcentual de la demanda (por ejemplo 20 o -15). Omitir para la situación actual.",
};

export const TOOLS: ToolDef[] = [
  {
    name: "consultar_ventas",
    agente: "ventas",
    description:
      "Agente Analista de Ventas. Devuelve ventas de 7 y 30 días, rotación mensual y tendencia por producto.",
    parameters: {
      type: "object",
      properties: {
        producto: P_PRODUCTO,
        orden: {
          type: "string",
          enum: ["mayor_rotacion", "menor_rotacion"],
          description: "Orden del listado cuando no se indica producto.",
        },
        limite: P_LIMITE,
      },
    },
  },
  {
    name: "predecir_demanda",
    agente: "predictor",
    description:
      "Agente Predictor de Demanda. Devuelve la demanda diaria estimada y la demanda prevista a 7, 14 y 30 días.",
    parameters: {
      type: "object",
      properties: { producto: P_PRODUCTO, limite: P_LIMITE, ajuste_demanda_pct: P_AJUSTE },
    },
  },
  {
    name: "calcular_riesgo_stock",
    agente: "predictor",
    description:
      "Agente Predictor de Demanda. Devuelve el nivel de riesgo de quiebre (crítico, alto, moderado, saludable), su puntaje 0-100, la probabilidad de quiebre y los días hasta quiebre. Sin producto, ordena el catálogo de mayor a menor riesgo.",
    parameters: {
      type: "object",
      properties: { producto: P_PRODUCTO, limite: P_LIMITE, ajuste_demanda_pct: P_AJUSTE },
    },
  },
  {
    name: "consultar_inventario",
    agente: "inventario",
    description:
      "Agente Gestor de Inventario. Devuelve stock actual, mínimo, máximo, cobertura en días, lead time del proveedor y si hay sobrestock.",
    parameters: {
      type: "object",
      properties: {
        producto: P_PRODUCTO,
        filtro: {
          type: "string",
          enum: ["todos", "menor_cobertura", "sobrestock", "bajo_minimo"],
          description: "Filtro del listado cuando no se indica producto.",
        },
        limite: P_LIMITE,
      },
    },
  },
  {
    name: "calcular_reposicion",
    agente: "reposicion",
    description:
      "Agente de Reposición. Calcula cuánto comprar, cuánto cuesta (S/), cuándo pedir y la prioridad. Sin producto, devuelve el plan de compra del catálogo ordenado por prioridad y su costo total.",
    parameters: {
      type: "object",
      properties: { producto: P_PRODUCTO, limite: P_LIMITE, ajuste_demanda_pct: P_AJUSTE },
    },
  },
];

export const TOOL_BY_NAME = Object.fromEntries(TOOLS.map((t) => [t.name, t])) as Record<
  string,
  ToolDef
>;

export interface ToolResult {
  ok: boolean;
  agente: AgentId;
  data: Record<string, unknown>;
  resumen: string;
  skus: string[];
}

const r1 = (n: number) => Math.round(n * 10) / 10;
const r2 = (n: number) => Math.round(n * 100) / 100;

function limiteDe(v: unknown, def = 8) {
  const n = typeof v === "number" ? Math.trunc(v) : Number.parseInt(String(v ?? ""), 10);
  return Number.isFinite(n) ? Math.min(30, Math.max(1, n)) : def;
}

function ajusteDe(v: unknown): number {
  const n = typeof v === "number" ? v : Number.parseFloat(String(v ?? ""));
  return Number.isFinite(n) ? Math.min(300, Math.max(-90, n)) : 0;
}

function resolver(
  args: Record<string, unknown>,
  products: Product[],
): { producto?: Product; error?: Record<string, unknown> } {
  const raw = typeof args["producto"] === "string" ? args["producto"].trim().slice(0, 100) : "";
  if (!raw) return {};
  const p = matchProduct(raw, products);
  if (p) return { producto: p };
  return {
    error: {
      error: `No existe en el catálogo un producto que coincida con "${raw}".`,
      ejemplos_del_catalogo: products.slice(0, 6).map((x) => x.nombre),
    },
  };
}

const ventasDe = (p: Product) => ({
  sku: p.sku,
  nombre: p.nombre,
  ventas_7d: p.ventas7,
  ventas_30d: p.ventas30,
  rotacion_mes: p.rotacion,
  tendencia_pct: Math.round(p.tendencia * 100),
  estacionalidad: p.estacionalidad,
});

const demandaDe = (p: Product) => ({
  sku: p.sku,
  nombre: p.nombre,
  demanda_diaria: p.demandaDiaria,
  demanda_7d: p.demanda7,
  demanda_14d: p.demanda14,
  demanda_30d: p.demanda30,
});

const riesgoDe = (p: Product) => ({
  sku: p.sku,
  nombre: p.nombre,
  riesgo: RISK_LABEL[p.riesgo],
  riesgo_score: p.riesgoScore,
  probabilidad_quiebre_pct: p.probQuiebre,
  dias_hasta_quiebre: p.diasHastaQuiebre,
  cobertura_dias: p.cobertura,
  lead_time_dias: p.leadTime,
});

const inventarioDe = (p: Product) => ({
  sku: p.sku,
  nombre: p.nombre,
  stock: p.stock,
  stock_min: p.stockMin,
  stock_max: p.stockMax,
  cobertura_dias: p.cobertura,
  lead_time_dias: p.leadTime,
  proveedor: p.proveedor,
  sobrestock: p.sobrestock,
  valor_inventario_soles: p.valorInventario,
});

const reposicionDe = (p: Product) => ({
  sku: p.sku,
  nombre: p.nombre,
  cantidad_recomendada: p.cantidadRecomendada,
  costo_soles: p.costoReposicion,
  cuando: cuandoComprar(p),
  prioridad: prioridadTexto(p),
  stock_actual: p.stock,
  stock_seguridad: p.stockSeguridad,
  demanda_diaria: p.demandaDiaria,
  lead_time_dias: p.leadTime,
  formula:
    "demanda_diaria × (lead_time + 14) + stock_seguridad − stock_actual, redondeado a múltiplo de 10 y limitado por stock_max",
});

/** Ejecuta una herramienta (agente) con argumentos ya parseados del LLM. */
export function runTool(
  name: string,
  args: Record<string, unknown>,
  catalogo: Product[],
): ToolResult {
  const def = TOOL_BY_NAME[name];
  if (!def) {
    return {
      ok: false,
      agente: "supervisor",
      data: { error: `Herramienta desconocida: ${name}` },
      resumen: `Herramienta desconocida: ${name}`,
      skus: [],
    };
  }
  const ajuste = ajusteDe(args["ajuste_demanda_pct"]);
  const products = ajuste ? escenarioDemanda(catalogo, ajuste) : catalogo;
  const limite = limiteDe(args["limite"]);
  const { producto, error } = resolver(args, products);
  if (error) {
    return {
      ok: false,
      agente: def.agente,
      data: error,
      resumen: String(error["error"]),
      skus: [],
    };
  }
  const escenario = ajuste ? { escenario_demanda_pct: ajuste } : {};

  switch (name) {
    case "consultar_ventas": {
      if (producto) {
        return {
          ok: true,
          agente: "ventas",
          data: ventasDe(producto),
          resumen: `${producto.nombre}: ${producto.ventas7} u en 7 d, ${producto.ventas30} u en 30 d, rotación ${producto.rotacion}×/mes.`,
          skus: [producto.sku],
        };
      }
      const asc = args["orden"] === "menor_rotacion";
      const lista = [...products]
        .sort((a, b) => (asc ? a.rotacion - b.rotacion : b.rotacion - a.rotacion))
        .slice(0, limite);
      const total30 = products.reduce((a, p) => a + p.ventas30, 0);
      return {
        ok: true,
        agente: "ventas",
        data: {
          total_skus: products.length,
          ventas_30d_total: total30,
          productos: lista.map(ventasDe),
        },
        resumen: `${products.length} SKUs, ${total30} u vendidas en 30 d; ${lista.length} listados por ${asc ? "menor" : "mayor"} rotación.`,
        skus: lista.map((p) => p.sku),
      };
    }
    case "predecir_demanda": {
      if (producto) {
        return {
          ok: true,
          agente: "predictor",
          data: { ...demandaDe(producto), ...escenario },
          resumen: `${producto.nombre}: ${producto.demandaDiaria} u/día; ${producto.demanda7}/${producto.demanda14}/${producto.demanda30} u a 7/14/30 d.`,
          skus: [producto.sku],
        };
      }
      const lista = [...products].sort((a, b) => b.demanda7 - a.demanda7).slice(0, limite);
      const d7 = products.reduce((a, p) => a + p.demanda7, 0);
      return {
        ok: true,
        agente: "predictor",
        data: { demanda_7d_total: d7, productos: lista.map(demandaDe), ...escenario },
        resumen: `Demanda prevista a 7 d del catálogo: ${d7} u; ${lista.length} productos con mayor demanda.`,
        skus: lista.map((p) => p.sku),
      };
    }
    case "calcular_riesgo_stock": {
      if (producto) {
        return {
          ok: true,
          agente: "predictor",
          data: { ...riesgoDe(producto), ...escenario },
          resumen: `${producto.nombre}: riesgo ${RISK_LABEL[producto.riesgo].toLowerCase()} ${producto.riesgoScore}/100, quiebre en ~${producto.diasHastaQuiebre} d (${producto.probQuiebre}%).`,
          skus: [producto.sku],
        };
      }
      const M = computeMetrics(products);
      const lista = [...products].sort((a, b) => b.riesgoScore - a.riesgoScore).slice(0, limite);
      return {
        ok: true,
        agente: "predictor",
        data: {
          total_skus: M.totalSkus,
          criticos: M.criticos,
          altos: M.altos,
          moderados: M.moderados,
          saludables: M.saludables,
          productos: lista.map(riesgoDe),
          ...escenario,
        },
        resumen: `${M.criticos} críticos y ${M.altos} altos de ${M.totalSkus} SKUs; el más urgente es ${lista[0]?.nombre ?? "—"}.`,
        skus: lista.map((p) => p.sku),
      };
    }
    case "consultar_inventario": {
      if (producto) {
        return {
          ok: true,
          agente: "inventario",
          data: inventarioDe(producto),
          resumen: `${producto.nombre}: stock ${producto.stock} u (mín ${producto.stockMin}, máx ${producto.stockMax}), cobertura ${producto.cobertura} d.`,
          skus: [producto.sku],
        };
      }
      const filtro = String(args["filtro"] ?? "menor_cobertura");
      let lista = [...products];
      if (filtro === "sobrestock") lista = lista.filter((p) => p.sobrestock);
      if (filtro === "bajo_minimo") lista = lista.filter((p) => p.stock < p.stockMin);
      if (filtro === "sobrestock") lista.sort((a, b) => b.valorInventario - a.valorInventario);
      else lista.sort((a, b) => a.cobertura - b.cobertura);
      lista = lista.slice(0, limite);
      const M = computeMetrics(products);
      return {
        ok: true,
        agente: "inventario",
        data: {
          filtro,
          cobertura_promedio_dias: M.coberturaPromedio,
          productos_en_sobrestock: M.sobrestock,
          capital_inmovilizado_soles: M.capitalInmovilizado,
          valor_inventario_soles: M.valorInventario,
          productos: lista.map(inventarioDe),
        },
        resumen: `Filtro ${filtro}: ${lista.length} productos; cobertura promedio ${M.coberturaPromedio} d; capital inmovilizado S/ ${M.capitalInmovilizado}.`,
        skus: lista.map((p) => p.sku),
      };
    }
    case "calcular_reposicion": {
      if (producto) {
        return {
          ok: true,
          agente: "reposicion",
          data: { ...reposicionDe(producto), ...escenario },
          resumen: `${producto.nombre}: comprar ${producto.cantidadRecomendada} u por S/ ${r2(producto.costoReposicion)} (${cuandoComprar(producto).toLowerCase()}).`,
          skus: [producto.sku],
        };
      }
      const reponer = products
        .filter((p) => p.cantidadRecomendada > 0)
        .sort((a, b) => b.prioridad - a.prioridad);
      const costo = Math.round(reponer.reduce((a, p) => a + p.costoReposicion, 0));
      const lista = reponer.slice(0, limite);
      return {
        ok: true,
        agente: "reposicion",
        data: {
          productos_a_reponer: reponer.length,
          costo_total_soles: costo,
          productos: lista.map(reposicionDe),
          ...escenario,
        },
        resumen: `${reponer.length} productos a reponer por S/ ${costo}; prioridad máxima: ${lista[0]?.nombre ?? "—"}.`,
        skus: lista.map((p) => p.sku),
      };
    }
    default:
      return {
        ok: false,
        agente: def.agente,
        data: { error: "Sin implementación" },
        resumen: "Sin implementación",
        skus: [],
      };
  }
}

/** Todos los números presentes en un valor JSON (para verificar la respuesta del LLM). */
export function numerosDe(value: unknown, out = new Set<number>()): Set<number> {
  if (typeof value === "number" && Number.isFinite(value)) {
    out.add(value);
    out.add(Math.round(value));
    out.add(r1(value));
    out.add(r2(value));
  } else if (typeof value === "string") {
    for (const m of value.matchAll(/\d+(?:[.,]\d+)?/g)) {
      const n = Number(m[0].replace(",", "."));
      if (Number.isFinite(n)) {
        out.add(n);
        out.add(Math.round(n));
      }
    }
  } else if (Array.isArray(value)) {
    for (const v of value) numerosDe(v, out);
  } else if (value && typeof value === "object") {
    for (const v of Object.values(value)) numerosDe(v, out);
  }
  return out;
}
