import { createFileRoute, Link } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { Kpi, Panel, PanelHead, RiskBadge, Tag, money, moneyShort } from "@/components/kit";
import { MODEL_METRICS } from "@/lib/inventory";
import { useInventory } from "@/lib/store";
import { useStore } from "@/lib/store";

export const Route = createFileRoute("/reportes")({
  head: () => ({
    meta: [
      { title: "Reportes | Intelli-Stock" },
      {
        name: "description",
        content:
          "Reporte semanal generado por el Agente Supervisor: riesgos detectados, recomendaciones de compra, acciones pendientes y desempeño del modelo predictivo.",
      },
      { property: "og:title", content: "Reportes | Intelli-Stock" },
      {
        property: "og:description",
        content: "Resumen ejecutivo semanal de riesgos, compras y precisión predictiva.",
      },
    ],
  }),
  component: Reportes,
});

function Reportes() {
  const { METRICS, PRODUCTS } = useInventory();
  const { decisions, pendientes } = useStore();
  const criticos = PRODUCTS.filter((p) => p.riesgo === "critico").sort(
    (a, b) => b.riesgoScore - a.riesgoScore,
  );
  const sobrestock = PRODUCTS.filter((p) => p.sobrestock).sort(
    (a, b) => b.valorInventario - a.valorInventario,
  );
  const costoPendiente = pendientes.reduce((a, p) => a + p.costoReposicion, 0);
  const ventasEnRiesgo = Math.round(
    criticos.reduce(
      (a, p) => a + p.demandaDiaria * Math.max(0, p.leadTime - p.cobertura) * p.precioVenta,
      0,
    ),
  );
  const hoy = new Date().toLocaleDateString("es-PE", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });

  return (
    <AppShell title="Reportes" subtitle={`Reporte semanal generado por generar_reporte() · ${hoy}`}>
      <section className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Kpi
          label="Riesgos detectados"
          value={METRICS.criticos + METRICS.altos}
          tone="accent"
          hint={`${METRICS.criticos} críticos, ${METRICS.altos} altos`}
        />
        <Kpi
          label="Compra recomendada"
          value={moneyShort(costoPendiente)}
          tone="warn"
          hint={`${pendientes.length} propuestas abiertas`}
          delay={40}
        />
        <Kpi
          label="Ventas en riesgo"
          value={moneyShort(ventasEnRiesgo)}
          tone="info"
          hint="Si no se repone a tiempo"
          delay={80}
        />
        <Kpi
          label="Decisiones tomadas"
          value={decisions.length}
          tone="good"
          hint="Registradas esta semana"
          delay={120}
        />
      </section>

      <Panel className="p-6" delay={60}>
        <p className="font-mono text-[10px] uppercase tracking-wider text-accent">
          Resumen ejecutivo
        </p>
        <h2 className="mt-2 font-display text-xl font-semibold tracking-tight">
          {pendientes.length} compras recomendadas y {METRICS.criticos} productos en riesgo crítico
        </h2>
        <p className="mt-3 max-w-4xl text-[14px] leading-relaxed text-foreground/85">
          Sobre un catálogo de {METRICS.totalSkus} SKUs valorizado en{" "}
          {money(METRICS.valorInventario)}, el sistema detectó {METRICS.criticos} productos en
          riesgo crítico de quiebre y {METRICS.altos} en riesgo alto. La cobertura promedio es de{" "}
          {METRICS.coberturaPromedio} días. El Agente de Reposición propone {pendientes.length}{" "}
          órdenes de compra por {money(costoPendiente)}, todas pendientes de aprobación humana. En
          paralelo, {METRICS.sobrestock} productos concentran {money(METRICS.capitalInmovilizado)}{" "}
          de capital inmovilizado por baja rotación y no deberían reponerse este ciclo.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Tag tone="accent">Prioridad: {criticos[0]?.nombre ?? "—"}</Tag>
          <Tag tone="info">Precisión del modelo {MODEL_METRICS.precision}%</Tag>
          <Tag tone="warn">
            {ventasEnRiesgo > 0
              ? `${money(ventasEnRiesgo)} de venta en riesgo`
              : "Sin venta en riesgo inmediato"}
          </Tag>
          <Tag tone="good">{decisions.length} decisiones registradas</Tag>
        </div>
      </Panel>

      <section className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Panel delay={100}>
          <PanelHead
            title="1. Riesgos de quiebre"
            subtitle="Productos que exigen acción inmediata"
          />
          <div className="divide-y divide-line/70">
            {criticos.slice(0, 8).map((p) => (
              <Link
                key={p.sku}
                to="/productos/$sku"
                params={{ sku: p.sku }}
                className="flex items-center justify-between gap-3 px-5 py-3 transition-colors hover:bg-surface-2"
              >
                <div className="min-w-0">
                  <p className="truncate text-[13px] font-medium">{p.nombre}</p>
                  <p className="font-mono text-[11px] text-muted-foreground">
                    quiebre en ~{p.diasHastaQuiebre}d · lead {p.leadTime}d · prob. {p.probQuiebre}%
                  </p>
                </div>
                <RiskBadge level={p.riesgo} />
              </Link>
            ))}
            {criticos.length === 0 && (
              <p className="px-5 py-6 text-center text-muted-foreground">
                Sin riesgos críticos esta semana.
              </p>
            )}
          </div>
        </Panel>

        <Panel delay={140}>
          <PanelHead
            title="2. Recomendaciones de compra"
            subtitle="Cantidad, costo y momento sugerido"
          />
          <div className="divide-y divide-line/70">
            {pendientes.slice(0, 8).map((p) => (
              <div key={p.sku} className="flex items-center justify-between gap-3 px-5 py-3">
                <div className="min-w-0">
                  <p className="truncate text-[13px] font-medium">{p.nombre}</p>
                  <p className="font-mono text-[11px] text-muted-foreground">
                    {p.proveedor} · entrega {p.leadTime}d
                  </p>
                </div>
                <div className="text-right">
                  <p className="font-mono text-[13px] text-accent">{p.cantidadRecomendada} u</p>
                  <p className="font-mono text-[11px] text-muted-foreground">
                    {money(p.costoReposicion)}
                  </p>
                </div>
              </div>
            ))}
            {pendientes.length === 0 && (
              <p className="px-5 py-6 text-center text-muted-foreground">
                Todas las propuestas fueron resueltas.
              </p>
            )}
          </div>
        </Panel>

        <Panel delay={180}>
          <PanelHead
            title="3. Capital inmovilizado"
            subtitle="Sobrestock a liberar con promoción"
          />
          <div className="divide-y divide-line/70">
            {sobrestock.slice(0, 8).map((p) => (
              <div key={p.sku} className="flex items-center justify-between gap-3 px-5 py-3">
                <div className="min-w-0">
                  <p className="truncate text-[13px] font-medium">{p.nombre}</p>
                  <p className="font-mono text-[11px] text-muted-foreground">
                    cobertura {p.cobertura}d · rotación {p.rotacion}×/mes
                  </p>
                </div>
                <span className="font-mono text-[13px] text-warn">{money(p.valorInventario)}</span>
              </div>
            ))}
            {sobrestock.length === 0 && (
              <p className="px-5 py-6 text-center text-muted-foreground">
                Sin sobrestock detectado.
              </p>
            )}
          </div>
        </Panel>

        <Panel delay={220}>
          <PanelHead title="4. Acciones pendientes y modelo" subtitle="Cierre del ciclo semanal" />
          <div className="space-y-3 p-5 text-[13px] leading-relaxed">
            <p className="text-muted-foreground">
              <span className="text-foreground">Pendiente de aprobación:</span> {pendientes.length}{" "}
              órdenes por {money(costoPendiente)}.
            </p>
            <p className="text-muted-foreground">
              <span className="text-foreground">Modelo predictivo:</span> {MODEL_METRICS.modelo} (
              {MODEL_METRICS.version}), entrenado el {MODEL_METRICS.entrenado}. MAE{" "}
              {MODEL_METRICS.mae} · RMSE {MODEL_METRICS.rmse} · WAPE {MODEL_METRICS.wape}%.
            </p>
            <p className="text-muted-foreground">
              <span className="text-foreground">Validación:</span> {MODEL_METRICS.ventanaValidacion}
              .
            </p>
            <p className="font-mono text-[11px] text-muted-foreground">
              <span className="text-warn">◆</span> Ninguna compra fue ejecutada automáticamente por
              el sistema.
            </p>
            <div className="flex flex-wrap gap-2 pt-2">
              <Link
                to="/reposicion"
                className="rounded-lg bg-accent px-4 py-2 text-[13px] font-medium text-accent-foreground"
              >
                Revisar y aprobar compras
              </Link>
              <Link
                to="/historial"
                className="rounded-lg border border-line px-4 py-2 text-[13px] text-muted-foreground hover:text-foreground"
              >
                Ver historial
              </Link>
            </div>
          </div>
        </Panel>
      </section>
    </AppShell>
  );
}
