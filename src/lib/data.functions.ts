import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { deriveProduct, type Product } from "./inventory";
import type { Decision } from "./decisions";

export interface SesionUsuario {
  usuario: string;
  nombre: string;
  rol: "admin" | "comprador" | "lector";
}

export type AppData =
  | { usuario: null; products: Product[]; decisions: Decision[] }
  | { usuario: SesionUsuario; products: Product[]; decisions: Decision[] };

async function sesionActual(): Promise<SesionUsuario | undefined> {
  const { getRequest } = await import("@tanstack/react-start/server");
  const { usuarioDeSesion } = await import("../server/auth.server");
  return usuarioDeSesion(getRequest());
}

/** Datos de la aplicación. Sin sesión no se envía el catálogo ni el historial. */
export const loadApp = createServerFn({ method: "GET" }).handler(async (): Promise<AppData> => {
  const usuario = await sesionActual();
  if (!usuario) return { usuario: null, products: [], decisions: [] };
  try {
    const db = await import("../server/database.server");
    const [base, decisions] = await Promise.all([db.readProducts(), db.readDecisions()]);
    return { usuario, products: base.map(deriveProduct), decisions };
  } catch {
    throw new Error("No se pudieron cargar los datos. Comprueba PostgreSQL y las migraciones.");
  }
});

export const loadProduct = createServerFn({ method: "GET" })
  .validator(z.string().min(1).max(100))
  .handler(async ({ data }) => {
    if (!(await sesionActual())) return null;
    try {
      const { readProduct } = await import("../server/database.server");
      const base = await readProduct(data);
      return base ? deriveProduct(base) : null;
    } catch {
      throw new Error("No se pudo cargar el producto. Comprueba la conexión a PostgreSQL.");
    }
  });
