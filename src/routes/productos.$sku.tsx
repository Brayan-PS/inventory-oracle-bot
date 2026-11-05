import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { AppShell } from "@/components/AppShell";
import { Bar, Kpi, Panel, PanelHead, RiskBadge, Tag, money } from "@/components/kit";
import { loadProduct } from "@/lib/data.functions";
import { useStore } from "@/lib/store";

export const Route = createFileRoute("/productos/$sku")({
  loader: async ({ params }) => {
    const producto = await loadProduct({ data: params.sku });
    if (!producto) throw notFound();
    return producto;
  },
  head: ({ loaderData }) => {
    if (!loaderData) {
      return {
        meta: [
          { title: "Producto no encontrado | Intelli-Stock" },
          { name: "robots", content: "noindex" },
        ],
      };
    }
    const t = `${loaderData.nombre} | Intelli-Stock`;
    const d = `Ficha predictiva de ${loaderData.nombre} (${loaderData.sku}): historial de ventas, forecast, riesgo de quiebre y explicación de la recomendación de compra.`;
    return {
      meta: [
        { title: t },
        { name: "description", content: d },
        { property: "og:title", content: t },
        { property: "og:description", content: d },
      ],
    };
  },
  notFoundComponent: ProductoNoEncontrado,
  component: DetalleProducto,
});

const tooltipStyle = {
  contentStyle: {
    background: "var(--surface-2)",
    border: "1px solid var(--line)",
    borderRadius: 10,
    fontSize: 12,
  },
  labelStyle: { color: "var(--muted-foreground)", fontSize: 11 },
};

function ProductoNoEncontrado() {
  return (
    <AppShell title="Producto no encontrado" subtitle="El SKU solicitado no existe en el catálogo">
      <Panel className="p-8 text-center">
        <p className="text-muted-foreground">No encontramos ese producto.</p>
        <Link
          to="/productos"
          className="mt-4 inline-block rounded-lg bg-accent px-4 py-2 text-accent-foreground"
        >
          Volver al catálogo
        </Link>
      </Panel>
    </AppShell>
  );
}

