import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { deriveProduct } from "./inventory";

export const loadInventory = createServerFn({ method: "GET" }).handler(async () => {
  try {
    const db = await import("../server/database.server");
    const [base, decisions] = await Promise.all([db.readProducts(), db.readDecisions()]);
    return { products: base.map(deriveProduct), decisions };
  } catch {
    throw new Error("No se pudieron cargar los datos. Comprueba PostgreSQL y las migraciones.");
  }
});
export const loadProduct = createServerFn({ method: "GET" })
  .validator(z.string().min(1).max(100))
  .handler(async ({ data }) => {
    try {
      const { readProduct } = await import("../server/database.server");
      const base = await readProduct(data);
      return base ? deriveProduct(base) : null;
    } catch {
      throw new Error("No se pudo cargar el producto. Comprueba la conexión a PostgreSQL.");
    }
  });
