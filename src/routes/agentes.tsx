import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { Kpi, Panel, PanelHead, Tag } from "@/components/kit";
import { AGENTS, AGENT_BY_ID, type AgentId } from "@/lib/supervisor";
import { TOOLS } from "@/lib/agents";
import { computeModelMetrics } from "@/lib/inventory";
import { useEffect, useMemo, useState } from "react";
import { useInventory, useStore } from "@/lib/store";

export const Route = createFileRoute("/agentes")({
  head: () => ({
    meta: [
      { title: "Centro de Agentes IA | Intelli-Stock" },
      {
        name: "description",
        content:
          "Arquitectura multiagente en vivo: Supervisor, Analista de Ventas, Predictor de Demanda, Gestor de Inventario y Agente de Reposición con su registro de actividad.",
      },
      { property: "og:title", content: "Centro de Agentes IA | Intelli-Stock" },
      {
        property: "og:description",
        content: "Cómo el Supervisor coordina a los agentes especializados, paso a paso.",
      },
    ],
  }),
  component: Agentes,
});

interface AgentRun {
  id: string;
  fecha: string;
  consulta: string;
  modo: "llm" | "reglas";
  modelo: string;
  motivo: string | null;
  llamadas: { agente: AgentId; herramienta: string; resumen: string }[];
  tokensEntrada: number;
  tokensSalida: number;
  duracionMs: number;
}

