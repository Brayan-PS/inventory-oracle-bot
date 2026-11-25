import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  Bar as RBar,
  BarChart,
  CartesianGrid,
  Cell,
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
  Tag,
  money,
  moneyShort,
  riskColorVar,
} from "@/components/kit";
import { useInventory } from "@/lib/store";

export const Route = createFileRoute("/inventario")({
  head: () => ({
    meta: [
      { title: "Inventario | Intelli-Stock" },
      {
        name: "description",
        content:
          "Estado del inventario por categoría y proveedor: stock actual contra mínimos y máximos, cobertura en días y capital inmovilizado.",
      },
      { property: "og:title", content: "Inventario | Intelli-Stock" },
      {
        property: "og:description",
        content: "Control de stock, mínimos, máximos y cobertura del Agente Gestor de Inventario.",
      },
    ],
  }),
  component: Inventario,
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

function Inventario() {
  const { CATEGORY_LIST, METRICS, PRODUCTS } = useInventory();
  const [cat, setCat] = useState("todas");
  const lista = PRODUCTS.filter((p) => cat === "todas" || p.categoria === cat);

  const porCategoria = CATEGORY_LIST.map((c) => {
    const items = PRODUCTS.filter((p) => p.categoria === c);
    return {
      categoria: c,
      valor: Math.round(items.reduce((a, p) => a + p.valorInventario, 0)),
      unidades: items.reduce((a, p) => a + p.stock, 0),
      criticos: items.filter((p) => p.riesgo === "critico").length,
    };
  }).sort((a, b) => b.valor - a.valor);

  const bajoMinimo = PRODUCTS.filter((p) => p.stock < p.stockMin).sort(
    (a, b) => a.stock / a.stockMin - b.stock / b.stockMin,
  );

  return (
    <AppShell
      title="Inventario"
      subtitle="Agente Gestor de Inventario · stock, mínimos, máximos y cobertura"
    >
      <section className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5">
        <Kpi
          label="Unidades en almacén"
          value={PRODUCTS.reduce((a, p) => a + p.stock, 0).toLocaleString("es-PE")}
          hint="Total físico"
        />
        <Kpi
          label="Valor del inventario"
          value={moneyShort(METRICS.valorInventario)}
          hint="A precio de compra"
          delay={40}
        />
        <Kpi
          label="Bajo stock mínimo"
          value={bajoMinimo.length}
          tone="accent"
          hint="SKUs por debajo del mínimo"
          delay={80}
        />
        <Kpi
          label="Cobertura promedio"
          value={METRICS.coberturaPromedio}
          unit="días"
          hint="Objetivo: 21 días"
          delay={120}
        />
        <Kpi
          label="Capital inmovilizado"
          value={moneyShort(METRICS.capitalInmovilizado)}
          tone="warn"
          hint={`${METRICS.sobrestock} SKUs con sobrestock`}
          delay={160}
        />
      </section>

      <section className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Panel className="p-5 xl:col-span-2" delay={60}>
          <h2 className="font-display font-semibold tracking-tight">
            Valor del inventario por categoría
          </h2>
          <p className="font-mono text-[11px] text-muted-foreground">
            Valorizado a precio de compra
          </p>
          <div className="mt-4 h-[240px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={porCategoria} layout="vertical" margin={{ left: 10 }}>
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
                  dataKey="categoria"
                  stroke="var(--muted-foreground)"
                  fontSize={11}
                  tickLine={false}
                  axisLine={false}
                  width={110}
                />
                <Tooltip {...tooltipStyle} />
                <RBar dataKey="valor" name="Valor" radius={[0, 4, 4, 0]}>
                  {porCategoria.map((c) => (
                    <Cell
                      key={c.categoria}
                      fill={c.criticos > 0 ? "var(--accent)" : "var(--info)"}
                    />
                  ))}
                </RBar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>

        <Panel delay={100}>
          <PanelHead
            title="Alertas de stock mínimo"
            subtitle={`${bajoMinimo.length} productos bajo el mínimo operativo`}
          />
          <div className="max-h-[260px] divide-y divide-line/70 overflow-y-auto">
            {bajoMinimo.map((p) => (
              <Link
                key={p.sku}
                to="/productos/$sku"
                params={{ sku: p.sku }}
                className="block px-5 py-3 transition-colors hover:bg-surface-2"
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate text-[13px] font-medium">{p.nombre}</p>
                  <span className="font-mono text-[11px]" style={{ color: riskColorVar(p.riesgo) }}>
                    {p.stock}/{p.stockMin}
                  </span>
                </div>
                <div className="mt-1.5">
                  <Bar value={(p.stock / p.stockMin) * 100} level={p.riesgo} />
                </div>
              </Link>
            ))}
            {bajoMinimo.length === 0 && (
              <p className="px-5 py-6 text-center text-muted-foreground">Sin alertas activas.</p>
            )}
          </div>
        </Panel>
      </section>

      <Panel delay={140}>
        <PanelHead
          title="Detalle de inventario"
          subtitle="Stock actual dentro del rango mínimo–máximo"
          right={
            <select
              value={cat}
              onChange={(e) => setCat(e.target.value)}
              className="rounded-lg border border-line bg-surface-2 px-3 py-1.5 text-[13px] outline-none focus:border-accent"
              aria-label="Filtrar por categoría"
            >
              <option value="todas">Todas las categorías</option>
              {CATEGORY_LIST.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          }
        />
        <div className="divide-y divide-line/70">
          {lista.map((p) => {
            const pos = Math.min(100, Math.max(2, (p.stock / p.stockMax) * 100));
            const min = (p.stockMin / p.stockMax) * 100;
            return (
              <div key={p.sku} className="flex flex-wrap items-center gap-4 px-5 py-3">
                <div className="min-w-[180px] flex-1">
                  <Link
                    to="/productos/$sku"
                    params={{ sku: p.sku }}
                    className="text-[13px] font-medium hover:text-accent"
                  >
                    {p.nombre}
                  </Link>
                  <p className="font-mono text-[11px] text-muted-foreground">
                    {p.sku} · {p.proveedor}
                  </p>
                </div>
                <div className="relative h-2 min-w-[160px] flex-1 overflow-hidden rounded-full bg-line">
                  <div
                    className="h-full rounded-full"
                    style={{ width: `${pos}%`, background: riskColorVar(p.riesgo) }}
                  />
                  <div
                    className="absolute top-0 h-full w-px bg-foreground/50"
                    style={{ left: `${min}%` }}
                  />
                </div>
                <span className="w-36 text-right font-mono text-[11px] text-muted-foreground">
                  {p.stock} u · mín {p.stockMin} · máx {p.stockMax}
                </span>
                <span className="w-20 text-right font-mono text-[11px]">{p.cobertura}d</span>
                <span className="w-24 text-right font-mono text-[11px] text-muted-foreground">
                  {money(p.valorInventario)}
                </span>
                <RiskBadge level={p.riesgo} className="w-20" />
                {p.sobrestock && <Tag tone="info">sobrestock</Tag>}
              </div>
            );
          })}
        </div>
      </Panel>
    </AppShell>
  );
}
