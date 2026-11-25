import { z } from "zod";

export const decisionInputSchema = z.object({
  sku: z.string().min(1).max(100),
  nombre: z.string().min(1).max(500),
  cantidadSugerida: z.number().int().min(0).max(2147483647),
  cantidadFinal: z.number().int().min(0).max(2147483647),
  costo: z.number().finite().min(0).max(999999999999.99),
  estado: z.enum(["aprobado", "modificado", "pospuesto", "descartado"]),
  motivo: z.string().max(4000),
});
export const decisionSchema = decisionInputSchema.extend({
  id: z.string().min(1).max(200),
  fecha: z.string().datetime({ offset: true }),
  usuario: z.string().min(1).max(500),
});
export const createDecisionSchema = decisionInputSchema.extend({ id: z.string().uuid() });
/** Importación del historial anterior (máx. 2000 registros por lote). */
export const importDecisionsSchema = z.array(decisionSchema).min(1).max(2000);
export type DecisionInput = z.infer<typeof decisionInputSchema>;
export type Decision = z.infer<typeof decisionSchema> & {
  /** "app" si se registró en la aplicación; "importado" si vino del historial anterior. */
  origen?: "app" | "importado";
  /** Usuario de la sesión que registró o importó la decisión (lo fija el servidor). */
  registradoPor?: string | null;
  registradoEn?: string;
};
export type DecisionEstado = Decision["estado"];
