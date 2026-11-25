import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { Bar, Kpi, Panel, RiskBadge, money, riskColorVar } from "@/components/kit";
import { type Product, type RiskLevel } from "@/lib/inventory";
import { useInventory } from "@/lib/store";

export const Route = createFileRoute("/productos/")({
  head: () => ({
    meta: [
      { title: "Productos | Intelli-Stock" },
      {
        name: "description",
        content:
          "Catálogo completo con stock, cobertura, rotación, demanda prevista, riesgo de quiebre y cantidad recomendada de reposición por SKU.",
      },
      { property: "og:title", content: "Productos | Intelli-Stock" },
      {
        property: "og:description",
        content: "Buscador, filtros y ranking de riesgo sobre todo el catálogo de inventario.",
      },
    ],
  }),
  component: Productos,
});

type SortKey = "riesgo" | "cobertura" | "rotacion" | "ventas30" | "nombre" | "stock";

function Productos() {
  const { CATEGORY_LIST, METRICS, PRODUCTS } = useInventory();
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("todas");
  const [risk, setRisk] = useState<"todos" | RiskLevel>("todos");
  const [sort, setSort] = useState<SortKey>("riesgo");

  const lista = useMemo(() => {
    const n = q.toLowerCase().trim();
    let out: Product[] = PRODUCTS.filter(
      (p) =>
        (!n ||
          p.nombre.toLowerCase().includes(n) ||
          p.sku.toLowerCase().includes(n) ||
          p.proveedor.toLowerCase().includes(n)) &&
        (cat === "todas" || p.categoria === cat) &&
        (risk === "todos" || p.riesgo === risk),
    );
    const cmp: Record<SortKey, (a: Product, b: Product) => number> = {
      riesgo: (a, b) => b.riesgoScore - a.riesgoScore,
      cobertura: (a, b) => a.cobertura - b.cobertura,
      rotacion: (a, b) => b.rotacion - a.rotacion,
      ventas30: (a, b) => b.ventas30 - a.ventas30,
      stock: (a, b) => a.stock - b.stock,
      nombre: (a, b) => a.nombre.localeCompare(b.nombre),
    };
    out = [...out].sort(cmp[sort]);
    return out;
  }, [q, cat, risk, sort, PRODUCTS]);

  const select =
    "rounded-lg border border-line bg-surface-2 px-3 py-2 text-[13px] outline-none focus:border-accent";

  return (
    <AppShell title="Productos" subtitle={`${PRODUCTS.length} SKUs monitoreados · 8 categorías`}>
      <section className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Kpi
          label="SKUs listados"
          value={lista.length}
          hint={`de ${METRICS.totalSkus} en catálogo`}
        />
        <Kpi
          label="En riesgo alto o crítico"
          value={lista.filter((p) => p.riesgo === "critico" || p.riesgo === "alto").length}
          tone="accent"
          delay={40}
        />
        <Kpi
          label="Requieren reposición"
          value={lista.filter((p) => p.cantidadRecomendada > 0).length}
          tone="warn"
          delay={80}
        />
        <Kpi
          label="Con sobrestock"
          value={lista.filter((p) => p.sobrestock).length}
          tone="info"
          delay={120}
        />
      </section>

      <Panel className="p-4" delay={60}>
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar por nombre, SKU o proveedor…"
            className="min-w-[240px] flex-1 rounded-lg border border-line bg-surface-2 px-3 py-2 text-[13px] outline-none placeholder:text-muted-foreground focus:border-accent"
            aria-label="Buscar producto"
          />
          <select
            className={select}
            value={cat}
            onChange={(e) => setCat(e.target.value)}
            aria-label="Filtrar por categoría"
          >
            <option value="todas">Todas las categorías</option>
            {CATEGORY_LIST.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <select
            className={select}
            value={risk}
            onChange={(e) => setRisk(e.target.value as RiskLevel | "todos")}
            aria-label="Filtrar por riesgo"
          >
            <option value="todos">Todo nivel de riesgo</option>
            <option value="critico">Crítico</option>
            <option value="alto">Alto</option>
            <option value="moderado">Moderado</option>
            <option value="saludable">Saludable</option>
          </select>
          <select
            className={select}
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
            aria-label="Ordenar"
          >
            <option value="riesgo">Ordenar: mayor riesgo</option>
            <option value="cobertura">Ordenar: menor cobertura</option>
            <option value="rotacion">Ordenar: mayor rotación</option>
            <option value="ventas30">Ordenar: más vendidos (30d)</option>
            <option value="stock">Ordenar: menor stock</option>
            <option value="nombre">Ordenar: nombre A-Z</option>
          </select>
        </div>
      </Panel>

      <section className="grid grid-cols-1 gap-3 md:grid-cols-2 2xl:grid-cols-3">
        {lista.map((p, i) => (
          <Link
            key={p.sku}
            to="/productos/$sku"
            params={{ sku: p.sku }}
            className="rise rounded-xl border border-line bg-surface p-4 transition-colors hover:border-accent/40"
            style={{ animationDelay: `${Math.min(i * 25, 300)}ms` }}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate font-medium">{p.nombre}</p>
                <p className="font-mono text-[11px] text-muted-foreground">
                  {p.sku} · {p.categoria}
                </p>
              </div>
              <RiskBadge level={p.riesgo} />
            </div>

            <div className="mt-3 grid grid-cols-4 gap-2 text-center">
              <div className="rounded-lg bg-surface-2 py-2">
                <p className="font-display text-sm font-semibold">{p.stock}</p>
                <p className="font-mono text-[10px] text-muted-foreground">stock</p>
              </div>
              <div className="rounded-lg bg-surface-2 py-2">
                <p className="font-display text-sm font-semibold">{p.cobertura}d</p>
                <p className="font-mono text-[10px] text-muted-foreground">cobertura</p>
              </div>
              <div className="rounded-lg bg-surface-2 py-2">
                <p className="font-display text-sm font-semibold">{p.demanda7}</p>
                <p className="font-mono text-[10px] text-muted-foreground">dem. 7d</p>
              </div>
              <div className="rounded-lg bg-surface-2 py-2">
                <p className="font-display text-sm font-semibold">{p.rotacion}×</p>
                <p className="font-mono text-[10px] text-muted-foreground">rotación</p>
              </div>
            </div>

            <div className="mt-3">
              <div className="mb-1 flex justify-between font-mono text-[11px] text-muted-foreground">
                <span>Riesgo de quiebre</span>
                <span style={{ color: riskColorVar(p.riesgo) }}>{p.probQuiebre}%</span>
              </div>
              <Bar value={p.probQuiebre} level={p.riesgo} />
            </div>

            <div className="mt-3 flex items-center justify-between border-t border-line pt-3 font-mono text-[11px]">
              <span className="text-muted-foreground">
                mín {p.stockMin} · máx {p.stockMax} · lead {p.leadTime}d
              </span>
              {p.cantidadRecomendada > 0 ? (
                <span className="text-accent">
                  reponer {p.cantidadRecomendada} u · {money(p.costoReposicion)}
                </span>
              ) : (
                <span className={p.sobrestock ? "text-info" : "text-good"}>
                  {p.sobrestock ? "sobrestock" : "sin acción"}
                </span>
              )}
            </div>
          </Link>
        ))}
        {lista.length === 0 && (
          <p className="col-span-full py-10 text-center text-muted-foreground">
            Ningún producto coincide con los filtros.
          </p>
        )}
      </section>
    </AppShell>
  );
}
