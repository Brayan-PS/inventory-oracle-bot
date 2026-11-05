import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { cn } from "@/lib/utils";
import { useStore, useInventory } from "@/lib/store";
import { AGENT_BY_ID, SUGERENCIAS, askSupervisor, type SupervisorAnswer } from "@/lib/supervisor";
import type { Product } from "@/lib/inventory";
import { money } from "./kit";

interface Turn {
  id: number;
  pregunta: string;
  answer: SupervisorAnswer;
  revelados: number;
  listo: boolean;
}

export function SupervisorPanel() {
  const { PRODUCTS } = useInventory();
  const { addDecision, pushLog, estadoDe } = useStore();
  const [input, setInput] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [contexto, setContexto] = useState<Product | undefined>();
  const [editando, setEditando] = useState<{ turn: number; cantidad: number } | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turns]);

  const preguntar = useCallback(
    (texto: string) => {
      const q = texto.trim();
      if (!q) return;
      const answer = askSupervisor(q, PRODUCTS, contexto);
      if (answer.productos[0]) setContexto(answer.productos[0]);
      const id = Date.now();
      setTurns((prev) => [...prev, { id, pregunta: q, answer, revelados: 0, listo: false }]);
      setInput("");
      pushLog("supervisor", `Recibió consulta: "${q}"`);

      answer.pasos.forEach((paso, i) => {
        const t = setTimeout(
          () => {
            setTurns((prev) =>
              prev.map((tt) =>
                tt.id === id
                  ? { ...tt, revelados: i + 1, listo: i === answer.pasos.length - 1 }
                  : tt,
              ),
            );
            pushLog(paso.agent, paso.texto.replace("…", "") + " — " + paso.detalle);
          },
          520 * (i + 1),
        );
        timers.current.push(t);
      });
    },
    [contexto, pushLog, PRODUCTS],
  );

  return (
    <aside className="flex w-[360px] shrink-0 flex-col border-l border-line bg-surface">
      <header className="flex h-16 shrink-0 items-center gap-2.5 border-b border-line px-5">
        <span className="grid size-8 place-items-center rounded-lg bg-accent/15 font-display font-bold text-accent">
          S
        </span>
        <div>
          <p className="font-display text-sm font-semibold tracking-tight">Supervisor IA</p>
          <p className="flex items-center gap-1.5 font-mono text-[11px] text-good">
            <span className="blink size-1.5 rounded-full bg-good" />
            {turns.some((t) => !t.listo) ? "Consultando agentes…" : "En línea · 5 agentes"}
          </p>
        </div>
      </header>

      <div className="flex-1 space-y-3 overflow-y-auto p-4">
        {turns.length === 0 && (
          <div className="space-y-3">
            <div className="rounded-2xl rounded-tl-sm bg-surface-2 px-3.5 py-2.5 text-[13px]">
              Soy tu analista de inventarios. Pregúntame en lenguaje natural qué comprar, cuánto,
              cuándo y por qué.
            </div>
            <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              Prueba con
            </p>
            <div className="flex flex-wrap gap-1.5">
              {SUGERENCIAS.map((s) => (
                <button
                  key={s}
                  onClick={() => preguntar(s)}
                  className="rounded-lg border border-line px-2.5 py-1.5 text-left text-[12px] text-muted-foreground transition-colors hover:border-accent/50 hover:text-foreground"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {turns.map((turn, ti) => {
          const a = turn.answer;
          const reco = a.recomendacion;
          const estado = reco ? estadoDe(reco.sku) : undefined;
          return (
            <div key={turn.id} className="space-y-3">
              <div className="ml-auto max-w-[88%] rounded-2xl rounded-tr-sm bg-accent/10 px-3.5 py-2.5 text-[13px]">
                {turn.pregunta}
              </div>

              <div className="space-y-2.5 rounded-xl border border-line bg-background/40 p-3">
                <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                  Secuencia de agentes · {a.intencion}
                </p>
                {a.pasos.map((paso, i) => {
                  const activo = i === turn.revelados;
                  const hecho = i < turn.revelados;
                  if (i > turn.revelados) return null;
                  const agent = AGENT_BY_ID[paso.agent];
                  return (
                    <div key={i} className="rise flex items-start gap-2.5 text-[13px]">
                      <span
                        className={cn(
                          "mt-0.5 grid size-5 shrink-0 place-items-center rounded-full text-[10px] font-bold",
                          hecho ? "bg-good/15 text-good" : "bg-info/15 text-info",
                        )}
                      >
                        {agent.inicial}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-foreground/90">{paso.texto}</p>
                        {hecho && (
                          <p className="text-[11px] leading-snug text-muted-foreground">
                            {paso.detalle}
                          </p>
                        )}
                      </div>
                      <span
                        className={cn(
                          "font-mono text-[11px]",
                          hecho ? "text-good" : "blink text-info",
                        )}
                      >
                        {hecho ? "✓" : "▍"}
                      </span>
                    </div>
                  );
                })}
              </div>

              {turn.listo && (
                <div className="rise space-y-3">
                  <div className="rounded-xl border border-line bg-background/60 p-3.5">
                    <p className="font-mono text-[10px] uppercase tracking-wider text-accent">
                      Respuesta consolidada
                    </p>
                    <p className="mt-2 font-display text-[15px] font-semibold tracking-tight">
                      {a.titulo}
                    </p>
                    <p className="mt-2 text-[13px] leading-relaxed text-foreground/85">
                      {a.resumen}
                    </p>
                    {a.bullets.length > 0 && (
                      <ul className="mt-3 space-y-1.5">
                        {a.bullets.map((b, i) => (
                          <li
                            key={i}
                            className="flex gap-2 text-[12px] leading-snug text-muted-foreground"
                          >
                            <span className="text-accent">▸</span>
                            <span>{b}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                    {a.productos.length > 1 && (
                      <Link
                        to="/reposicion"
                        className="mt-3 inline-block font-mono text-[11px] text-info hover:underline"
                      >
                        Ver plan completo de reposición →
                      </Link>
                    )}
                    {a.productos.length === 1 && a.productos[0] && (
                      <Link
                        to="/productos/$sku"
                        params={{ sku: a.productos[0].sku }}
                        className="mt-3 inline-block font-mono text-[11px] text-info hover:underline"
                      >
                        Abrir ficha de {a.productos[0].nombre} →
                      </Link>
                    )}
                  </div>

                  {reco && reco.cantidad > 0 && (
                    <div className="rounded-xl border border-line bg-background/60 p-3.5">
                      <p className="font-mono text-[10px] uppercase tracking-wider text-accent">
                        Recomendación
                      </p>
                      <p className="mt-2 font-display text-[15px] font-semibold tracking-tight">
                        Comprar {reco.cantidad} × {reco.nombre}
                      </p>
                      <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                        <div className="rounded-lg bg-surface p-2">
                          <p className="font-display text-base font-semibold">{reco.prioridad}</p>
                          <p className="font-mono text-[10px] text-muted-foreground">prioridad</p>
                        </div>
                        <div className="rounded-lg bg-surface p-2">
                          <p className="font-display text-base font-semibold">
                            {money(reco.costo)}
                          </p>
                          <p className="font-mono text-[10px] text-muted-foreground">costo est.</p>
                        </div>
                        <div className="rounded-lg bg-surface p-2">
                          <p className="font-display text-base font-semibold">{reco.cantidad}</p>
                          <p className="font-mono text-[10px] text-muted-foreground">unidades</p>
                        </div>
                      </div>
                      <p className="mt-2 text-[12px] leading-relaxed text-muted-foreground">
                        Cuándo: {reco.cuando}. {reco.porque}
                      </p>

                      {estado ? (
                        <p className="mt-3 font-mono text-[11px] text-good">
                          ◆ Decisión registrada: {estado}. Revísala en Historial de decisiones.
                        </p>
                      ) : editando?.turn === turn.id ? (
                        <div className="mt-3 flex gap-2">
                          <input
                            type="number"
                            value={editando.cantidad}
                            onChange={(e) =>
                              setEditando({ turn: turn.id, cantidad: Number(e.target.value) })
                            }
                            className="w-24 rounded-lg border border-line bg-surface-2 px-2 py-2 font-mono text-[13px] outline-none focus:border-accent"
                          />
                          <button
                            onClick={async () => {
                              if (
                                !(await addDecision({
                                  sku: reco.sku,
                                  nombre: reco.nombre,
                                  cantidadSugerida: reco.cantidad,
                                  cantidadFinal: editando.cantidad,
                                  costo: Math.round(
                                    (reco.costo / reco.cantidad) * editando.cantidad,
                                  ),
                                  estado: "modificado",
                                  motivo: "Cantidad ajustada por el encargado de compras.",
                                }))
                              )
                                return;
                              pushLog(
                                "supervisor",
                                `Pedido modificado: ${reco.nombre} → ${editando.cantidad} u.`,
                              );
                              setEditando(null);
                            }}
                            className="flex-1 rounded-lg bg-accent py-2 text-[13px] font-medium text-accent-foreground"
                          >
                            Confirmar cantidad
                          </button>
                        </div>
                      ) : (
                        <div className="mt-3 flex gap-2">
                          <button
                            onClick={async () => {
                              if (
                                !(await addDecision({
                                  sku: reco.sku,
                                  nombre: reco.nombre,
                                  cantidadSugerida: reco.cantidad,
                                  cantidadFinal: reco.cantidad,
                                  costo: reco.costo,
                                  estado: "aprobado",
                                  motivo: "Aprobado desde el panel del Supervisor.",
                                }))
                              )
                                return;
                              pushLog(
                                "supervisor",
                                `Pedido aprobado por el humano: ${reco.nombre} (${reco.cantidad} u).`,
                              );
                            }}
                            className="flex-1 rounded-lg bg-accent py-2.5 text-[13px] font-medium text-accent-foreground transition-colors hover:bg-accent/90"
                          >
                            Aprobar
                          </button>
                          <button
                            onClick={() => setEditando({ turn: turn.id, cantidad: reco.cantidad })}
                            className="rounded-lg border border-line px-3 py-2.5 text-[13px] text-muted-foreground transition-colors hover:border-muted-foreground hover:text-foreground"
                          >
                            Modificar
                          </button>
                          <button
                            onClick={async () => {
                              if (
                                !(await addDecision({
                                  sku: reco.sku,
                                  nombre: reco.nombre,
                                  cantidadSugerida: reco.cantidad,
                                  cantidadFinal: 0,
                                  costo: 0,
                                  estado: "pospuesto",
                                  motivo: "Pospuesto para la siguiente revisión semanal.",
                                }))
                              )
                                return;
                              pushLog("supervisor", `Pedido pospuesto: ${reco.nombre}.`);
                            }}
                            className="rounded-lg border border-line px-3 py-2.5 text-[13px] text-muted-foreground transition-colors hover:text-foreground"
                          >
                            Posponer
                          </button>
                        </div>
                      )}
                    </div>
                  )}

                  {a.nota && (
                    <p className="flex items-start gap-1.5 font-mono text-[11px] leading-snug text-muted-foreground">
                      <span className="text-warn">◆</span> {a.nota}
                    </p>
                  )}
                  {ti === turns.length - 1 && (
                    <div className="flex flex-wrap gap-1.5 pt-1">
                      {SUGERENCIAS.slice(0, 4).map((s) => (
                        <button
                          key={s}
                          onClick={() => preguntar(s)}
                          className="rounded-lg border border-line px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:border-accent/50 hover:text-foreground"
                        >
                          {s}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          preguntar(input);
        }}
        className="shrink-0 border-t border-line p-3"
      >
        <div className="flex items-center gap-2 rounded-lg bg-surface-2 py-1.5 pl-3 pr-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            className="flex-1 bg-transparent text-[13px] outline-none placeholder:text-muted-foreground"
            placeholder="Pregunta en lenguaje natural…"
            aria-label="Consulta al Agente Supervisor"
          />
          <button
            type="submit"
            className="grid size-7 place-items-center rounded-md bg-accent font-display text-xs font-semibold text-accent-foreground"
            aria-label="Enviar consulta"
          >
            ↵
          </button>
        </div>
      </form>
    </aside>
  );
}
