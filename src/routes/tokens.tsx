import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { AppShell } from "@/components/AppShell";
import { Kpi, Panel, PanelHead, Tag } from "@/components/kit";
import { AGENT_BY_ID, type AgentId } from "@/lib/supervisor";

export const Route = createFileRoute("/tokens")({
  head: () => ({
    meta: [
      { title: "Uso de tokens | Intelli-Stock" },
      {
        name: "description",
        content:
          "Consumo de tokens del Supervisor con LLM: registro por consulta, uso por hora y por día, y proyección del tope diario.",
      },
    ],
  }),
  component: Tokens,
});

interface Registro {
  id: string;
  fecha: string;
  consulta: string;
  modo: "llm" | "reglas";
  modelo: string;
  motivo: string | null;
  llamadas: { agente: AgentId; herramienta: string }[];
  tokensEntrada: number;
  tokensSalida: number;
  costoUsd: number;
  duracionMs: number;
}

interface Uso {
  zonaHoraria: string;
  horaActual: number;
  hoy: {
    entrada: number;
    salida: number;
    consultas: number;
    consultasLLM: number;
    costoUsd: number;
  };
  porHora: { hora: number; entrada: number; salida: number; consultas: number }[];
  porDia: { dia: string; entrada: number; salida: number; consultas: number }[];
  porModelo: { modelo: string; tokens: number; consultas: number }[];
  topes: {
    tokensDia: number;
    consultasDia: number;
    consultasMinuto: number;
    maxTokensSalida: number;
    maxLlamadasAgentes: number;
  };
  modelo: { principal: string; respaldo: string[] };
  precios: { entradaPorMillon: number; salidaPorMillon: number };
  proyeccion: {
    usadosHoy: number;
    restantes: number;
    porcentaje: number;
    promedioPorConsulta: number;
    consultasRestantes: number | null;
    ritmoTokensHora: number;
    horaEstimadaTope: number | null;
  };
  registros: Registro[];
  alcance?: "todos" | "propio";
}

const fmt = (n: number) => Math.round(n).toLocaleString("es-PE");
const hhmm = (h: number) =>
  `${String(Math.floor(h)).padStart(2, "0")}:${String(Math.floor((h % 1) * 60)).padStart(2, "0")}`;
