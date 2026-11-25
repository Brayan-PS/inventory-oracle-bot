import { useEffect, useState } from "react";
import { useStore } from "../lib/store";
import { Panel } from "./kit";

const KEY = "intelli-stock:decisions";

export function LegacyDecisionsImport() {
  const { importDecisions, saving } = useStore();
  const [local, setLocal] = useState<unknown[] | null>(null);
  const [message, setMessage] = useState("");
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(KEY);
      if (!raw) return;
      const data: unknown = JSON.parse(raw);
      if (Array.isArray(data) && data.length) setLocal(data);
      else if (!Array.isArray(data))
        setMessage(
          "El historial anterior no tiene el formato esperado. Conserva una copia antes de continuar.",
        );
    } catch {
      setMessage("No se pudo leer el historial anterior de este navegador.");
    }
  }, []);
  async function importData(data: unknown) {
    const inserted = await importDecisions(data);
    if (inserted !== null)
      setMessage(
        `Importación completada: ${inserted} decisiones nuevas. Los registros repetidos se conservaron sin duplicar.`,
      );
  }
  function exportLocal() {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(local, null, 2)], { type: "application/json" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = "intelli-stock-decisions.json";
    link.click();
    URL.revokeObjectURL(url);
  }
  return (
    <Panel className="space-y-3 p-4">
      <p className="text-sm">
        Importar historial anterior. La importación conserva la fecha y el usuario originales y no
        borra la copia del navegador.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        {local && (
          <>
            <button
              disabled={saving}
              onClick={() => void importData(local)}
              className="rounded-lg border border-line px-3 py-2"
            >
              Importar de este navegador ({local.length})
            </button>
            <button onClick={exportLocal} className="rounded-lg border border-line px-3 py-2">
              Descargar copia
            </button>
          </>
        )}
        <label className="text-sm">
          Importar archivo JSON
          <input
            type="file"
            accept=".json,application/json"
            disabled={saving}
            className="ml-3 text-sm"
            onChange={async (event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (!file) return;
              if (file.size > 5 * 1024 * 1024) {
                setMessage("El archivo supera el límite de 5 MB.");
                return;
              }
              try {
                await importData(JSON.parse(await file.text()));
              } catch {
                setMessage(
                  "El archivo no contiene JSON válido. La copia original no se ha modificado.",
                );
              }
            }}
          />
        </label>
      </div>
      {message && (
        <p role="status" className="text-sm text-muted-foreground">
          {message}
        </p>
      )}
    </Panel>
  );
}
