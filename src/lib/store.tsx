import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { computeMetrics, type Product } from "./inventory";
import type { AgentId } from "./supervisor";
import type { Decision, DecisionEstado, DecisionInput } from "./decisions";
export type { Decision, DecisionEstado } from "./decisions";

export interface LogEntry {
  id: string;
  hora: string;
  agente: AgentId;
  texto: string;
}
interface Snapshot {
  products: Product[];
  decisions: Decision[];
}
interface Inventory {
  PRODUCTS: Product[];
  METRICS: ReturnType<typeof computeMetrics>;
  CATEGORY_LIST: string[];
  SUPPLIER_LIST: string[];
}
interface StoreValue {
  inventory: Inventory;
  decisions: Decision[];
  log: LogEntry[];
  saving: boolean;
  addDecision: (d: DecisionInput) => Promise<boolean>;
  importDecisions: (data: unknown) => Promise<number | null>;
  pushLog: (agente: AgentId, texto: string) => void;
  pendientes: Product[];
  estadoDe: (sku: string) => DecisionEstado | undefined;
}
const StoreContext = createContext<StoreValue | null>(null);

async function postDecisions(path: string, data: unknown) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? "No se pudo guardar la decisión.");
  return result as { decisions: Decision[]; inserted: number };
}

export function StoreProvider({ children, snapshot }: { children: ReactNode; snapshot: Snapshot }) {
  const [decisions, setDecisions] = useState(snapshot.decisions);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);
  // Retain a request id across retries if the response was lost after commit.
  const retry = useRef<{ payload: string; id: string } | null>(null);
  useEffect(() => setDecisions(snapshot.decisions), [snapshot.decisions]);

  const inventory = useMemo(
    () => ({
      PRODUCTS: snapshot.products,
      METRICS: computeMetrics(snapshot.products),
      CATEGORY_LIST: [...new Set(snapshot.products.map((p) => p.categoria))].sort(),
      SUPPLIER_LIST: [...new Set(snapshot.products.map((p) => p.proveedor))].sort(),
    }),
    [snapshot.products],
  );

  const addDecision = useCallback(async (d: DecisionInput) => {
    if (busy.current) return false;
    busy.current = true;
    setSaving(true);
    setError(null);
    const payload = JSON.stringify(d);
    if (retry.current?.payload !== payload) retry.current = { payload, id: crypto.randomUUID() };
    try {
      const result = await postDecisions("/api/decisions", { ...d, id: retry.current.id });
      setDecisions(result.decisions);
      retry.current = null;
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar la decisión.");
      return false;
    } finally {
      busy.current = false;
      setSaving(false);
    }
  }, []);

  const importDecisions = useCallback(async (data: unknown) => {
    if (busy.current) return null;
    busy.current = true;
    setSaving(true);
    setError(null);
    try {
      const result = await postDecisions("/api/decisions/import", data);
      setDecisions(result.decisions);
      return result.inserted;
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo importar el historial.");
      return null;
    } finally {
      busy.current = false;
      setSaving(false);
    }
  }, []);

  const pushLog = useCallback((agente: AgentId, texto: string) => {
    const hora = new Date().toLocaleTimeString("es-PE", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
    setLog((prev) => [{ id: crypto.randomUUID(), hora, agente, texto }, ...prev].slice(0, 60));
  }, []);
  const estadoDe = useCallback(
    (sku: string) => decisions.find((d) => d.sku === sku)?.estado,
    [decisions],
  );
  const pendientes = useMemo(() => {
    const resueltos = new Set(
      decisions
        .filter((d) => d.estado === "aprobado" || d.estado === "descartado")
        .map((d) => d.sku),
    );
    return snapshot.products
      .filter((p) => p.cantidadRecomendada > 0 && !resueltos.has(p.sku))
      .sort((a, b) => b.prioridad - a.prioridad);
  }, [decisions, snapshot.products]);
  const value = useMemo(
    () => ({
      inventory,
      decisions,
      log,
      saving,
      addDecision,
      importDecisions,
      pushLog,
      pendientes,
      estadoDe,
    }),
    [
      inventory,
      decisions,
      log,
      saving,
      addDecision,
      importDecisions,
      pushLog,
      pendientes,
      estadoDe,
    ],
  );
  return (
    <StoreContext.Provider value={value}>
      {error && (
        <div
          role="alert"
          className="sticky top-0 z-50 flex items-center justify-between gap-3 bg-accent p-3 text-accent-foreground"
        >
          <span>{error}</span>
          <button onClick={() => setError(null)} aria-label="Cerrar mensaje">
            Cerrar
          </button>
        </div>
      )}
      {saving && (
        <div
          role="status"
          className="fixed bottom-4 left-4 z-50 rounded-lg bg-surface-2 px-4 py-2 text-sm"
        >
          Guardando…
        </div>
      )}
      {children}
    </StoreContext.Provider>
  );
}

export function useStore() {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("useStore debe usarse dentro de StoreProvider");
  return ctx;
}
export function useInventory() {
  return useStore().inventory;
}
