import { createFileRoute, Link } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { Kpi, Panel, PanelHead, Tag, money, moneyShort } from "@/components/kit";
import { useStore, type DecisionEstado } from "@/lib/store";
import { LegacyDecisionsImport } from "@/components/LegacyDecisionsImport";

export const Route = createFileRoute("/historial")({
  head: () => ({
    meta: [
      { title: "Historial de decisiones | Intelli-Stock" },
      {
        name: "description",
        content:
          "Trazabilidad completa: cada recomendación de compra aprobada, modificada, pospuesta o descartada por el encargado, con su justificación.",
      },
      { property: "og:title", content: "Historial de decisiones | Intelli-Stock" },
      {
        property: "og:description",
        content:
          "Registro auditable de todas las decisiones humanas sobre las recomendaciones de la IA.",
      },
    ],
  }),
  component: Historial,
});

const tone: Record<DecisionEstado, "good" | "info" | "warn" | "accent"> = {
  aprobado: "good",
  modificado: "info",
  pospuesto: "warn",
  descartado: "accent",
};

function Historial() {
  const { decisions } = useStore();
  const aprobados = decisions.filter((d) => d.estado === "aprobado" || d.estado === "modificado");
  const invertido = aprobados.reduce((a, d) => a + d.costo, 0);
  const ajustadas = decisions.filter((d) => d.estado === "modificado").length;
  const tasa = decisions.length ? Math.round((aprobados.length / decisions.length) * 100) : 0;

  return (
    <AppShell
      title="Historial de decisiones"
      subtitle="Trazabilidad de las recomendaciones y de la decisión humana"
    >
      <LegacyDecisionsImport />
      <section className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Kpi
          label="Decisiones registradas"
          value={decisions.length}
          hint="En esta estación de trabajo"
        />
        <Kpi
          label="Órdenes aprobadas"
          value={aprobados.length}
          tone="good"
          hint={`${tasa}% de aceptación de la IA`}
          delay={40}
        />
        <Kpi
          label="Cantidades ajustadas"
          value={ajustadas}
          tone="info"
          hint="El humano cambió la propuesta"
          delay={80}
        />
        <Kpi
          label="Capital comprometido"
          value={moneyShort(invertido)}
          tone="warn"
          hint="Suma de órdenes aprobadas"
          delay={120}
        />
      </section>

      <Panel delay={60}>
        <PanelHead title="Registro cronológico" subtitle="La más reciente primero" />
        {decisions.length === 0 ? (
          <div className="p-10 text-center">
            <p className="font-display text-lg font-semibold">Todavía no has tomado decisiones</p>
            <p className="mt-1 text-muted-foreground">
              Aprueba, modifica o pospone una recomendación y aparecerá aquí con su justificación
              completa.
            </p>
            <Link
              to="/reposicion"
              className="mt-4 inline-block rounded-lg bg-accent px-4 py-2 text-[13px] font-medium text-accent-foreground"
            >
              Ir al plan de reposición
            </Link>
          </div>
        ) : (
          <div className="divide-y divide-line/70">
            {decisions.map((d) => (
              <div key={d.id} className="flex flex-wrap items-center gap-4 px-5 py-4">
                <div className="min-w-[220px] flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      to="/productos/$sku"
                      params={{ sku: d.sku }}
                      className="font-medium hover:text-accent"
                    >
                      {d.nombre}
                    </Link>
                    <Tag tone={tone[d.estado]}>{d.estado}</Tag>
                  </div>
                  <p className="mt-1 font-mono text-[11px] text-muted-foreground">
                    {new Date(d.fecha).toLocaleString("es-PE")} · {d.usuario}
                  </p>
                  <p className="mt-1 text-[12px] text-muted-foreground">{d.motivo}</p>
                </div>
                <div className="text-right">
                  <p className="font-mono text-[13px]">
                    {d.cantidadFinal} u
                    {d.cantidadFinal !== d.cantidadSugerida && (
                      <span className="text-muted-foreground">
                        {" "}
                        (IA sugirió {d.cantidadSugerida})
                      </span>
                    )}
                  </p>
                  <p className="font-mono text-[11px] text-muted-foreground">{money(d.costo)}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </Panel>

      <Panel className="p-5" delay={100}>
        <p className="font-mono text-[12px] leading-relaxed text-muted-foreground">
          <span className="text-warn">◆</span> Política de supervisión: los agentes acceden
          únicamente a herramientas autorizadas, la consulta de datos está separada de la ejecución
          de acciones, y toda orden de compra real exige aprobación humana previa. Cada consulta y
          cada recomendación quedan registradas.
        </p>
      </Panel>
    </AppShell>
  );
}
