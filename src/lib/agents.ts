/**
 * Agentes especializados y su comunicación.
 *
 * Cada agente tiene una especialidad y solo calcula lo suyo. Cuando necesita un
 * dato de otra especialidad se lo PIDE al agente responsable por el bus de
 * mensajes (AgentBus), y la solicitud y la respuesta quedan en la traza:
 *
 *   Supervisor ──► Reposición ──► Predictor ──► Analista de Ventas ──► Gestor de Inventario
 *                       │             └──► Gestor de Inventario
 *                       └──► Gestor de Inventario ──► Predictor / Analista de Ventas
 *
 * El bus guarda una memoria de trabajo por consulta: si dos agentes piden el mismo
 * dato, se responde de memoria sin recalcular (y sin duplicar mensajes).
 *
 * El Supervisor (LLM) solo llama a las herramientas de la lista TOOLS; ninguna
 * herramienta escribe datos ni ejecuta compras.
 */

import { buscarProductos, sugerirProductos } from "./catalogo.ts";
import {
  calcularCobertura,
  calcularPrioridad,
  calcularReposicion,
  calcularRiesgo,
  calcularRotacion,
  CICLO_DIAS,
  esSobrestock,
  pronosticarDemanda,
  RISK_LABEL,
  round,
  type BaseProduct,
  type RiskLevel,
} from "./inventory.ts";
import { cuandoComprar, prioridadTexto, type AgentId, type AgentMessage } from "./supervisor.ts";

// ---------------------------------------------------------------------------
// Bus de mensajes entre agentes
// ---------------------------------------------------------------------------

type PorSku<T> = Map<string, T>;

export class AgentBus {
  readonly mensajes: AgentMessage[] = [];
  private readonly memoria = new Map<string, unknown>();
  private readonly bySku: Map<string, BaseProduct>;
  readonly catalogo: BaseProduct[];

  constructor(catalogo: BaseProduct[]) {
    this.catalogo = catalogo;
    this.bySku = new Map(catalogo.map((p) => [p.sku, p]));
  }

  /** Datos base de PostgreSQL (solo los lee el Gestor de Inventario y el Analista). */
  fila(sku: string): BaseProduct {
    const p = this.bySku.get(sku);
    if (!p) throw new Error(`SKU desconocido: ${sku}`);
    return p;
  }

  /**
   * Envía una solicitud de `de` a `para` y registra la respuesta. Si la misma
   * solicitud ya se respondió en esta consulta, devuelve la respuesta de memoria.
   */
  pedir<T>(
    de: AgentId,
    para: AgentId,
    asunto: string,
    skus: string[],
    ajuste: number,
    ejecutar: () => T,
    resumir: (r: T) => string,
  ): T {
    const clave = `${para}|${asunto}|${ajuste}|${skus.join(",")}`;
    if (this.memoria.has(clave)) return this.memoria.get(clave) as T;
    if (de === para) {
      // Trabajo interno del propio agente: se memoriza pero no es un mensaje entre agentes.
      const r = ejecutar();
      this.memoria.set(clave, r);
      return r;
    }
    const objeto = skus.length === 1 ? skus[0]! : `${skus.length} SKUs`;
    this.registrar(
      de,
      para,
      "solicitud",
      asunto,
      `${asunto} de ${objeto}${ajuste ? ` (escenario ${ajuste > 0 ? "+" : ""}${ajuste}%)` : ""}`,
    );
    const r = ejecutar();
    this.memoria.set(clave, r);
    this.registrar(para, de, "respuesta", asunto, resumir(r));
    return r;
  }

  registrar(
    de: AgentId,
    para: AgentId,
    tipo: AgentMessage["tipo"],
    asunto: string,
    contenido: string,
  ) {
    this.mensajes.push({
      n: this.mensajes.length + 1,
      de,
      para,
      tipo,
      asunto,
      contenido: contenido.slice(0, 300),
    });
  }
}

const uno = <T>(m: PorSku<T>, skus: string[], f: (v: T) => string) =>
  skus.length === 1 ? f(m.get(skus[0]!)!) : `${m.size} SKUs`;

// ---------------------------------------------------------------------------
// Gestor de Inventario
// ---------------------------------------------------------------------------