const fechaHora = (iso: string) =>
  new Date(iso).toLocaleString("es-PE", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

const tooltipStyle = {
  contentStyle: {
    background: "var(--surface-2)",
    border: "1px solid var(--line)",
    borderRadius: 10,
    fontSize: 12,
  },
  labelStyle: { color: "var(--muted-foreground)", fontSize: 11 },
  formatter: (v: unknown) => (typeof v === "number" ? fmt(v) : String(v ?? "")),
};

function Tokens() {
  const [uso, setUso] = useState<Uso | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let vivo = true;
    const cargar = () =>
      fetch("/api/token-usage")
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error("HTTP"))))
        .then((d: Uso) => {
          if (vivo) {
            setUso(d);
            setError(false);
          }
        })
        .catch(() => vivo && setError(true));
    void cargar();
    const t = setInterval(cargar, 10000);
    return () => {
      vivo = false;
      clearInterval(t);
    };
  }, []);

  const porHora = useMemo(() => {
    if (!uso) return [];
    return Array.from({ length: 24 }, (_, h) => {
      const f = uso.porHora.find((x) => x.hora === h);
      return {
        hora: `${String(h).padStart(2, "0")}h`,
        entrada: f?.entrada ?? 0,
        salida: f?.salida ?? 0,
        consultas: f?.consultas ?? 0,
      };
    });
  }, [uso]);

  // Consumo acumulado de hoy + proyección al ritmo actual hasta medianoche.
  const acumulado = useMemo(() => {
    if (!uso) return [];
    const ahora = uso.horaActual;
    const corte = Math.floor(ahora) + 1;
    const ritmo = uso.proyeccion.ritmoTokensHora;
    const tope = uso.topes.tokensDia;
    let acc = 0;
    const out: { hora: string; real: number | null; proyeccion: number | null }[] = [];
    for (let h = 0; h <= 24; h++) {
      if (h > 0) {
        const f = uso.porHora.find((x) => x.hora === h - 1);
        if (h <= corte) acc += (f?.entrada ?? 0) + (f?.salida ?? 0);
      }
      const real = h <= corte ? acc : null;
      const proy =
        ritmo > 0 && h >= corte ? Math.min(tope * 1.15, acc + ritmo * (h - corte)) : null;
      out.push({ hora: `${String(h).padStart(2, "0")}:00`, real, proyeccion: proy });
    }
    return out;
  }, [uso]);

  const porDia = useMemo(
    () =>
      (uso?.porDia ?? []).map((d) => ({
        dia: d.dia.slice(5).split("-").reverse().join("/"),
        entrada: d.entrada,
        salida: d.salida,
        consultas: d.consultas,
      })),
    [uso],
  );

  if (!uso) {
    return (
      <AppShell title="Uso de tokens" subtitle="Consumo del Supervisor con LLM">
        <Panel className="p-6 text-[13px] text-muted-foreground">
          {error ? "No se pudo leer el uso de tokens del servidor." : "Cargando uso de tokens…"}
        </Panel>
      </AppShell>
    );
  }

  const p = uso.proyeccion;
  const tope = uso.topes.tokensDia;
  const alcanzado = p.usadosHoy >= tope;
  const tono = p.porcentaje >= 90 ? "warn" : p.porcentaje >= 60 ? "info" : "good";
  const barraColor =
    p.porcentaje >= 90 ? "var(--warn)" : p.porcentaje >= 60 ? "var(--info)" : "var(--good)";

  return (
    <AppShell
      title="Uso de tokens"
      subtitle={`Supervisor con LLM · modelo ${uso.modelo.principal} · zona horaria ${uso.zonaHoraria}`}
    >
      <section className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5">
        <Kpi
          label="Tokens hoy"
          value={fmt(p.usadosHoy)}
          tone="info"
          hint={`${fmt(uso.hoy.entrada)} entrada · ${fmt(uso.hoy.salida)} salida`}
        />
        <Kpi
          label="Consultas hoy"
          value={uso.hoy.consultas}
          hint={`${uso.hoy.consultasLLM} con LLM · ${uso.hoy.consultas - uso.hoy.consultasLLM} por reglas`}
          delay={40}
        />
        <Kpi
          label="Promedio por consulta"
          value={fmt(p.promedioPorConsulta)}
          unit="tokens"
          hint="Solo consultas respondidas por el LLM"
          delay={80}
        />
        <Kpi
          label="Costo estimado hoy"
          value={uso.hoy.costoUsd.toFixed(4)}
          unit="US$"
          hint={`A precio de pago (US$ ${uso.precios.entradaPorMillon}/${uso.precios.salidaPorMillon} por M). Nivel gratuito: US$ 0`}
          delay={120}
        />
        <Kpi
          label="Tope diario usado"
          value={p.porcentaje.toFixed(1)}
          unit="%"
          tone={tono}
          hint={`${fmt(p.usadosHoy)} de ${fmt(tope)} tokens`}
          delay={160}
        />
      </section>

      <section className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Panel className="xl:col-span-2" delay={60}>
          <PanelHead
            title="Consumo acumulado de hoy vs tope diario"
            subtitle="Línea continua: real · Línea punteada: proyección al ritmo actual"
          />
          <div className="h-[280px] p-4">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={acumulado}>
                <CartesianGrid stroke="var(--line)" vertical={false} />
                <XAxis
                  dataKey="hora"
                  stroke="var(--muted-foreground)"
                  fontSize={10}
                  tickLine={false}
                  axisLine={false}
                  interval={2}
                />
                <YAxis
                  stroke="var(--muted-foreground)"
                  fontSize={10}
                  tickLine={false}
                  axisLine={false}
                  width={56}
                  domain={[0, Math.ceil(tope * 1.15)]}
                  tickFormatter={(v: number) =>
                    v >= 1000 ? `${Math.round(v / 1000)}k` : String(v)
                  }
                />
                <Tooltip {...tooltipStyle} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <ReferenceLine
                  y={tope}
                  stroke="var(--warn)"
                  strokeDasharray="6 4"
                  label={{
                    value: `Tope ${fmt(tope)}`,
                    position: "insideTopLeft",
                    fill: "var(--warn)",
                    fontSize: 11,
                  }}
                />
                <Line
                  type="monotone"
                  dataKey="real"
                  name="Tokens acumulados"
                  stroke="var(--info)"
                  strokeWidth={2.5}
                  dot={false}
                  connectNulls={false}
                />
                <Line
                  type="monotone"
                  dataKey="proyeccion"
                  name="Proyección"
                  stroke="var(--info)"
                  strokeWidth={2}
                  strokeDasharray="5 5"
                  dot={false}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </Panel>

        <Panel className="p-5" delay={100}>
          <h2 className="font-display font-semibold tracking-tight">¿Cuándo se alcanza el tope?</h2>
          <p className="font-mono text-[11px] text-muted-foreground">
            Presupuesto diario propio del equipo (LLM_DAILY_TOKEN_CAP)
          </p>
          <div className="mt-4 h-3 w-full overflow-hidden rounded-full bg-surface-2">
            <div
              className="h-full rounded-full transition-all"
              style={{ width: `${Math.max(1, p.porcentaje)}%`, background: barraColor }}
            />
          </div>
          <p className="mt-2 font-mono text-[11px] text-muted-foreground">
            {fmt(p.usadosHoy)} / {fmt(tope)} tokens · quedan {fmt(p.restantes)}
          </p>
          <p className="mt-4 text-[13px] leading-relaxed">
            {alcanzado ? (
              <>
                <span className="font-semibold text-warn">Tope alcanzado.</span> Hasta la medianoche
                ({uso.zonaHoraria}) el Supervisor responde con el motor de reglas.
              </>
            ) : p.horaEstimadaTope !== null ? (
              <>
                Al ritmo actual ({fmt(p.ritmoTokensHora)} tokens/hora) el tope se alcanzaría{" "}
                <span className="font-semibold text-warn">
                  hoy a las {hhmm(p.horaEstimadaTope)}
                </span>
                .
              </>
            ) : p.ritmoTokensHora > 0 ? (
              <>
                Al ritmo actual ({fmt(p.ritmoTokensHora)} tokens/hora){" "}
                <span className="font-semibold text-good">no se alcanza hoy</span>. El contador se
                reinicia a medianoche.
              </>
            ) : (
              <>Aún no hay consultas con LLM hoy.</>
            )}
          </p>
          {p.consultasRestantes !== null && !alcanzado && (
            <p className="mt-2 text-[13px] text-muted-foreground">
              Con el promedio actual ({fmt(p.promedioPorConsulta)} tokens por consulta) quedan
              aprox.{" "}
              <span className="font-semibold text-foreground">{fmt(p.consultasRestantes)}</span>{" "}
              consultas.
            </p>
          )}
          <div className="mt-4 space-y-1 border-t border-line pt-3 font-mono text-[11px] text-muted-foreground">
            <p>Límite por consulta: {fmt(uso.topes.maxTokensSalida)} tokens de salida</p>
            <p>Máx. {uso.topes.maxLlamadasAgentes} llamadas a agentes por consulta</p>
            <p>
              {uso.topes.consultasMinuto} consultas/min por IP · {uso.topes.consultasDia}{" "}
              consultas/día
            </p>
            <p>Modelos de respaldo: {uso.modelo.respaldo.join(", ") || "—"}</p>
          </div>
        </Panel>
      </section>

      <section className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Panel className="xl:col-span-2" delay={140}>
          <PanelHead
            title="Tokens por hora (hoy)"
            subtitle="Entrada y salida por cada hora del día"
          />
          <div className="h-[240px] p-4">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={porHora}>
                <CartesianGrid stroke="var(--line)" vertical={false} />
                <XAxis
                  dataKey="hora"
                  stroke="var(--muted-foreground)"
                  fontSize={10}
                  tickLine={false}
                  axisLine={false}
                  interval={1}
                />
                <YAxis
                  stroke="var(--muted-foreground)"
                  fontSize={10}
                  tickLine={false}
                  axisLine={false}
                  width={56}
                  tickFormatter={(v: number) =>
                    v >= 1000 ? `${Math.round(v / 1000)}k` : String(v)
                  }
                />
                <Tooltip {...tooltipStyle} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="entrada" name="Entrada" stackId="t" fill="var(--info)" />
                <Bar
                  dataKey="salida"
                  name="Salida"
                  stackId="t"
                  fill="var(--warn)"
                  radius={[4, 4, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>

        <Panel delay={180}>
          <PanelHead title="Últimos 7 días" subtitle="Tokens por día vs tope diario" />
          <div className="h-[240px] p-4">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={porDia}>
                <CartesianGrid stroke="var(--line)" vertical={false} />
                <XAxis
                  dataKey="dia"
                  stroke="var(--muted-foreground)"
                  fontSize={10}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  stroke="var(--muted-foreground)"
                  fontSize={10}
                  tickLine={false}
                  axisLine={false}
                  width={56}
                  domain={[0, Math.ceil(tope * 1.1)]}
                  tickFormatter={(v: number) =>
                    v >= 1000 ? `${Math.round(v / 1000)}k` : String(v)
                  }
                />
                <Tooltip {...tooltipStyle} />
                <ReferenceLine y={tope} stroke="var(--warn)" strokeDasharray="6 4" />
                <Bar dataKey="entrada" name="Entrada" stackId="d" fill="var(--info)" />
                <Bar
                  dataKey="salida"
                  name="Salida"
                  stackId="d"
                  fill="var(--warn)"
                  radius={[4, 4, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="border-t border-line px-5 py-3 font-mono text-[11px] text-muted-foreground">
            {uso.porModelo.length
              ? uso.porModelo.map((m) => (
                  <p key={m.modelo}>
                    Hoy · {m.modelo}: {fmt(m.tokens)} tokens en {m.consultas} consultas
                  </p>
                ))
              : "Sin consultas con LLM hoy."}
          </div>
        </Panel>
      </section>

      <Panel delay={220}>
        <PanelHead
          title="Registro de consumo por consulta"
          subtitle={`Últimas ${uso.registros.length} consultas ${uso.alcance === "propio" ? "tuyas " : ""}(tabla agent_runs en PostgreSQL)`}
        />
        <div className="max-h-[520px] overflow-auto">
          <table className="w-full text-left text-[12px]">
            <thead className="sticky top-0 bg-surface-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-4 py-2">Fecha y hora</th>
                <th className="px-4 py-2">Qué se hizo</th>
                <th className="px-4 py-2">Modelo</th>
                <th className="px-4 py-2 text-right">Entrada</th>
                <th className="px-4 py-2 text-right">Salida</th>
                <th className="px-4 py-2 text-right">Total</th>
                <th className="px-4 py-2 text-right">Costo US$</th>
                <th className="px-4 py-2 text-right">Tiempo</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line/70">
              {uso.registros.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-4 text-muted-foreground">
                    Aún no hay consultas. Pregunta algo en el panel del Supervisor.
                  </td>
                </tr>
              )}
              {uso.registros.map((r) => (
                <tr key={r.id} className="align-top">
                  <td className="whitespace-nowrap px-4 py-2.5 font-mono text-[11px] text-muted-foreground">
                    {fechaHora(r.fecha)}
                  </td>
                  <td className="px-4 py-2.5">
                    <p className="font-medium">“{r.consulta}”</p>
                    <p className="mt-0.5 font-mono text-[10px] text-muted-foreground">
                      {r.llamadas.length
                        ? r.llamadas
                            .map(
                              (l) =>
                                `${AGENT_BY_ID[l.agente]?.corto ?? l.agente} → ${l.herramienta}`,
                            )
                            .join(" · ")
                        : "Sin llamadas a agentes"}
                    </p>
                    {r.motivo && (
                      <p className="mt-0.5 font-mono text-[10px] text-warn">Respaldo: {r.motivo}</p>
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    <Tag tone={r.modo === "llm" ? "good" : "warn"}>
                      {r.modo === "llm" ? "LLM" : "Reglas"}
                    </Tag>
                    <p className="mt-1 font-mono text-[10px] text-muted-foreground">{r.modelo}</p>
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono">{fmt(r.tokensEntrada)}</td>
                  <td className="px-4 py-2.5 text-right font-mono">{fmt(r.tokensSalida)}</td>
                  <td className="px-4 py-2.5 text-right font-mono font-semibold">
                    {fmt(r.tokensEntrada + r.tokensSalida)}
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono">{r.costoUsd.toFixed(5)}</td>
                  <td className="px-4 py-2.5 text-right font-mono">
                    {(r.duracionMs / 1000).toFixed(1)} s
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </AppShell>
  );
}
