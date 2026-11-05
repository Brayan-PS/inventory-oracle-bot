import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { deriveProduct } from "../src/lib/inventory.ts";

const products = JSON.parse(readFileSync(new URL("../seeds/products.json", import.meta.url)));
const baseline = JSON.parse(
  readFileSync(new URL("./fixtures/inventory-baseline.json", import.meta.url)),
);
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

test("los 30 productos conservan todos sus cálculos, series y recomendaciones originales", () => {
  assert.equal(products.length, 30);
  for (const product of products) {
    const hash = createHash("sha256")
      .update(JSON.stringify(stable(deriveProduct(product))))
      .digest("hex");
    assert.equal(hash, baseline[product.sku], product.sku);
  }
});