interface Estado {
  stock: number;
  stockMin: number;
  stockMax: number;
  leadTime: number;
  proveedor: string;
  precioCompra: number;
  valorInventario: number;
}
interface Cobertura {
  cobertura: number;
  sobrestock: boolean;
}

export const GestorInventario = {
  /** Lee stock, mínimos, máximos y proveedor (datos propios del gestor). */
  estado(bus: AgentBus, de: AgentId, skus: string[]): PorSku<Estado> {
    return bus.pedir(
      de,
      "inventario",
      "estado del inventario",
      skus,
      0,
      () =>
        new Map(
          skus.map((s) => {
            const p = bus.fila(s);
            return [
              s,
              {
                stock: p.stock,
                stockMin: p.stockMin,
                stockMax: p.stockMax,
                leadTime: p.leadTime,
                proveedor: p.proveedor,
                precioCompra: p.precioCompra,
                valorInventario: round(p.stock * p.precioCompra, 2),
              },
            ];
          }),
        ),
      (m) =>
        uno(
          m,
          skus,
          (e) =>
            `stock ${e.stock} u (mín ${e.stockMin}, máx ${e.stockMax}), lead time ${e.leadTime} d`,
        ),
    );
  },

  /** Cobertura y sobrestock: pide la demanda al Predictor y la rotación al Analista. */
  cobertura(bus: AgentBus, de: AgentId, skus: string[], ajuste: number): PorSku<Cobertura> {
    return bus.pedir(
      de,
      "inventario",
      "cobertura y sobrestock",
      skus,
      ajuste,
      () => {
        const estado = GestorInventario.estado(bus, "inventario", skus);
        const demanda = Predictor.pronostico(bus, "inventario", skus, ajuste);
        const rot = AnalistaVentas.rotacion(bus, "inventario", skus, ajuste);
        return new Map(
          skus.map((s) => {
            const e = estado.get(s)!;
            const cobertura = calcularCobertura(e.stock, demanda.get(s)!.demandaDiaria);
            return [
              s,
              {
                cobertura,
                sobrestock: esSobrestock({
                  cobertura,
                  rotacion: rot.get(s)!,
                  stock: e.stock,
                  stockMax: e.stockMax,
                }),
              },
            ];
          }),
        );
      },
      (m) => uno(m, skus, (c) => `cobertura ${c.cobertura} d${c.sobrestock ? ", sobrestock" : ""}`),
    );
  },
};

// ---------------------------------------------------------------------------
// Analista de Ventas
// ---------------------------------------------------------------------------

interface Ventas {
  ventas7: number;
  ventas30: number;
  tendencia: number;
  margen: number;
  precioCompra: number;
  precioVenta: number;
  estacionalidad: string;
}

export const AnalistaVentas = {
  /** Ventas de 7 y 30 días (ajustadas si hay escenario), tendencia y margen. */
  ventas(bus: AgentBus, de: AgentId, skus: string[], ajuste: number): PorSku<Ventas> {
    const f = 1 + ajuste / 100;
    return bus.pedir(
      de,
      "ventas",
      "historial de ventas",
      skus,
      ajuste,
      () =>
        new Map(
          skus.map((s) => {
            const p = bus.fila(s);
            return [
              s,
              {
                ventas7: ajuste ? Math.max(0, Math.round(p.ventas7 * f)) : p.ventas7,
                ventas30: ajuste ? Math.max(0, Math.round(p.ventas30 * f)) : p.ventas30,
                tendencia: p.tendencia,
                margen: round(((p.precioVenta - p.precioCompra) / p.precioVenta) * 100, 1),
                precioCompra: p.precioCompra,
                precioVenta: p.precioVenta,
                estacionalidad: p.estacionalidad,
              },
            ];
          }),
        ),
      (m) => uno(m, skus, (v) => `${v.ventas7} u en 7 d, ${v.ventas30} u en 30 d`),
    );
  },

  /** Rotación mensual: pide el stock al Gestor de Inventario. */
  rotacion(bus: AgentBus, de: AgentId, skus: string[], ajuste: number): PorSku<number> {
    return bus.pedir(
      de,
      "ventas",
      "rotación mensual",
      skus,
      ajuste,
      () => {
        const v = AnalistaVentas.ventas(bus, "ventas", skus, ajuste);
        const e = GestorInventario.estado(bus, "ventas", skus);
        return new Map(skus.map((s) => [s, calcularRotacion(v.get(s)!.ventas30, e.get(s)!.stock)]));
      },
      (m) => uno(m, skus, (r) => `rotación ${r}×/mes`),
    );
  },
};

