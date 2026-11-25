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
export const importDecisionsSchema = z.array(decisionSchema).min(1).max(10000);
export type DecisionInput = z.infer<typeof decisionInputSchema>;
export type Decision = z.infer<typeof decisionSchema>;
export type DecisionEstado = Decision["estado"];
