import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { Kpi, Panel, PanelHead, RiskBadge, Tag, money, moneyShort } from "@/components/kit";
import { useStore } from "@/lib/store";
import type { Product } from "@/lib/inventory";

export const Route = createFileRoute("/reposicion")({
  head: () => ({
    meta: [
      { title: "Reposición | Intelli-Stock" },
      {
        name: "description",
        content:
          "Propuestas de compra generadas por el Agente de Reposición: qué comprar, cuánto, cuándo, con qué prioridad y por qué. Siempre con aprobación humana.",
      },
      { property: "og:title", content: "Reposición | Intelli-Stock" },
      {
        property: "og:description",
        content: "Plan de compra priorizado por riesgo, con aprobación humana obligatoria.",
      },
    ],
  }),
  component: Reposicion,
});

const cuando = (p: Product) => {
  const margen = Math.floor(p.cobertura - p.leadTime);
  if (margen <= 0) return "Hoy mismo";
  if (margen <= 2) return `En ${margen} día(s)`;
  return `Antes de ${margen} días`;
};

const prioridad = (p: Product) =>
  p.riesgo === "critico"
    ? "Máxima"
    : p.riesgo === "alto"
      ? "Alta"
      : p.riesgo === "moderado"
        ? "Media"
        : "Baja";