// ---------------------------------------------------------------------------
// Predictor de Demanda
// ---------------------------------------------------------------------------

interface Demanda {
  demandaDiaria: number;
  demanda7: number;
  demanda14: number;
  demanda30: number;
}
interface Riesgo {
  riesgo: RiskLevel;
  riesgoScore: number;
  probQuiebre: number;
  diasHastaQuiebre: number;
}

export const Predictor = {
  /** Pronóstico: pide las ventas al Analista de Ventas. */
  pronostico(bus: AgentBus, de: AgentId, skus: string[], ajuste: number): PorSku<Demanda> {
    return bus.pedir(
      de,
      "predictor",
      "pronóstico de demanda",
      skus,
      ajuste,
      () => {
        const v = AnalistaVentas.ventas(bus, "predictor", skus, ajuste);
        return new Map(skus.map((s) => [s, pronosticarDemanda(v.get(s)!)]));
      },
      (m) =>
        uno(
          m,
          skus,
          (d) =>
            `${d.demandaDiaria} u/día; ${d.demanda7}/${d.demanda14}/${d.demanda30} u a 7/14/30 d`,
        ),
    );
  },

  /** Riesgo de quiebre: pide cobertura al Gestor y tendencia al Analista. */
  riesgo(bus: AgentBus, de: AgentId, skus: string[], ajuste: number): PorSku<Riesgo> {
    return bus.pedir(
      de,
      "predictor",
      "riesgo de quiebre",
      skus,
      ajuste,
      () => {
        const c = GestorInventario.cobertura(bus, "predictor", skus, ajuste);
        const e = GestorInventario.estado(bus, "predictor", skus);
        const v = AnalistaVentas.ventas(bus, "predictor", skus, ajuste);
        return new Map(
          skus.map((s) => [
            s,
            calcularRiesgo({
              cobertura: c.get(s)!.cobertura,
              leadTime: e.get(s)!.leadTime,
              stock: e.get(s)!.stock,
              stockMin: e.get(s)!.stockMin,
              tendencia: v.get(s)!.tendencia,
            }),
          ]),
        );
      },
      (m) =>
        uno(m, skus, (r) => `riesgo ${RISK_LABEL[r.riesgo].toLowerCase()} ${r.riesgoScore}/100`),
    );
  },
};

// ---------------------------------------------------------------------------
// Agente de Reposición
// ---------------------------------------------------------------------------

interface Plan {
  cantidadRecomendada: number;
  costoReposicion: number;
  stockSeguridad: number;
  puntoReorden: number;
  prioridad: number;
  cuando: string;
  prioridadTexto: string;
  decision: string;
}

export const Reposicion = {
  /** Plan de compra: pide demanda y riesgo al Predictor, stock y cobertura al Gestor. */
  plan(bus: AgentBus, de: AgentId, skus: string[], ajuste: number): PorSku<Plan> {
    return bus.pedir(
      de,
      "reposicion",
      "plan de reposición",
      skus,
      ajuste,
      () => {
        const d = Predictor.pronostico(bus, "reposicion", skus, ajuste);
        const e = GestorInventario.estado(bus, "reposicion", skus);
        const c = GestorInventario.cobertura(bus, "reposicion", skus, ajuste);
        const r = Predictor.riesgo(bus, "reposicion", skus, ajuste);
        const rot = AnalistaVentas.rotacion(bus, "reposicion", skus, ajuste);
        return new Map(
          skus.map((s) => {
            const est = e.get(s)!;
            const cob = c.get(s)!;
            const rie = r.get(s)!;
            const calc = calcularReposicion({
              demandaDiaria: d.get(s)!.demandaDiaria,
              leadTime: est.leadTime,
              stock: est.stock,
              stockMax: est.stockMax,
              precioCompra: est.precioCompra,
              sobrestock: cob.sobrestock,
            });
            // Decisión propia del agente, con su motivo.
            const decision = cob.sobrestock
              ? "No comprar: el Gestor reporta sobrestock."
              : calc.cantidadRecomendada === 0
                ? "No comprar: el stock cubre el horizonte objetivo."
                : est.stock + calc.cantidadRecomendada >= est.stockMax
                  ? "Comprar limitado por el stock máximo."
                  : "Comprar para cubrir lead time + ciclo + seguridad.";
            return [
              s,
              {
                cantidadRecomendada: calc.cantidadRecomendada,
                costoReposicion: calc.costoReposicion,
                stockSeguridad: calc.stockSeguridad,
                puntoReorden: calc.puntoReorden,
                prioridad: calcularPrioridad(rie.riesgoScore, rot.get(s)!),
                cuando: cuandoComprar({
                  cobertura: cob.cobertura,
                  leadTime: est.leadTime,
                  puntoReorden: calc.puntoReorden,
                }),
                prioridadTexto: prioridadTexto(rie),
                decision,
              },
            ];
          }),
        );
      },
      (m) =>
        uno(m, skus, (p) =>
          p.cantidadRecomendada
            ? `comprar ${p.cantidadRecomendada} u por S/ ${p.costoReposicion} (${p.prioridadTexto.toLowerCase()})`
            : p.decision,
        ),
    );
  },
};

