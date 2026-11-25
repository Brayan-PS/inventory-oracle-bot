import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buscarProductos, sugerirProductos } from "../src/lib/catalogo.ts";

const P = JSON.parse(readFileSync(new URL("../seeds/products.json", import.meta.url), "utf8"));
const skus = (q) => buscarProductos(q, P).productos.map((p) => p.sku);

test("palabras cortas: 'pan' y 'té' encuentran su producto", () => {
  assert.deepEqual(skus("¿Cuánto debería comprar de pan?"), ["SKU-8901"]);
  assert.deepEqual(skus("¿y el té?"), ["SKU-2210"]);
  assert.deepEqual(skus("Té matcha"), ["SKU-2210"]);
});

test("'te' sin tilde (pronombre) no se confunde con el té", () => {
  assert.deepEqual(skus("¿Qué te parece el plan de compra?"), []);
  assert.deepEqual(skus("te pido el plan de reposición"), []);
});

test("tildes, mayúsculas y plurales", () => {
  assert.deepEqual(skus("CAFE"), ["SKU-1042"]);
  assert.deepEqual(skus("¿cuántas galleta quedan?"), ["SKU-6702"]);
  assert.deepEqual(skus("stock de jabones de lavar"), ["SKU-5633"]);
  assert.deepEqual(skus("SKU-4544"), ["SKU-4544"]);
});

test("varios productos en una misma consulta", () => {
  assert.deepEqual(skus("¿Cuánto debo comprar de arroz y de azúcar?"), ["SKU-4501", "SKU-4522"]);
});

test("término ambiguo: 'jabón' coincide con dos productos y se pide aclaración", () => {
  const r = buscarProductos("¿cuánto jabón compro?", P);
  assert.equal(r.productos.length, 0);
  assert.equal(r.ambiguos.length, 1);
  assert.deepEqual(r.ambiguos[0].opciones.map((p) => p.sku).sort(), ["SKU-5633", "SKU-7822"]);
});

test("otra palabra desambigua: 'jabón corporal'", () => {
  const r = buscarProductos("riesgo del jabón corporal", P);
  assert.deepEqual(
    r.productos.map((p) => p.sku),
    ["SKU-7822"],
  );
  assert.equal(r.ambiguos.length, 0);
});

test("consultas generales no generan falsos productos", () => {
  for (const q of [
    "¿Qué productos debo reponer esta semana?",
    "¿Qué productos tienen riesgo crítico?",
    "Muéstrame los productos con menor cobertura",
    "¿Qué proveedor tarda más?",
  ]) {
    const r = buscarProductos(q, P);
    assert.equal(r.productos.length + r.ambiguos.length, 0, q);
  }
});

test("sugerencias solo con parecido real", () => {
  assert.deepEqual(
    sugerirProductos("chocolat", P).map((p) => p.sku),
    ["SKU-6715"],
  );
  assert.deepEqual(sugerirProductos("zanahoria", P), []);
});