const horaDe = (iso: string) =>
  new Date(iso).toLocaleTimeString("es-PE", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

function Agentes() {
  const { METRICS, PRODUCTS } = useInventory();
  const MM = useMemo(() => computeModelMetrics(PRODUCTS), [PRODUCTS]);
  const { log } = useStore();
  const [runs, setRuns] = useState<AgentRun[]>([]);
  const [errorRuns, setErrorRuns] = useState(false);

  useEffect(() => {
    let vivo = true;
    const cargar = () =>
      fetch("/api/agent-runs?limit=100")
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error("HTTP"))))
        .then((data: AgentRun[]) => {
          if (vivo) {
            setRuns(data);
            setErrorRuns(false);
          }
        })
        .catch(() => vivo && setErrorRuns(true));
    void cargar();
    const t = setInterval(cargar, 10000);
    return () => {
      vivo = false;
      clearInterval(t);
    };
  }, [log.length]);

  const llamadas = runs.flatMap((r) => r.llamadas.map((l) => ({ ...l, fecha: r.fecha })));
  const porAgente = (id: AgentId) => llamadas.filter((l) => l.agente === id);
  const conLLM = runs.filter((r) => r.modo === "llm").length;
  const RESULTADOS: Record<AgentId, { tareas: number; resumen: string; ultima: string }> = {
    supervisor: {
      tareas: runs.length,
      resumen: `Coordinó ${runs.length} consultas registradas (${conLLM} con LLM).`,
      ultima: runs[0] ? horaDe(runs[0].fecha) : "sin registros",
    },
    ventas: {
      tareas: porAgente("ventas").length,
      resumen: `Datos de ${METRICS.ventas30.toLocaleString("es-PE")} unidades vendidas en 30 días sobre ${METRICS.totalSkus} SKUs.`,
      ultima: porAgente("ventas")[0] ? horaDe(porAgente("ventas")[0]!.fecha) : "sin registros",
    },
    predictor: {
      tareas: porAgente("predictor").length,
      resumen: `Pronóstico 7/14/30 días; backtest: WAPE ${MM.wape}% sobre historial simulado.`,
      ultima: porAgente("predictor")[0]
        ? horaDe(porAgente("predictor")[0]!.fecha)
        : "sin registros",
    },
    inventario: {
      tareas: porAgente("inventario").length,
      resumen: `${PRODUCTS.filter((p) => p.stock < p.stockMin).length} productos por debajo del stock mínimo.`,
      ultima: porAgente("inventario")[0]
        ? horaDe(porAgente("inventario")[0]!.fecha)
        : "sin registros",
    },
    reposicion: {
      tareas: porAgente("reposicion").length,
      resumen: `${METRICS.pedidosPendientes} pedidos sugeridos por ${METRICS.costoPendiente.toLocaleString("es-PE")} soles.`,
      ultima: porAgente("reposicion")[0]
        ? horaDe(porAgente("reposicion")[0]!.fecha)
        : "sin registros",
    },
  };

  return (
    <AppShell
      title="Centro de Agentes IA"
      subtitle="Arquitectura multiagente coordinada por el Supervisor"
    >
      <section className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Kpi
          label="Agentes activos"
          value={AGENTS.length}
          tone="good"
          hint="Supervisor + 4 especializados"
        />
        <Kpi
          label="Consultas registradas"
          value={runs.length}
          tone="info"
          hint={`${conLLM} con LLM · ${runs.length - conLLM} por reglas`}
          delay={40}
        />
        <Kpi
          label="Llamadas a agentes"
          value={llamadas.length}
          hint="Function calling (tabla agent_runs)"
          delay={80}
        />
        <Kpi
          label="Compras automáticas"
          value="0"
          tone="warn"
          hint="Siempre requieren aprobación humana"
          delay={120}
        />
      </section>

      <Panel className="p-6" delay={60}>
        <h2 className="font-display font-semibold tracking-tight">Topología del sistema</h2>
        <p className="font-mono text-[11px] text-muted-foreground">
          USUARIO → SUPERVISOR → AGENTES ESPECIALIZADOS → RESULTADOS → SUPERVISOR → USUARIO
        </p>

        <div className="mt-6 flex flex-col items-center gap-4">
          <div className="w-full max-w-sm rounded-xl border border-accent/40 bg-accent/10 p-4 text-center">
            <span className="mx-auto grid size-10 place-items-center rounded-lg bg-accent font-display font-bold text-accent-foreground">
              S
            </span>
            <p className="mt-2 font-display font-semibold tracking-tight text-accent">
              Agente Supervisor
            </p>
            <p className="mt-1 text-[12px] text-muted-foreground">
              {AGENT_BY_ID.supervisor.responsabilidad}
            </p>
          </div>

          <div className="flex h-8 w-full items-center justify-center">
            <div className="h-full w-px bg-line" />
          </div>

          <div className="grid w-full grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
            {AGENTS.filter((a) => a.id !== "supervisor").map((a, i) => {
              const r = RESULTADOS[a.id];
              return (
                <div
                  key={a.id}
                  className="rise rounded-xl border border-line bg-surface-2 p-4"
                  style={{ animationDelay: `${i * 80}ms` }}
                >
                  <div className="flex items-center gap-2">
                    <span className="grid size-8 place-items-center rounded-lg bg-info/15 font-display font-bold text-info">
                      {a.inicial}
                    </span>
                    <div className="min-w-0">
                      <p className="truncate font-display text-[13px] font-semibold tracking-tight">
                        {a.corto}
                      </p>
                      <p className="flex items-center gap-1 font-mono text-[10px] text-good">
                        <span className="blink size-1.5 rounded-full bg-good" /> operativo
                      </p>
                    </div>
                  </div>
                  <p className="mt-3 text-[12px] leading-snug text-muted-foreground">
                    {a.responsabilidad}
                  </p>
                  <div className="mt-3 space-y-1 border-t border-line pt-3 font-mono text-[11px] text-muted-foreground">
                    <p>Última ejecución: {r.ultima}</p>
                    <p>Tareas realizadas: {r.tareas}</p>
                  </div>
                  <p className="mt-2 text-[12px] leading-snug text-foreground/80">{r.resumen}</p>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {a.herramientas.map((h) => (
                      <Tag key={h} tone="muted">
                        {h}
                      </Tag>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </Panel>

      <section className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Panel className="xl:col-span-2" delay={100}>
          <PanelHead
            title="Registro de auditoría (PostgreSQL · agent_runs)"
            subtitle={
              errorRuns
                ? "No se pudo leer el registro del servidor"
                : `Últimas ${runs.length} consultas reales al Supervisor`
            }
          />
          <div className="max-h-[420px] divide-y divide-line/70 overflow-y-auto">
            {runs.length === 0 && (
              <p className="px-5 py-4 text-[13px] text-muted-foreground">
                Aún no hay consultas registradas. Haz una pregunta en el panel del Supervisor.
              </p>
            )}
            {runs.map((r) => (
              <div key={r.id} className="space-y-1 px-5 py-3">
                <div className="flex flex-wrap items-center gap-2 text-[13px]">
                  <span className="font-mono text-[11px] text-muted-foreground">
                    {horaDe(r.fecha)}
                  </span>
                  <Tag tone={r.modo === "llm" ? "good" : "warn"}>
                    {r.modo === "llm" ? "LLM" : "Reglas"}
                  </Tag>
                  <span className="font-medium">“{r.consulta}”</span>
                </div>
                <p className="font-mono text-[11px] text-muted-foreground">
                  {r.llamadas.length
                    ? r.llamadas
                        .map((l) => `${AGENT_BY_ID[l.agente].corto} → ${l.herramienta}`)
                        .join(" · ")
                    : "Sin llamadas a agentes"}{" "}
                  · {(r.duracionMs / 1000).toFixed(1)} s · {r.tokensEntrada + r.tokensSalida} tokens
                  {r.motivo ? ` · respaldo: ${r.motivo}` : ""}
                </p>
              </div>
            ))}
          </div>
          {log.length > 0 && (
            <>
              <PanelHead
                title="Actividad de esta sesión"
                subtitle="Pasos mostrados en el panel del Supervisor"
              />
              <div className="max-h-[240px] divide-y divide-line/70 overflow-y-auto">
                {log.map((l) => (
                  <div key={l.id} className="flex items-start gap-3 px-5 py-2.5">
                    <span className="font-mono text-[11px] text-muted-foreground">{l.hora}</span>
                    <span className="grid size-5 shrink-0 place-items-center rounded-full bg-info/15 text-[10px] font-bold text-info">
                      {AGENT_BY_ID[l.agente].inicial}
                    </span>
                    <p className="min-w-0 flex-1 text-[13px]">
                      <span className="font-medium">{AGENT_BY_ID[l.agente].corto}</span> — {l.texto}
                    </p>
                  </div>
                ))}
              </div>
            </>
          )}
        </Panel>

        <Panel className="p-5" delay={140}>
          <h2 className="font-display font-semibold tracking-tight">Herramientas autorizadas</h2>
          <p className="font-mono text-[11px] text-muted-foreground">
            Las 5 funciones que Gemini puede invocar (solo lectura)
          </p>
          <div className="mt-3 space-y-2">
            {TOOLS.map((t) => [
              `${t.name}()`,
              `${AGENT_BY_ID[t.agente].corto}: ${t.description.split(". ").slice(1).join(". ") || t.description}`,
            ]).map(([fn, desc]) => (
              <div key={fn} className="rounded-lg bg-surface-2 p-2.5">
                <p className="font-mono text-[12px] text-info">{fn}</p>
                <p className="text-[12px] text-muted-foreground">{desc}</p>
              </div>
            ))}
          </div>
          <p className="mt-4 border-t border-line pt-4 font-mono text-[11px] leading-relaxed text-muted-foreground">
            <span className="text-warn">◆</span> Los agentes solo consultan datos. La ejecución de
            una compra está separada de la consulta y exige aprobación humana explícita.
          </p>
        </Panel>
      </section>
    </AppShell>
  );
}
