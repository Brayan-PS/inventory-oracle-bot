import { createFileRoute, Link } from "@tanstack/react-router";
import {
  Area,
  AreaChart,
  Bar as RBar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { AppShell } from "@/components/AppShell";
import {
  Bar,
  Kpi,
  Panel,
  PanelHead,
  RiskBadge,
  money,
  moneyShort,
  riskColorVar,
} from "@/components/kit";
import { MODEL_METRICS, aggregateSeries } from "@/lib/inventory";
import { useInventory } from "@/lib/store";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Centro de Inteligencia | Intelli-Stock" },
      {
        name: "description",
        content:
          "Panel de mando multiagente para gestión predictiva de inventarios: riesgo de quiebre, pronóstico de demanda y recomendaciones de reposición explicadas.",
      },
      { property: "og:title", content: "Centro de Inteligencia | Intelli-Stock" },
      {
        property: "og:description",
        content:
          "Qué comprar, cuánto, cuándo y por qué: un analista de inventarios impulsado por agentes de IA.",
      },
    ],
  }),
  component: CentroInteligencia,
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

function CentroInteligencia() {
  const { METRICS, PRODUCTS } = useInventory();
  const series = aggregateSeries(PRODUCTS);
  const riskData = [
    { name: "Crítico", value: METRICS.criticos, color: "var(--accent)" },
    { name: "Alto", value: METRICS.altos, color: "var(--warn)" },
    { name: "Moderado", value: METRICS.moderados, color: "var(--info)" },
    { name: "Saludable", value: METRICS.saludables, color: "var(--good)" },
  ];
  const topRiesgo = [...PRODUCTS].sort((a, b) => b.riesgoScore - a.riesgoScore).slice(0, 6);
  const rotacion = [...PRODUCTS].sort((a, b) => b.rotacion - a.rotacion).slice(0, 8);
  const ventasSemana = series
    .slice(0, 8)
    .map((s) => ({ semana: s.semana, ventas: s.demanda ?? 0 }));
  const horizontes = [
    { h: "7 días", demanda: PRODUCTS.reduce((a, p) => a + p.demanda7, 0) },
    { h: "14 días", demanda: PRODUCTS.reduce((a, p) => a + p.demanda14, 0) },
    { h: "30 días", demanda: PRODUCTS.reduce((a, p) => a + p.demanda30, 0) },
  ];
  const coberturaBuckets = [
    { rango: "0-7d", n: PRODUCTS.filter((p) => p.cobertura <= 7).length },
    { rango: "8-15d", n: PRODUCTS.filter((p) => p.cobertura > 7 && p.cobertura <= 15).length },
    { rango: "16-30d", n: PRODUCTS.filter((p) => p.cobertura > 15 && p.cobertura <= 30).length },
    { rango: "31-60d", n: PRODUCTS.filter((p) => p.cobertura > 30 && p.cobertura <= 60).length },
    { rango: "+60d", n: PRODUCTS.filter((p) => p.cobertura > 60).length },
  ];
  const inmovilizado = PRODUCTS.filter((p) => p.sobrestock)
    .sort((a, b) => b.valorInventario - a.valorInventario)
    .slice(0, 5);

  return (
    <AppShell
      title="Centro de Inteligencia"
      subtitle="Tienda central · encargado de compras · datos al día de hoy"
    >
      <section className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5">
        <Kpi label="Total SKUs" value={METRICS.totalSkus} hint="Catálogo monitoreado" delay={0} />
        <Kpi
          label="Productos críticos"
          value={METRICS.criticos}
          tone="accent"
          hint={`${PRODUCTS.filter((p) => p.diasHastaQuiebre <= 3).length} con quiebre en <3 días`}
          delay={40}
        />
        <Kpi
          label="Riesgo medio"
          value={`${METRICS.riesgoMedio}`}
          unit="/100"
          tone="warn"
          hint="Índice agregado del catálogo"
          delay={80}
        />
        <Kpi
          label="Productos saludables"
          value={METRICS.saludables}
          tone="good"
          hint={`${METRICS.moderados} en riesgo moderado`}
          delay={120}
        />
        <Kpi
          label="Con sobrestock"
          value={METRICS.sobrestock}
          tone="info"
          hint={`${moneyShort(METRICS.capitalInmovilizado)} inmovilizados`}
          delay={160}
        />
        <Kpi
          label="Cobertura promedio"
          value={METRICS.coberturaPromedio}
          unit="días"
          hint="Objetivo operativo: 21 días"
          delay={200}
        />
        <Kpi
          label="Pedidos pendientes"
          value={METRICS.pedidosPendientes}
          tone="warn"
          hint={`${moneyShort(METRICS.costoPendiente)} por aprobar`}
          delay={240}
        />
        <Kpi
          label="Valor del inventario"
          value={moneyShort(METRICS.valorInventario)}
          hint="Valorizado a precio de compra"
          delay={280}
        />
        <Kpi
          label="Precisión del modelo"
          value={MODEL_METRICS.precision}
          unit="%"
          tone="good"
          hint={`WAPE ${MODEL_METRICS.wape}% · MAE ${MODEL_METRICS.mae}`}
          delay={320}
        />
        <Kpi
          label="Ventas 30 días"
          value={METRICS.ventas30.toLocaleString("es-PE")}
          unit="u"
          hint="Unidades vendidas en el catálogo"
          delay={360}
        />
      </section>

      <section className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Panel className="p-5 xl:col-span-2" delay={60}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="font-display font-semibold tracking-tight">
                Demanda histórica vs. pronóstico vs. stock
              </h2>
              <p className="font-mono text-[11px] text-muted-foreground">
                8 semanas reales + 4 semanas proyectadas
              </p>
            </div>
            <div className="flex gap-1 font-mono text-[11px]">
              <span className="rounded bg-surface-2 px-2 py-1 text-good">■ Demanda</span>
              <span className="rounded bg-surface-2 px-2 py-1 text-info">■ Pronóstico</span>
              <span className="rounded bg-surface-2 px-2 py-1 text-accent">■ Stock</span>
            </div>
          </div>
          <div className="mt-4 h-[220px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={series}>
                <CartesianGrid stroke="var(--line)" vertical={false} />
                <XAxis
                  dataKey="semana"
                  stroke="var(--muted-foreground)"
                  fontSize={11}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  stroke="var(--muted-foreground)"
                  fontSize={11}
                  tickLine={false}
                  axisLine={false}
                  width={44}
                />
                <Tooltip {...tooltipStyle} />
                <Line
                  type="monotone"
                  dataKey="demanda"
                  name="Demanda"
                  stroke="var(--good)"
                  strokeWidth={2.5}
                  dot={false}
                  connectNulls={false}
                />
                <Line
                  type="monotone"
                  dataKey="pronostico"
                  name="Pronóstico"
                  stroke="var(--info)"
                  strokeWidth={2}
                  strokeDasharray="5 4"
                  dot={false}
                />
                <Line
                  type="monotone"
                  dataKey="stock"
                  name="Stock"
                  stroke="var(--accent)"
                  strokeWidth={2}
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Panel>

        <Panel className="p-5" delay={100}>
          <h2 className="font-display font-semibold tracking-tight">Distribución de riesgo</h2>
          <p className="font-mono text-[11px] text-muted-foreground">
            {METRICS.totalSkus} SKUs clasificados
          </p>
          <div className="mt-2 flex flex-wrap items-center justify-center gap-4">
            <div className="h-[150px] w-[150px] shrink-0">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={riskData}
                    dataKey="value"
                    innerRadius={44}
                    outerRadius={70}
                    paddingAngle={2}
                    stroke="none"
                  >
                    {riskData.map((d) => (
                      <Cell key={d.name} fill={d.color} />
                    ))}
                  </Pie>
                  <Tooltip {...tooltipStyle} />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <ul className="min-w-28 flex-1 space-y-2 text-[12px]">
              {riskData.map((d) => (
                <li key={d.name} className="flex items-center gap-2">
                  <span className="size-2.5 rounded-sm" style={{ background: d.color }} />
                  <span className="text-muted-foreground">{d.name}</span>
                  <span className="ml-auto font-mono">{d.value}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="mt-3 border-t border-line pt-3 text-[12px] text-muted-foreground">
            Regla aplicada: cobertura menor al lead time del proveedor eleva el riesgo a crítico
            automáticamente.
          </div>
        </Panel>
      </section>

      <section className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Panel className="xl:col-span-2" delay={140}>
          <PanelHead
            title="Top productos en riesgo"
            subtitle="Ordenado por probabilidad de quiebre"
            right={
              <Link
                to="/productos"
                className="rounded-lg border border-line px-3 py-1.5 text-xs text-muted-foreground hover:border-muted-foreground hover:text-foreground"
              >
                Ver todos
              </Link>
            }
          />
          <div className="divide-y divide-line/70">
            {topRiesgo.map((p, i) => (
              <Link
                key={p.sku}
                to="/productos/$sku"
                params={{ sku: p.sku }}
                className="flex items-center gap-4 px-5 py-3 transition-colors hover:bg-surface-2"
              >
                <span className="w-6 font-mono text-xs text-muted-foreground">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{p.nombre}</p>
                  <p className="font-mono text-[11px] text-muted-foreground">
                    {p.sku} · cobertura {p.cobertura}d · lead {p.leadTime}d · rotación {p.rotacion}×
                  </p>
                </div>
                <div className="hidden w-28 md:block">
                  <Bar value={p.probQuiebre} level={p.riesgo} />
                </div>
                <span
                  className="hidden w-10 text-right font-mono text-xs md:block"
                  style={{ color: riskColorVar(p.riesgo) }}
                >
                  {p.probQuiebre}%
                </span>
                <RiskBadge level={p.riesgo} className="w-20" />
              </Link>
            ))}
          </div>
        </Panel>

        <Panel className="p-5" delay={180}>
          <h2 className="font-display font-semibold tracking-tight">Demanda proyectada</h2>
          <p className="font-mono text-[11px] text-muted-foreground">Horizontes 7 / 14 / 30 días</p>
          <div className="mt-4 space-y-3">
            {horizontes.map((h) => (
              <div key={h.h}>
                <div className="flex justify-between text-[12px]">
                  <span className="text-muted-foreground">{h.h}</span>
                  <span className="font-mono">{h.demanda.toLocaleString("es-PE")} u</span>
                </div>
                <div className="mt-1 h-2 overflow-hidden rounded-full bg-line">
                  <div
                    className="h-full rounded-full bg-info"
                    style={{ width: `${(h.demanda / horizontes[2]!.demanda) * 100}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
          <div className="mt-5 border-t border-line pt-4">
            <p className="font-mono text-[11px] uppercase text-muted-foreground">
              Capital inmovilizado
            </p>
            <p className="mt-1 font-display text-2xl font-bold text-warn">
              {money(METRICS.capitalInmovilizado)}
            </p>
            <ul className="mt-2 space-y-1">
              {inmovilizado.map((p) => (
                <li key={p.sku} className="flex justify-between text-[12px] text-muted-foreground">
                  <span className="truncate pr-2">{p.nombre}</span>
                  <span className="font-mono">{moneyShort(p.valorInventario)}</span>
                </li>
              ))}
            </ul>
          </div>
        </Panel>
      </section>

      <section className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Panel className="p-5" delay={220}>
          <h2 className="font-display font-semibold tracking-tight">Ventas últimas semanas</h2>
          <p className="font-mono text-[11px] text-muted-foreground">
            Unidades vendidas en todo el catálogo
          </p>
          <div className="mt-4 h-[170px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={ventasSemana}>
                <defs>
                  <linearGradient id="gv" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--good)" stopOpacity={0.5} />
                    <stop offset="100%" stopColor="var(--good)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="var(--line)" vertical={false} />
                <XAxis
                  dataKey="semana"
                  stroke="var(--muted-foreground)"
                  fontSize={11}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  stroke="var(--muted-foreground)"
                  fontSize={11}
                  tickLine={false}
                  axisLine={false}
                  width={44}
                />
                <Tooltip {...tooltipStyle} />
                <Area
                  type="monotone"
                  dataKey="ventas"
                  stroke="var(--good)"
                  strokeWidth={2}
                  fill="url(#gv)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Panel>

        <Panel className="p-5" delay={260}>
          <h2 className="font-display font-semibold tracking-tight">Productos por rotación</h2>
          <p className="font-mono text-[11px] text-muted-foreground">
            Veces que rota el stock al mes
          </p>
          <div className="mt-4 h-[170px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={rotacion} layout="vertical" margin={{ left: 10 }}>
                <CartesianGrid stroke="var(--line)" horizontal={false} />
                <XAxis
                  type="number"
                  stroke="var(--muted-foreground)"
                  fontSize={11}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  type="category"
                  dataKey="nombre"
                  stroke="var(--muted-foreground)"
                  fontSize={10}
                  tickLine={false}
                  axisLine={false}
                  width={110}
                  tickFormatter={(v: string) => (v.length > 16 ? `${v.slice(0, 15)}…` : v)}
                />
                <Tooltip {...tooltipStyle} />
                <RBar dataKey="rotacion" name="Rotación" radius={[0, 4, 4, 0]}>
                  {rotacion.map((p) => (
                    <Cell key={p.sku} fill={riskColorVar(p.riesgo)} />
                  ))}
                </RBar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>

        <Panel className="p-5" delay={300}>
          <h2 className="font-display font-semibold tracking-tight">Cobertura de inventario</h2>
          <p className="font-mono text-[11px] text-muted-foreground">
            SKUs por rango de días de cobertura
          </p>
          <div className="mt-4 h-[170px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={coberturaBuckets}>
                <CartesianGrid stroke="var(--line)" vertical={false} />
                <XAxis
                  dataKey="rango"
                  stroke="var(--muted-foreground)"
                  fontSize={11}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  stroke="var(--muted-foreground)"
                  fontSize={11}
                  tickLine={false}
                  axisLine={false}
                  width={30}
                />
                <Tooltip {...tooltipStyle} />
                <RBar dataKey="n" name="SKUs" radius={[4, 4, 0, 0]}>
                  {coberturaBuckets.map((b, i) => (
                    <Cell
                      key={b.rango}
                      fill={
                        i === 0
                          ? "var(--accent)"
                          : i === 1
                            ? "var(--warn)"
                            : i === 4
                              ? "var(--info)"
                              : "var(--good)"
                      }
                    />
                  ))}
                </RBar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>
      </section>
    </AppShell>
  );
}
