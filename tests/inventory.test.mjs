import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import {
  aggregateSeries,
  ajustarPronostico,
  BT_TRAIN,
  computeMetrics,
  computeModelMetrics,
  deriveProduct,
} from "../src/lib/inventory.ts";

const products = JSON.parse(readFileSync(new URL("../seeds/products.json", import.meta.url)));
const fixture = (name) =>
  JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8"));
const stable = (value) =>
  Array.isArray(value)
    ? value.map(stable)
    : value && typeof value === "object"
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((key) => [key, stable(value[key])]),
        )
      : value;
const P = products.map(deriveProduct);

test("la refactorización conserva los resultados de negocio de la versión original (30 SKUs)", () => {
  const originales = fixture("resultados-originales.json");
  assert.equal(products.length, 30);
  for (const p of P) {
    for (const [campo, valor] of Object.entries(originales[p.sku])) {
      assert.deepEqual(p[campo], valor, `${p.sku}.${campo}`);
    }
  }
});

test("línea base: cálculos, series y recomendaciones no cambian sin querer", () => {
  const baseline = fixture("inventory-baseline.json");
  for (const product of products) {
    const hash = createHash("sha256")
      .update(JSON.stringify(stable(deriveProduct(product))))
      .digest("hex");
    assert.equal(hash, baseline[product.sku], product.sku);
  }
});

test("el historial simulado cuadra exactamente con ventas7 y ventas30", () => {
  for (const p of P) {
    const s = p.historial.map((h) => h.ventas);
    assert.equal(s.length, 56);
    assert.equal(
      s.slice(-7).reduce((a, v) => a + v, 0),
      p.ventas7,
      `${p.sku}: últimos 7 días`,
    );
    assert.equal(
      s.slice(-30).reduce((a, v) => a + v, 0),
      p.ventas30,
      `${p.sku}: últimos 30 días`,
    );
    assert.ok(s.every((v) => Number.isInteger(v) && v >= 0));
  }
});

test("métricas del catálogo (valores de la matriz de pruebas)", () => {
  const M = computeMetrics(P);
  assert.equal(M.criticos, 15);
  assert.equal(M.altos, 2);
  assert.equal(M.sobrestock, 2);
  assert.equal(M.capitalInmovilizado, 1631);
  assert.equal(M.pedidosPendientes, 23);
  assert.equal(M.costoPendiente, 35843);
  assert.equal(M.coberturaPromedio, 14.4);
});

test("backtest: los parámetros se estiman con los datos de ajuste, no con la semilla", () => {
  const mm = computeModelMetrics(P);
  assert.equal(mm.comparativa.length, 3);
  for (const m of mm.comparativa) {
    assert.ok(m.wape > 0 && m.wape < 60, `${m.modelo}: WAPE ${m.wape}`);
    assert.equal(m.precision, Math.round((100 - m.wape) * 10) / 10);
  }
  // Cambiar el campo `tendencia` (que generó la serie) no cambia el resultado del backtest:
  // el método solo ve el historial.
  const cafe = P.find((p) => p.sku === "SKU-1042");
  const otro = { ...cafe, tendencia: -0.25 };
  assert.deepEqual(
    computeModelMetrics([cafe]).comparativa,
    computeModelMetrics([otro]).comparativa,
  );
  const a = ajustarPronostico(cafe.historial.map((h) => h.ventas).slice(0, BT_TRAIN));
  assert.ok(a.fw > 1, "detecta que el fin de semana vende más");
});

test("serie del dashboard: sin pronósticos ni stock inventados en el pasado", () => {
  const serie = aggregateSeries(P);
  assert.equal(serie.length, 12);
  const pasado = serie.slice(0, 8);
  const futuro = serie.slice(8);
  // Las dos primeras semanas no tienen datos previos suficientes → sin pronóstico.
  assert.equal(pasado[0].pronostico, null);
  assert.equal(pasado[1].pronostico, null);
  // No hay historial de stock: solo el actual (S-0) y la proyección futura.
  assert.ok(pasado.slice(0, 7).every((s) => s.stock === null));
  assert.equal(
    pasado[7].stock,
    P.reduce((a, p) => a + p.stock, 0),
  );
  assert.ok(futuro.every((s) => s.demanda === null && s.pronostico > 0));
  for (let i = 1; i < futuro.length; i++) assert.ok(futuro[i].stock <= futuro[i - 1].stock);
});