// ---------------------------------------------------------------------------
// Herramientas que ve el Supervisor (function calling)
// ---------------------------------------------------------------------------

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
    "Nombre o SKU de uno o varios productos (por ejemplo 'café', 'SKU-1042' o 'arroz y azúcar'). Omitir para analizar el catálogo.",
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
const P_CATEGORIA = {
  type: "string",
  description:
    "Categoría para filtrar (Bebidas, Abarrotes, Lácteos, Limpieza, Snacks, Cuidado personal, Panadería, Congelados).",
};

export const TOOLS: ToolDef[] = [
  {
    name: "buscar_producto",
    agente: "inventario",
    description:
      "Agente Gestor de Inventario. Busca productos del catálogo por nombre, SKU o categoría. Úsalo si un producto no se encuentra o es ambiguo.",
    parameters: {
      type: "object",
      properties: {
        texto: { type: "string", description: "Texto a buscar." },
        categoria: P_CATEGORIA,
      },
    },
  },
  {
    name: "consultar_ventas",
    agente: "ventas",
    description:
      "Agente Analista de Ventas. Devuelve ventas de 7 y 30 días, rotación mensual, tendencia y margen por producto, o un ranking del catálogo.",
    parameters: {
      type: "object",
      properties: {
        producto: P_PRODUCTO,
        orden: {
          type: "string",
          enum: [
            "mas_vendidos",
            "menos_vendidos",
            "mayor_rotacion",
            "menor_rotacion",
            "mayor_margen",
            "menor_margen",
          ],
          description: "Orden del listado cuando no se indica producto.",
        },
        categoria: P_CATEGORIA,
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
      "Agente Gestor de Inventario. Devuelve stock actual, mínimo, máximo, cobertura en días, proveedor, lead time y si hay sobrestock.",
    parameters: {
      type: "object",
      properties: {
        producto: P_PRODUCTO,
        filtro: {
          type: "string",
          enum: [
            "todos",
            "menor_cobertura",
            "sobrestock",
            "bajo_minimo",
            "mayor_lead_time",
            "menor_lead_time",
          ],
          description: "Filtro u orden del listado cuando no se indica producto.",
        },
        categoria: P_CATEGORIA,
        limite: P_LIMITE,
      },
    },
  },
  {
    name: "calcular_reposicion",
    agente: "reposicion",
    description:
      "Agente de Reposición. Calcula cuánto comprar, cuánto cuesta (S/), cuándo pedir y la prioridad, consultando al Predictor y al Gestor de Inventario. Sin producto, devuelve el plan de compra del catálogo ordenado por prioridad y su costo total.",
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

function limiteDe(v: unknown, def = 8) {
  const n = typeof v === "number" ? Math.trunc(v) : Number.parseInt(String(v ?? ""), 10);
  return Number.isFinite(n) ? Math.min(30, Math.max(1, n)) : def;
}

function ajusteDe(v: unknown): number {
  const n = typeof v === "number" ? v : Number.parseFloat(String(v ?? ""));
  return Number.isFinite(n) ? Math.min(300, Math.max(-90, n)) : 0;
}

const texto = (v: unknown, max = 100) => (typeof v === "string" ? v.trim().slice(0, max) : "");

/** Resuelve el argumento `producto`: uno o varios SKUs, o un error con opciones. */
function resolver(
  args: Record<string, unknown>,
  catalogo: BaseProduct[],
): { skus?: string[]; error?: Record<string, unknown> } {
  const raw = texto(args["producto"]);
  if (!raw) return {};
  const r = buscarProductos(raw, catalogo);
  if (r.productos.length && !r.ambiguos.length) return { skus: r.productos.map((p) => p.sku) };
  if (r.ambiguos.length) {
    return {
      error: {
        error: `"${r.ambiguos[0]!.termino}" coincide con varios productos. Pregunta al usuario cuál quiere.`,
        opciones: r.ambiguos[0]!.opciones.map((p) => ({ sku: p.sku, nombre: p.nombre })),
      },
    };
  }
  const parecidos = sugerirProductos(raw, catalogo);
  return {
    error: {
      error: `No existe en el catálogo un producto que coincida con "${raw}".`,
      productos_parecidos: parecidos.map((p) => ({ sku: p.sku, nombre: p.nombre })),
      sugerencia: "Usa buscar_producto para ver nombres exactos del catálogo.",
    },
  };
}

const porCategoria = (catalogo: BaseProduct[], categoria: string) => {
  if (!categoria) return catalogo;
  const c = categoria.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  return catalogo.filter((p) =>
    p.categoria.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").includes(c),
  );
};

/**
 * Ejecuta una herramienta del Supervisor. El agente dueño de la herramienta
 * resuelve la tarea y, si le faltan datos, se los pide a otros agentes por el bus.
 */
export function runTool(
  name: string,
  args: Record<string, unknown>,
  catalogo: BaseProduct[],
  bus: AgentBus = new AgentBus(catalogo),
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
  bus.registrar("supervisor", def.agente, "solicitud", name, JSON.stringify(args).slice(0, 200));
  const r = ejecutar(name, def.agente, args, catalogo, bus);
  bus.registrar(def.agente, "supervisor", "respuesta", name, r.resumen);
  return r;
}

function ejecutar(
  name: string,
  agente: AgentId,
  args: Record<string, unknown>,
  catalogo: BaseProduct[],
  bus: AgentBus,
): ToolResult {
  const ajuste = ajusteDe(args["ajuste_demanda_pct"]);
  const limite = limiteDe(args["limite"]);
  const escenario = ajuste ? { escenario_demanda_pct: ajuste } : {};
  const fail = (data: Record<string, unknown>): ToolResult => ({
    ok: false,
    agente,
    data,
    resumen: String(data["error"]),
    skus: [],
  });

  if (name === "buscar_producto") {
    const t = texto(args["texto"]);
    const cat = texto(args["categoria"], 40);
    const base = porCategoria(catalogo, cat);
    const r = t ? buscarProductos(t, base) : { productos: base, ambiguos: [] };
    const exactos = [...r.productos, ...r.ambiguos.flatMap((a) => a.opciones)];
    const lista = (exactos.length ? exactos : t ? sugerirProductos(t, base, 6) : []).slice(0, 30);
    return {
      ok: lista.length > 0,
      agente,
      data: {
        coincidencias: lista.map((p) => ({
          sku: p.sku,
          nombre: p.nombre,
          categoria: p.categoria,
          proveedor: p.proveedor,
        })),
        ambiguo: r.ambiguos.length > 0,
        exacto: r.productos.length > 0,
      },
      resumen: lista.length
        ? `${lista.length} coincidencia(s): ${lista
            .slice(0, 4)
            .map((p) => p.nombre)
            .join(", ")}${lista.length > 4 ? "…" : ""}.`
        : `Sin coincidencias para "${t || cat}".`,
      skus: lista.map((p) => p.sku),
    };
  }

  const { skus: elegidos, error } = resolver(args, catalogo);
  if (error) return fail(error);
  const universo =
    elegidos ?? porCategoria(catalogo, texto(args["categoria"], 40)).map((p) => p.sku);
  if (!universo.length) return fail({ error: "No hay productos en esa categoría." });
  const nombre = (s: string) => bus.fila(s).nombre;
  const individual = Boolean(elegidos);

  switch (name) {
    case "consultar_ventas": {
      const v = AnalistaVentas.ventas(bus, "ventas", universo, 0);
      const rot = AnalistaVentas.rotacion(bus, "ventas", universo, 0);
      const fila = (s: string) => {
        const x = v.get(s)!;
        return {
          sku: s,
          nombre: nombre(s),
          ventas_7d: x.ventas7,
          ventas_30d: x.ventas30,
          rotacion_mes: rot.get(s)!,
          tendencia_pct: Math.round(x.tendencia * 100),
          margen_pct: x.margen,
          precio_compra: x.precioCompra,
          precio_venta: x.precioVenta,
          estacionalidad: x.estacionalidad,
        };
      };
      if (individual) {
        const filas = universo.map(fila);
        return {
          ok: true,
          agente,
          data: filas.length === 1 ? filas[0]! : { productos: filas },
          resumen: filas
            .map(
              (f) =>
                `${f.nombre}: ${f.ventas_7d} u en 7 d, ${f.ventas_30d} u en 30 d, rotación ${f.rotacion_mes}×/mes`,
            )
            .join("; "),
          skus: universo,
        };
      }
      const orden = String(args["orden"] ?? "mas_vendidos");
      const clave: Record<string, (s: string) => number> = {
        mas_vendidos: (s) => -v.get(s)!.ventas30,
        menos_vendidos: (s) => v.get(s)!.ventas30,
        mayor_rotacion: (s) => -rot.get(s)!,
        menor_rotacion: (s) => rot.get(s)!,
        mayor_margen: (s) => -v.get(s)!.margen,
        menor_margen: (s) => v.get(s)!.margen,
      };
      const k = clave[orden] ?? clave["mas_vendidos"]!;
      const lista = [...universo].sort((a, b) => k(a) - k(b)).slice(0, limite);
      const total30 = universo.reduce((a, s) => a + v.get(s)!.ventas30, 0);
      return {
        ok: true,
        agente,
        data: {
          orden,
          total_skus: universo.length,
          ventas_30d_total: total30,
          productos: lista.map(fila),
        },
        resumen: `${universo.length} SKUs, ${total30} u vendidas en 30 d; ${lista.length} listados (${orden}).`,
        skus: lista,
      };
    }

    case "predecir_demanda": {
      const d = Predictor.pronostico(bus, "predictor", universo, ajuste);
      const fila = (s: string) => ({
        sku: s,
        nombre: nombre(s),
        demanda_diaria: d.get(s)!.demandaDiaria,
        demanda_7d: d.get(s)!.demanda7,
        demanda_14d: d.get(s)!.demanda14,
        demanda_30d: d.get(s)!.demanda30,
      });
      if (individual) {
        const filas = universo.map(fila);
        return {
          ok: true,
          agente,
          data:
            filas.length === 1
              ? { ...filas[0]!, ...escenario }
              : { productos: filas, ...escenario },
          resumen: filas
            .map(
              (f) =>
                `${f.nombre}: ${f.demanda_diaria} u/día; ${f.demanda_7d}/${f.demanda_14d}/${f.demanda_30d} u a 7/14/30 d`,
            )
            .join("; "),
          skus: universo,
        };
      }
      const lista = [...universo]
        .sort((a, b) => d.get(b)!.demanda7 - d.get(a)!.demanda7)
        .slice(0, limite);
      const d7 = universo.reduce((a, s) => a + d.get(s)!.demanda7, 0);
      return {
        ok: true,
        agente,
        data: { demanda_7d_total: d7, productos: lista.map(fila), ...escenario },
        resumen: `Demanda prevista a 7 d del catálogo: ${d7} u; ${lista.length} productos con mayor demanda.`,
        skus: lista,
      };
    }

    case "calcular_riesgo_stock": {
      const r = Predictor.riesgo(bus, "predictor", universo, ajuste);
      const c = GestorInventario.cobertura(bus, "predictor", universo, ajuste);
      const e = GestorInventario.estado(bus, "predictor", universo);
      const fila = (s: string) => ({
        sku: s,
        nombre: nombre(s),
        riesgo: RISK_LABEL[r.get(s)!.riesgo],
        riesgo_score: r.get(s)!.riesgoScore,
        probabilidad_quiebre_pct: r.get(s)!.probQuiebre,
        dias_hasta_quiebre: r.get(s)!.diasHastaQuiebre,
        cobertura_dias: c.get(s)!.cobertura,
        lead_time_dias: e.get(s)!.leadTime,
      });
      if (individual) {
        const filas = universo.map(fila);
        return {
          ok: true,
          agente,
          data:
            filas.length === 1
              ? { ...filas[0]!, ...escenario }
              : { productos: filas, ...escenario },
          resumen: filas
            .map(
              (f) =>
                `${f.nombre}: riesgo ${f.riesgo.toLowerCase()} ${f.riesgo_score}/100, quiebre en ~${f.dias_hasta_quiebre} d (${f.probabilidad_quiebre_pct}%)`,
            )
            .join("; "),
          skus: universo,
        };
      }
      const cuenta = (lvl: RiskLevel) => universo.filter((s) => r.get(s)!.riesgo === lvl).length;
      const lista = [...universo]
        .sort((a, b) => r.get(b)!.riesgoScore - r.get(a)!.riesgoScore)
        .slice(0, limite);
      return {
        ok: true,
        agente,
        data: {
          total_skus: universo.length,
          criticos: cuenta("critico"),
          altos: cuenta("alto"),
          moderados: cuenta("moderado"),
          saludables: cuenta("saludable"),
          productos: lista.map(fila),
          ...escenario,
        },
        resumen: `${cuenta("critico")} críticos y ${cuenta("alto")} altos de ${universo.length} SKUs; el más urgente es ${lista[0] ? nombre(lista[0]) : "—"}.`,
        skus: lista,
      };
    }

    case "consultar_inventario": {
      const e = GestorInventario.estado(bus, "inventario", universo);
      const c = GestorInventario.cobertura(bus, "inventario", universo, 0);
      const fila = (s: string) => ({
        sku: s,
        nombre: nombre(s),
        stock: e.get(s)!.stock,
        stock_min: e.get(s)!.stockMin,
        stock_max: e.get(s)!.stockMax,
        cobertura_dias: c.get(s)!.cobertura,
        lead_time_dias: e.get(s)!.leadTime,
        proveedor: e.get(s)!.proveedor,
        sobrestock: c.get(s)!.sobrestock,
        valor_inventario_soles: e.get(s)!.valorInventario,
      });
      if (individual) {
        const filas = universo.map(fila);
        return {
          ok: true,
          agente,
          data: filas.length === 1 ? filas[0]! : { productos: filas },
          resumen: filas
            .map(
              (f) =>
                `${f.nombre}: stock ${f.stock} u (mín ${f.stock_min}, máx ${f.stock_max}), cobertura ${f.cobertura_dias} d`,
            )
            .join("; "),
          skus: universo,
        };
      }
      const filtro = String(args["filtro"] ?? "menor_cobertura");
      let lista = [...universo];
      if (filtro === "sobrestock") lista = lista.filter((s) => c.get(s)!.sobrestock);
      if (filtro === "bajo_minimo")
        lista = lista.filter((s) => e.get(s)!.stock < e.get(s)!.stockMin);
      const orden: Record<string, (s: string) => number> = {
        sobrestock: (s) => -e.get(s)!.valorInventario,
        mayor_lead_time: (s) => -e.get(s)!.leadTime,
        menor_lead_time: (s) => e.get(s)!.leadTime,
      };
      const k = orden[filtro] ?? ((s: string) => c.get(s)!.cobertura);
      lista = lista.sort((a, b) => k(a) - k(b)).slice(0, limite);
      const sobre = universo.filter((s) => c.get(s)!.sobrestock);
      const capital = Math.round(sobre.reduce((a, s) => a + e.get(s)!.valorInventario, 0));
      const promedio = round(
        universo.reduce((a, s) => a + c.get(s)!.cobertura, 0) / universo.length,
        1,
      );
      return {
        ok: true,
        agente,
        data: {
          filtro,
          cobertura_promedio_dias: promedio,
          productos_en_sobrestock: sobre.length,
          capital_inmovilizado_soles: capital,
          valor_inventario_soles: Math.round(
            universo.reduce((a, s) => a + e.get(s)!.valorInventario, 0),
          ),
          productos: lista.map(fila),
        },
        resumen: `Filtro ${filtro}: ${lista.length} productos; cobertura promedio ${promedio} d; capital inmovilizado S/ ${capital}.`,
        skus: lista,
      };
    }

    case "calcular_reposicion": {
      const plan = Reposicion.plan(bus, "reposicion", universo, ajuste);
      // Datos que Reposición ya obtuvo de otros agentes (vienen de la memoria, sin nuevos mensajes).
      const d = Predictor.pronostico(bus, "reposicion", universo, ajuste);
      const e = GestorInventario.estado(bus, "reposicion", universo);
      const c = GestorInventario.cobertura(bus, "reposicion", universo, ajuste);
      const r = Predictor.riesgo(bus, "reposicion", universo, ajuste);
      const fila = (s: string) => ({
        sku: s,
        nombre: nombre(s),
        cantidad_recomendada: plan.get(s)!.cantidadRecomendada,
        costo_soles: plan.get(s)!.costoReposicion,
        cuando: plan.get(s)!.cuando,
        prioridad: plan.get(s)!.prioridadTexto,
        decision_del_agente: plan.get(s)!.decision,
        stock_actual: e.get(s)!.stock,
        cobertura_dias: c.get(s)!.cobertura,
        riesgo_score: r.get(s)!.riesgoScore,
        stock_seguridad: plan.get(s)!.stockSeguridad,
        demanda_diaria: d.get(s)!.demandaDiaria,
        lead_time_dias: e.get(s)!.leadTime,
        formula: `demanda_diaria × (lead_time + ${CICLO_DIAS}) + stock_seguridad − stock_actual, redondeado a múltiplo de 10 y limitado por stock_max`,
      });
      if (individual) {
        const filas = universo.map(fila);
        return {
          ok: true,
          agente,
          data:
            filas.length === 1
              ? { ...filas[0]!, ...escenario }
              : { productos: filas, ...escenario },
          resumen: filas
            .map((f) =>
              f.cantidad_recomendada
                ? `${f.nombre}: comprar ${f.cantidad_recomendada} u por S/ ${f.costo_soles} — ${f.cuando.toLowerCase()}`
                : `${f.nombre}: ${f.decision_del_agente}`,
            )
            .join("; "),
          skus: universo,
        };
      }
      const reponer = universo
        .filter((s) => plan.get(s)!.cantidadRecomendada > 0)
        .sort((a, b) => plan.get(b)!.prioridad - plan.get(a)!.prioridad);
      const costo = Math.round(reponer.reduce((a, s) => a + plan.get(s)!.costoReposicion, 0));
      const lista = reponer.slice(0, limite);
      return {
        ok: true,
        agente,
        data: {
          productos_a_reponer: reponer.length,
          costo_total_soles: costo,
          productos: lista.map(fila),
          ...escenario,
        },
        resumen: `${reponer.length} productos a reponer por S/ ${costo}; prioridad máxima: ${lista[0] ? nombre(lista[0]) : "—"}.`,
        skus: lista,
      };
    }

    default:
      return fail({ error: "Sin implementación" });
  }
}

/** Todos los números presentes en un valor JSON (para verificar la respuesta del LLM). */
export function numerosDe(value: unknown, out = new Set<number>()): Set<number> {
  const agregar = (n: number) => {
    out.add(n);
    out.add(Math.round(n));
    out.add(round(n, 1));
    out.add(round(n, 2));
  };
  if (typeof value === "number" && Number.isFinite(value)) {
    agregar(value);
  } else if (typeof value === "string") {
    for (const m of value.matchAll(/\d+(?:[.,]\d+)?/g)) {
      const n = Number(m[0].replace(",", "."));
      if (Number.isFinite(n)) agregar(n);
      // "3,885" escrito con coma de miles dentro de un texto
      if (/^\d{1,3},\d{3}$/.test(m[0])) agregar(Number(m[0].replace(",", "")));
    }
  } else if (Array.isArray(value)) {
    for (const v of value) numerosDe(v, out);
  } else if (value && typeof value === "object") {
    for (const v of Object.values(value)) numerosDe(v, out);
  }
  return out;
}
