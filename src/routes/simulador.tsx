import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { AppShell } from "@/components/AppShell";
import { Kpi, Panel, PanelHead, RiskBadge, Tag, money } from "@/components/kit";
import { useInventory } from "@/lib/store";

export const Route = createFileRoute("/simulador")({
  head: () => ({
    meta: [
      { title: "Simulador ¿Qué pasaría si...? | Intelli-Stock" },
      {
        name: "description",
        content:
          "Simula escenarios de inventario: qué pasa si no repones un producto y qué pasa si compras una cantidad determinada, con días hasta quiebre y capital invertido.",
      },
      { property: "og:title", content: "Simulador ¿Qué pasaría si...? | Intelli-Stock" },
      {
        property: "og:description",
        content: "Escenarios de quiebre y de compra calculados sobre los datos reales del sistema.",
      },
    ],
  }),
  component: Simulador,
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

function Simulador() {
  const { PRODUCTS } = useInventory();
  const [sku, setSku] = useState(PRODUCTS[0]!.sku);
  const p = PRODUCTS.find((x) => x.sku === sku)!;
  const [compra, setCompra] = useState(p.cantidadRecomendada || 100);

  const proyeccion = useMemo(() => {
    const out: { dia: string; sinReponer: number; conCompra: number }[] = [];
    for (let d = 0; d <= 45; d++) {
      const consumo = p.demandaDiaria * d;
      const llegada = d >= p.leadTime ? compra : 0;
      out.push({
        dia: `D+${d}`,
        sinReponer: Math.max(0, Math.round(p.stock - consumo)),
        conCompra: Math.max(0, Math.round(p.stock + llegada - consumo)),
      });
    }
    return out;
  }, [p, compra]);

  // Escenario A — no reponer
  const diasQuiebre = p.diasHastaQuiebre;
  const diasSinStock = Math.max(0, 30 - diasQuiebre);
  const unidadesPerdidas = Math.round(p.demandaDiaria * diasSinStock);
  const ventasPerdidas = Math.round(unidadesPerdidas * p.precioVenta);
  const margenPerdido = Math.round(unidadesPerdidas * (p.precioVenta - p.precioCompra));

  // Escenario B — comprar X unidades
  const nuevoStock = p.stock + compra;
  const nuevaCobertura = Math.round((nuevoStock / Math.max(p.demandaDiaria, 0.1)) * 10) / 10;
  const capital = Math.round(compra * p.precioCompra);
  const excedeMaximo = nuevoStock > p.stockMax;
  const riesgoSobrestock = nuevaCobertura > 60 ? "Alto" : nuevaCobertura > 40 ? "Medio" : "Bajo";
  const coberturaObjetivo = p.leadTime + 14;
  const cantidadIdeal = p.cantidadRecomendada;

  return (
    <AppShell
      title="¿Qué pasaría si...?"
      subtitle="Simulador de escenarios sobre los datos reales del inventario"
    >
      <Panel className="p-5">
        <div className="flex flex-wrap items-center gap-3">
          <div className="min-w-[260px] flex-1">
            <label
              className="font-mono text-[11px] uppercase text-muted-foreground"
              htmlFor="sim-sku"
            >
              Producto a simular
            </label>
            <select
              id="sim-sku"
              value={sku}
              onChange={(e) => {
                setSku(e.target.value);
                const np = PRODUCTS.find((x) => x.sku === e.target.value)!;
                setCompra(np.cantidadRecomendada || 100);
              }}
              className="mt-1 w-full rounded-lg border border-line bg-surface-2 px-3 py-2 text-[13px] outline-none focus:border-accent"
            >
              {PRODUCTS.map((x) => (
                <option key={x.sku} value={x.sku}>
                  {x.nombre} · {x.sku}
                </option>
              ))}
            </select>
          </div>
          <div className="min-w-[220px] flex-1">
            <label
              className="font-mono text-[11px] uppercase text-muted-foreground"
              htmlFor="sim-qty"
            >
              Cantidad a comprar: {compra} unidades
            </label>
            <input
              id="sim-qty"
              type="range"
              min={0}
              max={Math.max(p.stockMax, 200)}
              step={10}
              value={compra}
              onChange={(e) => setCompra(Number(e.target.value))}
              className="mt-3 w-full accent-[var(--accent)]"
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <RiskBadge level={p.riesgo} />
            <Tag tone="muted">Stock {p.stock} u</Tag>
            <Tag tone="muted">Demanda {p.demandaDiaria} u/día</Tag>
            <Tag tone="muted">Lead {p.leadTime} d</Tag>
          </div>
        </div>
      </Panel>

      <section className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Panel delay={60}>
          <PanelHead
            title={`¿Qué pasa si no repongo ${p.nombre}?`}
            subtitle="Escenario sin ninguna orden de compra"
          />
          <div className="grid grid-cols-2 gap-3 p-5 md:grid-cols-4">
            <div className="rounded-lg bg-surface-2 p-3 text-center">
              <p className="font-display text-2xl font-bold text-accent">{diasQuiebre}</p>
              <p className="font-mono text-[10px] text-muted-foreground">días hasta quiebre</p>
            </div>
            <div className="rounded-lg bg-surface-2 p-3 text-center">
              <p className="font-display text-2xl font-bold">{unidadesPerdidas}</p>
              <p className="font-mono text-[10px] text-muted-foreground">unidades perdidas (30d)</p>
            </div>
            <div className="rounded-lg bg-surface-2 p-3 text-center">
              <p className="font-display text-2xl font-bold text-warn">{money(ventasPerdidas)}</p>
              <p className="font-mono text-[10px] text-muted-foreground">
                ventas potenciales perdidas
              </p>
            </div>
            <div className="rounded-lg bg-surface-2 p-3 text-center">
              <p className="font-display text-2xl font-bold text-accent">{p.probQuiebre}%</p>
              <p className="font-mono text-[10px] text-muted-foreground">probabilidad de quiebre</p>
            </div>
          </div>
          <p className="px-5 pb-5 text-[13px] leading-relaxed text-muted-foreground">
            Con una demanda proyectada de {p.demandaDiaria} unidades diarias, las {p.stock} unidades
            en almacén se agotan en {diasQuiebre} días. Como el proveedor {p.proveedor} tarda{" "}
            {p.leadTime} días en entregar, quedarías sin stock durante {diasSinStock} días del
            próximo mes, con una pérdida de margen estimada de {money(margenPerdido)}.
          </p>
        </Panel>

        <Panel delay={100}>
          <PanelHead
            title={`¿Qué pasa si compro ${compra} unidades?`}
            subtitle="Escenario de compra simulada"
          />
          <div className="grid grid-cols-2 gap-3 p-5 md:grid-cols-4">
            <div className="rounded-lg bg-surface-2 p-3 text-center">
              <p className="font-display text-2xl font-bold text-good">{nuevaCobertura}</p>
              <p className="font-mono text-[10px] text-muted-foreground">nueva cobertura (días)</p>
            </div>
            <div className="rounded-lg bg-surface-2 p-3 text-center">
              <p className="font-display text-2xl font-bold">{nuevoStock}</p>
              <p className="font-mono text-[10px] text-muted-foreground">stock resultante</p>
            </div>
            <div className="rounded-lg bg-surface-2 p-3 text-center">
              <p className="font-display text-2xl font-bold text-warn">{money(capital)}</p>
              <p className="font-mono text-[10px] text-muted-foreground">capital invertido</p>
            </div>
            <div className="rounded-lg bg-surface-2 p-3 text-center">
              <p
                className={`font-display text-2xl font-bold ${riesgoSobrestock === "Alto" ? "text-accent" : riesgoSobrestock === "Medio" ? "text-warn" : "text-good"}`}
              >
                {riesgoSobrestock}
              </p>
              <p className="font-mono text-[10px] text-muted-foreground">riesgo de sobrestock</p>
            </div>
          </div>
          <p className="px-5 pb-5 text-[13px] leading-relaxed text-muted-foreground">
            La cobertura objetivo para este producto es de {coberturaObjetivo} días (lead time{" "}
            {p.leadTime}d + ciclo de 14d).{" "}
            {compra === 0
              ? "Con 0 unidades el escenario equivale a no reponer."
              : nuevaCobertura > coberturaObjetivo * 2
                ? `Con ${compra} unidades superarías ampliamente ese objetivo e inmovilizarías capital innecesariamente.`
                : nuevaCobertura < coberturaObjetivo
                  ? `Con ${compra} unidades te quedarías corto frente al objetivo; seguirías expuesto a quiebre.`
                  : `Con ${compra} unidades quedas dentro del rango recomendado.`}{" "}
            {excedeMaximo && `Además, superarías el stock máximo definido (${p.stockMax} u).`}{" "}
            {cantidadIdeal > 0 && `El Agente de Reposición recomienda ${cantidadIdeal} unidades.`}
          </p>
        </Panel>
      </section>

      <Panel className="p-5" delay={140}>
        <h2 className="font-display font-semibold tracking-tight">Proyección de stock a 45 días</h2>
        <p className="font-mono text-[11px] text-muted-foreground">
          Comparación entre no reponer y comprar {compra} unidades (llegada en el día {p.leadTime})
        </p>
        <div className="mt-4 h-[280px]">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={proyeccion}>
              <defs>
                <linearGradient id="gsim" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--good)" stopOpacity={0.3} />
                  <stop offset="100%" stopColor="var(--good)" stopOpacity={0} />
                </linearGradient>
              </defs>
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
                width={40}
              />
              <Tooltip {...tooltipStyle} />
              <ReferenceLine
                y={p.stockMin}
                stroke="var(--accent)"
                strokeDasharray="4 4"
                label={{
                  value: "stock mínimo",
                  fill: "var(--accent)",
                  fontSize: 10,
                  position: "insideTopLeft",
                }}
              />
              <Area
                type="monotone"
                dataKey="conCompra"
                name="Con la compra simulada"
                stroke="var(--good)"
                strokeWidth={2.2}
                fill="url(#gsim)"
              />
              <Area
                type="monotone"
                dataKey="sinReponer"
                name="Sin reponer"
                stroke="var(--accent)"
                strokeWidth={2}
                strokeDasharray="5 4"
                fill="none"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </Panel>
    </AppShell>
  );
}