function Reposicion() {
  const { pendientes, addDecision, decisions, pushLog } = useStore();
  const [editando, setEditando] = useState<string | null>(null);
  const [cantidad, setCantidad] = useState(0);

  const costoTotal = pendientes.reduce((a, p) => a + p.costoReposicion, 0);
  const aprobados = decisions.filter((d) => d.estado === "aprobado" || d.estado === "modificado");
  const invertido = aprobados.reduce((a, d) => a + d.costo, 0);

  return (
    <AppShell
      title="Reposición"
      subtitle="Propuestas del Agente de Reposición · requieren aprobación humana"
    >
      <section className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Kpi
          label="Propuestas abiertas"
          value={pendientes.length}
          tone="accent"
          hint="Pendientes de tu decisión"
        />
        <Kpi
          label="Inversión propuesta"
          value={moneyShort(costoTotal)}
          tone="warn"
          hint="Costo total a precio de compra"
          delay={40}
        />
        <Kpi
          label="Decisiones tomadas"
          value={decisions.length}
          tone="good"
          hint={`${aprobados.length} órdenes aprobadas`}
          delay={80}
        />
        <Kpi
          label="Capital comprometido"
          value={moneyShort(invertido)}
          hint="Suma de las órdenes aprobadas"
          delay={120}
        />
      </section>

      <Panel className="p-4" delay={60}>
        <p className="flex items-start gap-2 font-mono text-[12px] leading-relaxed text-muted-foreground">
          <span className="text-warn">◆</span>
          El sistema nunca ejecuta compras por su cuenta. El Agente de Reposición calcula y
          prioriza; la orden solo existe cuando tú la apruebas. Cada decisión queda registrada en el
          historial con su justificación.
        </p>
      </Panel>

      <section className="space-y-3">
        {pendientes.map((p, i) => (
          <Panel key={p.sku} className="p-5" delay={Math.min(i * 30, 300)}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <Link
                    to="/productos/$sku"
                    params={{ sku: p.sku }}
                    className="font-display font-semibold tracking-tight hover:text-accent"
                  >
                    {p.nombre}
                  </Link>
                  <RiskBadge level={p.riesgo} />
                  <Tag tone={p.riesgo === "critico" ? "accent" : "muted"}>
                    Prioridad {prioridad(p)}
                  </Tag>
                </div>
                <p className="mt-1 font-mono text-[11px] text-muted-foreground">
                  {p.sku} · {p.proveedor} · lead time {p.leadTime} días
                </p>
              </div>
              <div className="text-right">
                <p className="font-display text-2xl font-bold tracking-tight text-accent">
                  {p.cantidadRecomendada} u
                </p>
                <p className="font-mono text-[11px] text-muted-foreground">
                  {money(p.costoReposicion)} estimados
                </p>
              </div>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-2 md:grid-cols-5">
              {[
                { l: "Cuándo comprar", v: cuando(p) },
                { l: "Cobertura actual", v: `${p.cobertura} días` },
                { l: "Demanda 7d", v: `${p.demanda7} u` },
                { l: "Riesgo de quiebre", v: `${p.probQuiebre}%` },
                { l: "Punto de reorden", v: `${p.puntoReorden} u` },
              ].map((c) => (
                <div key={c.l} className="rounded-lg bg-surface-2 p-2.5 text-center">
                  <p className="font-display text-sm font-semibold">{c.v}</p>
                  <p className="font-mono text-[10px] text-muted-foreground">{c.l}</p>
                </div>
              ))}
            </div>

            <p className="mt-3 text-[13px] leading-relaxed text-muted-foreground">
              <span className="font-mono text-[11px] uppercase text-accent">Explicación · </span>
              {p.factores.slice(0, 3).join(" ")}
            </p>

            {editando === p.sku ? (
              <div className="mt-4 flex flex-wrap gap-2">
                <input
                  type="number"
                  value={cantidad}
                  onChange={(e) => setCantidad(Number(e.target.value))}
                  className="w-28 rounded-lg border border-line bg-surface-2 px-3 py-2 font-mono text-[13px] outline-none focus:border-accent"
                  aria-label="Nueva cantidad"
                />
                <button
                  onClick={async () => {
                    if (
                      !(await addDecision({
                        sku: p.sku,
                        nombre: p.nombre,
                        cantidadSugerida: p.cantidadRecomendada,
                        cantidadFinal: cantidad,
                        costo: Math.round(p.precioCompra * cantidad),
                        estado: "modificado",
                        motivo: `Cantidad ajustada de ${p.cantidadRecomendada} a ${cantidad} unidades por el encargado.`,
                      }))
                    )
                      return;
                    pushLog("reposicion", `Cantidad modificada para ${p.nombre}: ${cantidad} u.`);
                    setEditando(null);
                  }}
                  className="rounded-lg bg-accent px-4 py-2 text-[13px] font-medium text-accent-foreground"
                >
                  Confirmar
                </button>
                <button
                  onClick={() => setEditando(null)}
                  className="rounded-lg border border-line px-4 py-2 text-[13px] text-muted-foreground"
                >
                  Cancelar
                </button>
              </div>
            ) : (
              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  onClick={async () => {
                    if (
                      !(await addDecision({
                        sku: p.sku,
                        nombre: p.nombre,
                        cantidadSugerida: p.cantidadRecomendada,
                        cantidadFinal: p.cantidadRecomendada,
                        costo: p.costoReposicion,
                        estado: "aprobado",
                        motivo: "Aprobado sin cambios desde el plan de reposición.",
                      }))
                    )
                      return;
                    pushLog(
                      "supervisor",
                      `Orden aprobada: ${p.nombre} (${p.cantidadRecomendada} u).`,
                    );
                  }}
                  className="rounded-lg bg-accent px-4 py-2 text-[13px] font-medium text-accent-foreground hover:bg-accent/90"
                >
                  Aprobar {p.cantidadRecomendada} u
                </button>
                <button
                  onClick={() => {
                    setEditando(p.sku);
                    setCantidad(p.cantidadRecomendada);
                  }}
                  className="rounded-lg border border-line px-4 py-2 text-[13px] text-muted-foreground hover:border-muted-foreground hover:text-foreground"
                >
                  Modificar cantidad
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
                      motivo: "Pospuesto a la próxima revisión semanal.",
                    })
                  }
                  className="rounded-lg border border-line px-4 py-2 text-[13px] text-muted-foreground hover:text-foreground"
                >
                  Posponer
                </button>
                <button
                  onClick={() =>
                    addDecision({
                      sku: p.sku,
                      nombre: p.nombre,
                      cantidadSugerida: p.cantidadRecomendada,
                      cantidadFinal: 0,
                      costo: 0,
                      estado: "descartado",
                      motivo: "Descartado por criterio del encargado de compras.",
                    })
                  }
                  className="rounded-lg border border-line px-4 py-2 text-[13px] text-muted-foreground hover:text-accent"
                >
                  Descartar
                </button>
              </div>
            )}
          </Panel>
        ))}

        {pendientes.length === 0 && (
          <Panel className="p-10 text-center">
            <p className="font-display text-lg font-semibold">No quedan propuestas abiertas</p>
            <p className="mt-1 text-muted-foreground">
              Todas las recomendaciones de esta semana fueron resueltas.
            </p>
            <Link
              to="/historial"
              className="mt-4 inline-block rounded-lg border border-line px-4 py-2 text-[13px] text-muted-foreground hover:text-foreground"
            >
              Ver historial de decisiones
            </Link>
          </Panel>
        )}
      </section>

      {decisions.length > 0 && (
        <Panel delay={120}>
          <PanelHead
            title="Decisiones recientes"
            subtitle="Registro inmediato de tus aprobaciones"
          />
          <div className="divide-y divide-line/70">
            {decisions.slice(0, 5).map((d) => (
              <div key={d.id} className="flex items-center justify-between px-5 py-3 text-[13px]">
                <div>
                  <p className="font-medium">{d.nombre}</p>
                  <p className="font-mono text-[11px] text-muted-foreground">{d.motivo}</p>
                </div>
                <div className="text-right">
                  <p className="font-mono">{d.cantidadFinal} u</p>
                  <p className="font-mono text-[11px] capitalize text-good">{d.estado}</p>
                </div>
              </div>
            ))}
          </div>
        </Panel>
      )}
    </AppShell>
  );
}
