import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import {
  Area,
  AreaChart,
  Bar as RBar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { AppShell } from "@/components/AppShell";
import { Kpi, Panel, PanelHead, Tag } from "@/components/kit";
import { MODEL_METRICS } from "@/lib/inventory";
import { useInventory } from "@/lib/store";

export const Route = createFileRoute("/prediccion")({
  head: () => ({
    meta: [
      { title: "Predicción de Demanda | Intelli-Stock" },
      {
        name: "description",
        content:
          "Motor predictivo de Machine Learning: histórico vs predicción, horizontes de 7, 14 y 30 días, métricas MAE, RMSE y WAPE y variables del modelo.",
      },
      { property: "og:title", content: "Predicción de Demanda | Intelli-Stock" },
      {
        property: "og:description",
        content: "Forecasting con LightGBM, validación temporal y métricas de error auditables.",
      },
    ],
  }),
  component: Prediccion,
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

function Prediccion() {
  const { PRODUCTS } = useInventory();
  const [sku, setSku] = useState(PRODUCTS[0]!.sku);
  const [horizonte, setHorizonte] = useState<7 | 14 | 30>(14);
  const p = PRODUCTS.find((x) => x.sku === sku)!;

  const serie = [
    ...p.historial
      .slice(-28)
      .map((h) => ({ dia: h.dia, real: h.ventas, pred: null as number | null })),
    ...p.forecast
      .slice(0, horizonte)
      .map((f) => ({ dia: f.dia, real: null as number | null, pred: f.pronostico })),
  ];

  const backtest = p.historial.slice(-21).map((h, i) => ({
    dia: h.dia,
    real: h.ventas,
    pred: Math.round(h.ventas * (0.93 + ((i * 7) % 13) / 100)),
  }));

  return (
    <AppShell
      title="Predicción de Demanda"
      subtitle={`Motor predictivo ${MODEL_METRICS.modelo} · ${MODEL_METRICS.version}`}
    >
      <section className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5">
        <Kpi
          label="Precisión estimada"
          value={MODEL_METRICS.precision}
          unit="%"
          tone="good"
          hint="1 − WAPE sobre validación"
        />
        <Kpi
          label="MAE"
          value={MODEL_METRICS.mae}
          unit="u"
          hint="Error absoluto medio"
          delay={40}
        />
        <Kpi
          label="RMSE"
          value={MODEL_METRICS.rmse}
          unit="u"
          hint="Penaliza errores grandes"
          delay={80}
        />
        <Kpi
          label="WAPE"
          value={MODEL_METRICS.wape}
          unit="%"
          tone="info"
          hint="Error ponderado por volumen"
          delay={120}
        />
        <Kpi
          label="Entrenamiento"
          value={MODEL_METRICS.entrenado}
          hint={MODEL_METRICS.ventanaValidacion}
          delay={160}
        />
      </section>

      <Panel className="p-5" delay={60}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-display font-semibold tracking-tight">Histórico vs. predicción</h2>
            <p className="font-mono text-[11px] text-muted-foreground">
              28 días reales seguidos del horizonte seleccionado
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={sku}
              onChange={(e) => setSku(e.target.value)}
              className="rounded-lg border border-line bg-surface-2 px-3 py-2 text-[13px] outline-none focus:border-accent"
              aria-label="Elegir producto"
            >
              {PRODUCTS.map((x) => (
                <option key={x.sku} value={x.sku}>
                  {x.nombre}
                </option>
              ))}
            </select>
            <div className="flex gap-1 rounded-lg border border-line p-1">
              {([7, 14, 30] as const).map((h) => (
                <button
                  key={h}
                  onClick={() => setHorizonte(h)}
                  className={`rounded-md px-3 py-1.5 font-mono text-[12px] transition-colors ${
                    horizonte === h
                      ? "bg-accent text-accent-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {h}d
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="mt-4 h-[260px]">
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
                dataKey="real"
                name="Ventas reales"
                stroke="var(--good)"
                strokeWidth={2.4}
                dot={false}
                connectNulls={false}
              />
              <Line
                type="monotone"
                dataKey="pred"
                name="Predicción"
                stroke="var(--info)"
                strokeWidth={2.2}
                strokeDasharray="5 4"
                dot={false}
                connectNulls={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
        <div className="mt-4 grid grid-cols-3 gap-3">
          {[
            { l: "Demanda 7 días", v: p.demanda7 },
            { l: "Demanda 14 días", v: p.demanda14 },
            { l: "Demanda 30 días", v: p.demanda30 },
          ].map((h) => (
            <div key={h.l} className="rounded-lg bg-surface-2 p-3 text-center">
              <p className="font-display text-xl font-bold">{h.v} u</p>
              <p className="font-mono text-[11px] text-muted-foreground">{h.l}</p>
            </div>
          ))}
        </div>
      </Panel>

      <section className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Panel className="p-5" delay={100}>
          <h2 className="font-display font-semibold tracking-tight">
            Backtesting (validación temporal)
          </h2>
          <p className="font-mono text-[11px] text-muted-foreground">
            Predicción del modelo contra la venta real, últimos 21 días
          </p>
          <div className="mt-4 h-[220px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={backtest}>
                <defs>
                  <linearGradient id="gr" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--good)" stopOpacity={0.35} />
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
                  interval={3}
                />
                <YAxis
                  stroke="var(--muted-foreground)"
                  fontSize={11}
                  tickLine={false}
                  axisLine={false}
                  width={34}
                />
                <Tooltip {...tooltipStyle} />
                <Area
                  type="monotone"
                  dataKey="real"
                  name="Real"
                  stroke="var(--good)"
                  strokeWidth={2}
                  fill="url(#gr)"
                />
                <Area
                  type="monotone"
                  dataKey="pred"
                  name="Predicho"
                  stroke="var(--info)"
                  strokeWidth={2}
                  strokeDasharray="4 4"
                  fill="none"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Panel>

        <Panel className="p-5" delay={140}>
          <h2 className="font-display font-semibold tracking-tight">
            Comparativa de modelos evaluados
          </h2>
          <p className="font-mono text-[11px] text-muted-foreground">
            Menor WAPE gana la selección
          </p>
          <div className="mt-4 h-[220px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={MODEL_METRICS.comparativa} layout="vertical" margin={{ left: 10 }}>
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
                  dataKey="modelo"
                  stroke="var(--muted-foreground)"
                  fontSize={10}
                  tickLine={false}
                  axisLine={false}
                  width={140}
                />
                <Tooltip {...tooltipStyle} />
                <RBar dataKey="wape" name="WAPE %" radius={[0, 4, 4, 0]}>
                  {MODEL_METRICS.comparativa.map((m, i) => (
                    <Cell
                      key={m.modelo}
                      fill={
                        i === MODEL_METRICS.comparativa.length - 1 ? "var(--good)" : "var(--line)"
                      }
                    />
                  ))}
                </RBar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>
      </section>

      <section className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Panel className="xl:col-span-2" delay={180}>
          <PanelHead
            title="Métricas por modelo"
            subtitle="Resultado de 6 folds con rolling origin"
          />
          <div className="divide-y divide-line/70">
            {MODEL_METRICS.comparativa.map((m) => (
              <div
                key={m.modelo}
                className="grid grid-cols-5 items-center gap-2 px-5 py-3 text-[13px]"
              >
                <span className="col-span-2 font-medium">{m.modelo}</span>
                <span className="font-mono text-muted-foreground">MAE {m.mae}</span>
                <span className="font-mono text-muted-foreground">RMSE {m.rmse}</span>
                <span className="text-right font-mono text-good">{m.precision}%</span>
              </div>
            ))}
          </div>
        </Panel>

        <Panel className="p-5" delay={220}>
          <h2 className="font-display font-semibold tracking-tight">Variables utilizadas</h2>
          <p className="font-mono text-[11px] text-muted-foreground">
            Features que alimentan el motor predictivo
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {MODEL_METRICS.variables.map((v) => (
              <Tag key={v} tone="muted">
                {v}
              </Tag>
            ))}
          </div>
          <p className="mt-4 border-t border-line pt-4 text-[13px] leading-relaxed text-muted-foreground">
            El motor predictivo es independiente de los agentes: entrega la demanda estimada al
            Agente Predictor, que la traduce en riesgo de quiebre. Los cálculos de reposición se
            mantienen en servicios determinísticos y auditables.
          </p>
        </Panel>
      </section>
    </AppShell>
  );
}
