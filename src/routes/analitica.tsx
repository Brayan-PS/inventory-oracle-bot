import { createFileRoute } from "@tanstack/react-router";
import {
  Bar as RBar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  PolarAngleAxis,
  PolarGrid,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";
import { AppShell } from "@/components/AppShell";
import { Kpi, Panel, PanelHead, money, moneyShort, riskColorVar } from "@/components/kit";
import { useInventory } from "@/lib/store";

export const Route = createFileRoute("/analitica")({
  head: () => ({
    meta: [
      { title: "Analítica | Intelli-Stock" },
      {
        name: "description",
        content:
          "Analítica de ventas, rotación, margen y riesgo por categoría y proveedor, con el cruce entre cobertura y demanda que alimenta al Agente Analista.",
      },
      { property: "og:title", content: "Analítica | Intelli-Stock" },
      {
        property: "og:description",
        content: "Tendencias, rotación y desempeño por categoría y proveedor.",
      },
    ],
  }),
  component: Analitica,
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

function Analitica() {
  const { CATEGORY_LIST, METRICS, PRODUCTS, SUPPLIER_LIST } = useInventory();
  const porCategoria = CATEGORY_LIST.map((c) => {
    const items = PRODUCTS.filter((p) => p.categoria === c);
    return {
      categoria: c,
      ventas: items.reduce((a, p) => a + p.ventas30, 0),
      ingresos: Math.round(items.reduce((a, p) => a + p.ventas30 * p.precioVenta, 0)),
      margen: Math.round(items.reduce((a, p) => a + p.margen, 0) / items.length),
      riesgo: Math.round(items.reduce((a, p) => a + p.riesgoScore, 0) / items.length),
    };
  }).sort((a, b) => b.ingresos - a.ingresos);

  const porProveedor = SUPPLIER_LIST.map((s) => {
    const items = PRODUCTS.filter((p) => p.proveedor === s);
    return {
      proveedor: s,
      skus: items.length,
      lead: Math.round((items.reduce((a, p) => a + p.leadTime, 0) / items.length) * 10) / 10,
      riesgo: Math.round(items.reduce((a, p) => a + p.riesgoScore, 0) / items.length),
      compra: Math.round(items.reduce((a, p) => a + p.costoReposicion, 0)),
    };
  }).sort((a, b) => b.compra - a.compra);

  const dispersion = PRODUCTS.map((p) => ({
    cobertura: p.cobertura,
    demanda: p.demandaDiaria,
    valor: p.valorInventario,
    nombre: p.nombre,
    riesgo: p.riesgo,
  }));

  const radar = CATEGORY_LIST.map((c) => {
    const items = PRODUCTS.filter((p) => p.categoria === c);
    return {
      categoria: c.length > 12 ? `${c.slice(0, 11)}…` : c,
      rotacion: Math.round((items.reduce((a, p) => a + p.rotacion, 0) / items.length) * 100) / 100,
    };
  });

  const ingresos30 = Math.round(PRODUCTS.reduce((a, p) => a + p.ventas30 * p.precioVenta, 0));
  const margenPromedio = Math.round(PRODUCTS.reduce((a, p) => a + p.margen, 0) / PRODUCTS.length);
  const enCrecimiento = PRODUCTS.filter((p) => p.tendencia > 0.1).length;
  const enCaida = PRODUCTS.filter((p) => p.tendencia < -0.03).length;

  return (
    <AppShell
      title="Analítica"
      subtitle="Agente Analista de Ventas · rotación, tendencias y desempeño comercial"
    >
      <section className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5">
        <Kpi
          label="Ingresos 30 días"
          value={moneyShort(ingresos30)}
          tone="good"
          hint={`${METRICS.ventas30.toLocaleString("es-PE")} unidades`}
        />
        <Kpi
          label="Margen promedio"
          value={margenPromedio}
          unit="%"
          hint="Sobre precio de venta"
          delay={40}
        />
        <Kpi
          label="Productos en alza"
          value={enCrecimiento}
          tone="info"
          hint="Tendencia superior a +10%"
          delay={80}
        />
        <Kpi
          label="Productos en caída"
          value={enCaida}
          tone="warn"
          hint="Demanda decreciente"
          delay={120}
        />
        <Kpi
          label="Rotación media"
          value={
            Math.round((PRODUCTS.reduce((a, p) => a + p.rotacion, 0) / PRODUCTS.length) * 100) / 100
          }
          unit="×/mes"
          delay={160}
        />
      </section>

      <section className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Panel className="p-5 xl:col-span-2" delay={60}>
          <h2 className="font-display font-semibold tracking-tight">
            Ingresos y riesgo por categoría
          </h2>
          <p className="font-mono text-[11px] text-muted-foreground">
            Últimos 30 días · barras en soles, línea de riesgo promedio
          </p>
          <div className="mt-4 h-[250px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={porCategoria}>
                <CartesianGrid stroke="var(--line)" vertical={false} />
                <XAxis
                  dataKey="categoria"
                  stroke="var(--muted-foreground)"
                  fontSize={10}
                  tickLine={false}
                  axisLine={false}
                  interval={0}
                  angle={-18}
                  textAnchor="end"
                  height={60}
                />
                <YAxis
                  stroke="var(--muted-foreground)"
                  fontSize={11}
                  tickLine={false}
                  axisLine={false}
                  width={50}
                />
                <Tooltip {...tooltipStyle} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <RBar dataKey="ingresos" name="Ingresos" radius={[4, 4, 0, 0]} fill="var(--good)" />
                <RBar
                  dataKey="riesgo"
                  name="Riesgo medio"
                  radius={[4, 4, 0, 0]}
                  fill="var(--accent)"
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>

        <Panel className="p-5" delay={100}>
          <h2 className="font-display font-semibold tracking-tight">Rotación por categoría</h2>
          <p className="font-mono text-[11px] text-muted-foreground">Veces al mes</p>
          <div className="mt-4 h-[250px]">
            <ResponsiveContainer width="100%" height="100%">
              <RadarChart data={radar} outerRadius="72%">
                <PolarGrid stroke="var(--line)" />
                <PolarAngleAxis
                  dataKey="categoria"
                  tick={{ fill: "var(--muted-foreground)", fontSize: 10 }}
                />
                <Radar
                  dataKey="rotacion"
                  stroke="var(--info)"
                  fill="var(--info)"
                  fillOpacity={0.3}
                />
                <Tooltip {...tooltipStyle} />
              </RadarChart>
            </ResponsiveContainer>
          </div>
        </Panel>
      </section>

      <section className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Panel className="p-5 xl:col-span-2" delay={140}>
          <h2 className="font-display font-semibold tracking-tight">
            Cobertura vs. demanda diaria
          </h2>
          <p className="font-mono text-[11px] text-muted-foreground">
            Abajo a la derecha: alta demanda con poca cobertura, la zona de quiebre
          </p>
          <div className="mt-4 h-[280px]">
            <ResponsiveContainer width="100%" height="100%">
              <ScatterChart margin={{ left: 4, bottom: 12 }}>
                <CartesianGrid stroke="var(--line)" />
                <XAxis
                  type="number"
                  dataKey="cobertura"
                  name="Cobertura (días)"
                  stroke="var(--muted-foreground)"
                  fontSize={11}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  type="number"
                  dataKey="demanda"
                  name="Demanda (u/día)"
                  stroke="var(--muted-foreground)"
                  fontSize={11}
                  tickLine={false}
                  axisLine={false}
                  width={40}
                />
                <ZAxis type="number" dataKey="valor" range={[40, 340]} name="Valor" />
                <Tooltip {...tooltipStyle} cursor={{ strokeDasharray: "3 3" }} />
                <Scatter data={dispersion} name="SKU">
                  {dispersion.map((d, i) => (
                    <Cell key={i} fill={riskColorVar(d.riesgo)} fillOpacity={0.75} />
                  ))}
                </Scatter>
              </ScatterChart>
            </ResponsiveContainer>
          </div>
        </Panel>

        <Panel delay={180}>
          <PanelHead title="Proveedores" subtitle="Lead time y compra propuesta" />
          <div className="max-h-[300px] divide-y divide-line/70 overflow-y-auto">
            {porProveedor.map((s) => (
              <div key={s.proveedor} className="px-5 py-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate text-[13px] font-medium">{s.proveedor}</p>
                  <span className="font-mono text-[11px] text-accent">{money(s.compra)}</span>
                </div>
                <p className="font-mono text-[11px] text-muted-foreground">
                  {s.skus} SKUs · lead {s.lead}d · riesgo medio {s.riesgo}/100
                </p>
              </div>
            ))}
          </div>
        </Panel>
      </section>
    </AppShell>
  );
}