function DetalleProducto() {
  const p = Route.useLoaderData();
  const { addDecision, estadoDe } = useStore();
  const estado = estadoDe(p.sku);

  const serie = [
    ...p.historial
      .slice(-28)
      .map((h) => ({ dia: h.dia, ventas: h.ventas, pronostico: null as number | null })),
    ...p.forecast
      .slice(0, 14)
      .map((f) => ({ dia: f.dia, ventas: null as number | null, pronostico: f.pronostico })),
  ];

  return (
    <AppShell title={p.nombre} subtitle={`${p.sku} · ${p.categoria} · ${p.proveedor}`}>
      <div className="flex flex-wrap items-center gap-2">
        <Link to="/productos" className="font-mono text-[11px] text-info hover:underline">
          ← Catálogo
        </Link>
        <RiskBadge level={p.riesgo} />
        <Tag tone="muted">Lead time {p.leadTime} días</Tag>
        <Tag tone="muted">Margen {p.margen}%</Tag>
        <Tag tone={p.sobrestock ? "info" : "good"}>
          {p.sobrestock ? "Sobrestock detectado" : "Rotación sana"}
        </Tag>
      </div>

      <section className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
        <Kpi
          label="Stock actual"
          value={p.stock}
          unit="u"
          hint={`mín ${p.stockMin} · máx ${p.stockMax}`}
        />
        <Kpi
          label="Cobertura"
          value={p.cobertura}
          unit="días"
          tone={p.cobertura < p.leadTime ? "accent" : "default"}
          hint={`quiebre en ~${p.diasHastaQuiebre}d`}
          delay={40}
        />
        <Kpi
          label="Demanda prevista 7d"
          value={p.demanda7}
          unit="u"
          tone="info"
          hint={`${p.demandaDiaria} u/día`}
          delay={80}
        />
        <Kpi
          label="Ventas 30d"
          value={p.ventas30}
          unit="u"
          hint={`7 días: ${p.ventas7} u`}
          delay={120}
        />
        <Kpi
          label="Riesgo"
          value={p.riesgoScore}
          unit="/100"
          tone={p.riesgo === "critico" ? "accent" : p.riesgo === "alto" ? "warn" : "good"}
          hint={`prob. quiebre ${p.probQuiebre}%`}
          delay={160}
        />
        <Kpi
          label="Valor en almacén"
          value={money(p.valorInventario)}
          hint={`compra ${money(p.precioCompra)} · venta ${money(p.precioVenta)}`}
          delay={200}
        />
      </section>

      <section className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Panel className="p-5 xl:col-span-2" delay={60}>
          <h2 className="font-display font-semibold tracking-tight">
            Historial de ventas y pronóstico
          </h2>
          <p className="font-mono text-[11px] text-muted-foreground">
            28 días reales + 14 días pronosticados (LightGBM v2.4)
          </p>
          <div className="mt-4 h-[230px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={serie}>
                <CartesianGrid stroke="var(--line)" vertical={false} />
                <XAxis
                  dataKey="dia"
                  stroke="var(--muted-foreground)"
                  fontSize={10}
                  tickLine={false}
                  axisLine={false}
                  interval={4}
                />
                <YAxis
                  stroke="var(--muted-foreground)"
                  fontSize={11}
                  tickLine={false}
                  axisLine={false}
                  width={34}
                />
                <Tooltip {...tooltipStyle} />
                <Line
                  type="monotone"
                  dataKey="ventas"
                  name="Ventas reales"
                  stroke="var(--good)"
                  strokeWidth={2.4}
                  dot={false}
                  connectNulls={false}
                />
                <Line
                  type="monotone"
                  dataKey="pronostico"
                  name="Pronóstico"
                  stroke="var(--info)"
                  strokeWidth={2.2}
                  strokeDasharray="5 4"
                  dot={false}
                  connectNulls={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Panel>

        <Panel className="p-5" delay={100}>
          <h2 className="font-display font-semibold tracking-tight">
            Banda de confianza a 30 días
          </h2>
          <p className="font-mono text-[11px] text-muted-foreground">
            Escenario mínimo / esperado / máximo
          </p>
          <div className="mt-4 h-[230px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={p.forecast}>
                <defs>
                  <linearGradient id="band" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--info)" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="var(--info)" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="var(--line)" vertical={false} />
                <XAxis
                  dataKey="dia"
                  stroke="var(--muted-foreground)"
                  fontSize={10}
                  tickLine={false}
                  axisLine={false}
                  interval={5}
                />
                <YAxis
                  stroke="var(--muted-foreground)"
                  fontSize={11}
                  tickLine={false}
                  axisLine={false}
                  width={34}
                />
                <Tooltip {...tooltipStyle} />
                <Area type="monotone" dataKey="max" name="Máximo" stroke="none" fill="url(#band)" />
                <Area
                  type="monotone"
                  dataKey="pronostico"
                  name="Esperado"
                  stroke="var(--info)"
                  strokeWidth={2}
                  fill="none"
                />
                <Area
                  type="monotone"
                  dataKey="min"
                  name="Mínimo"
                  stroke="var(--line)"
                  strokeWidth={1}
                  fill="none"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Panel>
      </section>

      <section className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Panel className="xl:col-span-2" delay={140}>
          <PanelHead
            title="Explicación de la IA"
            subtitle="Factores que influyeron en la recomendación"
          />
          <div className="space-y-4 p-5">
            <p className="text-[13px] leading-relaxed text-foreground/85">
              {p.cantidadRecomendada > 0
                ? `El Agente de Reposición propone comprar ${p.cantidadRecomendada} unidades a ${p.proveedor} por ${money(p.costoReposicion)}. La demanda diaria estimada es de ${p.demandaDiaria} u; para cubrir el lead time de ${p.leadTime} días más un ciclo de 14 días se necesitan ${Math.ceil(p.demandaDiaria * (p.leadTime + 14))} unidades, a lo que se suma un stock de seguridad de ${p.stockSeguridad} u. Descontando las ${p.stock} u en almacén y respetando el stock máximo de ${p.stockMax}, la cantidad final es ${p.cantidadRecomendada} u.`
                : `No se propone compra: el stock de ${p.stock} u cubre ${p.cobertura} días frente a un lead time de ${p.leadTime} días${p.sobrestock ? ", y el producto está clasificado como sobrestock por su baja rotación" : ""}.`}
            </p>
            <ul className="space-y-2">
              {p.factores.map((f, i) => (
                <li key={i} className="flex gap-2 text-[13px] leading-snug text-muted-foreground">
                  <span className="text-accent">▸</span>
                  <span>{f}</span>
                </li>
              ))}
            </ul>
            <div>
              <div className="mb-1 flex justify-between font-mono text-[11px] text-muted-foreground">
                <span>Probabilidad de quiebre antes de reponer</span>
                <span>{p.probQuiebre}%</span>
              </div>
              <Bar value={p.probQuiebre} level={p.riesgo} />
            </div>
            <div className="flex flex-wrap gap-2 border-t border-line pt-4">
              <Tag tone="muted">Punto de reorden: {p.puntoReorden} u</Tag>
              <Tag tone="muted">Stock de seguridad: {p.stockSeguridad} u</Tag>
              <Tag tone="muted">Demanda 14d: {p.demanda14} u</Tag>
              <Tag tone="muted">Demanda 30d: {p.demanda30} u</Tag>
              <Tag tone="muted">Estacionalidad: {p.estacionalidad}</Tag>
            </div>
          </div>
        </Panel>

        <div className="space-y-4">
          <Panel className="p-5" delay={180}>
            <p className="font-mono text-[10px] uppercase tracking-wider text-accent">
              Acción recomendada
            </p>
            {p.cantidadRecomendada > 0 ? (
              <>
                <p className="mt-2 font-display text-lg font-semibold tracking-tight">
                  Comprar {p.cantidadRecomendada} unidades
                </p>
                <p className="mt-1 text-[13px] text-muted-foreground">
                  {money(p.costoReposicion)} a {p.proveedor} · entrega en {p.leadTime} días
                </p>
                {estado ? (
                  <p className="mt-4 font-mono text-[11px] text-good">
                    ◆ Decisión registrada: {estado}.
                  </p>
                ) : (
                  <div className="mt-4 flex gap-2">
                    <button
                      onClick={() =>
                        addDecision({
                          sku: p.sku,
                          nombre: p.nombre,
                          cantidadSugerida: p.cantidadRecomendada,
                          cantidadFinal: p.cantidadRecomendada,
                          costo: p.costoReposicion,
                          estado: "aprobado",
                          motivo: "Aprobado desde la ficha del producto.",
                        })
                      }
                      className="flex-1 rounded-lg bg-accent py-2.5 text-[13px] font-medium text-accent-foreground hover:bg-accent/90"
                    >
                      Aprobar
                    </button>
                    <button
                      onClick={() =>
                        addDecision({
                          sku: p.sku,
                          nombre: p.nombre,
                          cantidadSugerida: p.cantidadRecomendada,
                          cantidadFinal: 0,
                          costo: 0,
                          estado: "pospuesto",
                          motivo: "Pospuesto desde la ficha del producto.",
                        })
                      }
                      className="rounded-lg border border-line px-3 py-2.5 text-[13px] text-muted-foreground hover:text-foreground"
                    >
                      Posponer
                    </button>
                  </div>
                )}
                <p className="mt-3 font-mono text-[11px] text-muted-foreground">
                  <span className="text-warn">◆</span> Toda compra requiere aprobación humana.
                </p>
              </>
            ) : (
              <p className="mt-2 text-[13px] text-muted-foreground">
                Sin acción de compra.{" "}
                {p.sobrestock
                  ? "Se sugiere promocionar para liberar capital."
                  : "El nivel de stock es adecuado."}
              </p>
            )}
          </Panel>

          <Panel delay={220}>
            <PanelHead title="Historial de reposiciones" subtitle="Últimas órdenes registradas" />
            <div className="divide-y divide-line/70">
              {p.reposiciones.map((r) => (
                <div
                  key={r.fecha}
                  className="flex items-center justify-between px-5 py-3 text-[13px]"
                >
                  <div>
                    <p className="font-mono text-[11px] text-muted-foreground">{r.fecha}</p>
                    <p>{r.cantidad} unidades</p>
                  </div>
                  <div className="text-right">
                    <p className="font-mono">{money(r.costo)}</p>
                    <p className="font-mono text-[11px] text-good">{r.estado}</p>
                  </div>
                </div>
              ))}
            </div>
          </Panel>
        </div>
      </section>
    </AppShell>
  );
}
