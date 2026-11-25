import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import pg from "pg";

// Base de PRUEBA (ver playwright.config.mjs). Se limpia la tabla decisions antes de cada prueba.
const db = new pg.Pool({
  ...(process.env.DATABASE_URL ? { connectionString: process.env.DATABASE_URL } : {}),
  max: 2,
});
const sql = async (q, params = []) => (await db.query(q, params)).rows;

const COMPRADOR = () => ({ usuario: "e2e_comprador", password: process.env.E2E_PASS_COMPRADOR });
const LECTOR = () => ({ usuario: "e2e_lector", password: process.env.E2E_PASS_LECTOR });

async function entrar(page, cred) {
  await page.goto("/");
  await page.getByLabel("Usuario").fill(cred.usuario);
  await page.getByLabel("Contraseña").fill(cred.password);
  await page.getByRole("button", { name: "Ingresar" }).click();
  await expect(page.getByRole("heading", { name: "Centro de Inteligencia" })).toBeVisible();
}
const origin = (baseURL) => ({ Origin: baseURL });
const input = () => ({
  id: randomUUID(),
  sku: "SKU-1042",
  nombre: "Café de Grano 500g",
  cantidadSugerida: 210,
  cantidadFinal: 210,
  costo: 3885,
  estado: "aprobado",
  motivo: "E2E: verificación",
});
const legacy = () => ({
  ...input(),
  id: `e2e-${randomUUID()}`,
  fecha: "2026-09-01T12:00:00.000Z",
  usuario: "Usuario histórico",
});

test.beforeEach(async () => {
  await sql("DELETE FROM decisions");
});
test.afterAll(async () => {
  await sql("DELETE FROM decisions");
  await db.end();
});

test("sin sesión se ve el inicio de sesión; credenciales malas muestran error", async ({
  page,
}) => {
  await page.goto("/reposicion");
  await expect(page.getByRole("button", { name: "Ingresar" })).toBeVisible();
  await expect(page.getByText("SKU-1042")).toHaveCount(0);
  await page.getByLabel("Usuario").fill("e2e_comprador");
  await page.getByLabel("Contraseña").fill("incorrecta-123");
  await page.getByRole("button", { name: "Ingresar" }).click();
  await expect(page.getByRole("alert")).toContainText("Usuario o contraseña incorrectos");
});

test("rutas, navegación, 404 y cierre de sesión", async ({ page }) => {
  await entrar(page, COMPRADOR());
  for (const [ruta, titulo] of [
    ["/productos", "Productos"],
    ["/productos/SKU-1042", "Café de Grano 500g"],
    ["/reposicion", "Reposición"],
    ["/prediccion", "Predicción de Demanda"],
    ["/inventario", "Inventario"],
    ["/analitica", "Analítica"],
    ["/agentes", "Centro de Agentes IA"],
    ["/tokens", "Uso de tokens"],
    ["/reportes", "Reportes"],
    ["/historial", "Historial de decisiones"],
    ["/simulador", "¿Qué pasaría si...?"],
  ]) {
    const r = await page.goto(ruta);
    expect(r.status(), ruta).toBe(200);
    await expect(page.locator("main h1").first(), ruta).toHaveText(titulo);
  }
  expect((await page.goto("/productos/SKU-INEXISTENTE")).status()).toBe(404);
  await page.goto("/");
  await page.getByRole("button", { name: "Salir" }).click();
  await expect(page.getByRole("button", { name: "Ingresar" })).toBeVisible();
});

test("aprobar desde la ficha queda en PostgreSQL con el usuario de la sesión", async ({ page }) => {
  await entrar(page, COMPRADOR());
  await page.goto("/productos/SKU-1042");
  await page.getByRole("button", { name: "Aprobar", exact: true }).click();
  await expect(page.getByText("◆ Decisión registrada: aprobado.", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText("◆ Decisión registrada: aprobado.", { exact: true })).toBeVisible();
  const [fila] = await sql("SELECT usuario, registrado_por, origen FROM decisions");
  expect(fila.registrado_por).toBe("e2e_comprador");
  expect(fila.usuario).toContain("Comprador E2E");
  expect(fila.origen).toBe("app");
  await page.goto("/historial");
  await expect(page.getByText("Aprobado desde la ficha del producto.")).toBeVisible();
});

test("modificar, posponer y descartar desde el plan de reposición", async ({ page }) => {
  await entrar(page, COMPRADOR());
  await page.goto("/reposicion");
  const guardado = () =>
    page.waitForResponse(
      (r) => r.url().endsWith("/api/decisions") && r.request().method() === "POST" && r.ok(),
    );
  await page.getByRole("button", { name: "Modificar cantidad", exact: true }).first().click();
  await page.getByRole("spinbutton", { name: "Nueva cantidad" }).fill("70");
  await Promise.all([
    guardado(),
    page.getByRole("button", { name: "Confirmar", exact: true }).click(),
  ]);
  await Promise.all([
    guardado(),
    page.getByRole("button", { name: "Posponer", exact: true }).first().click(),
  ]);
  await Promise.all([
    guardado(),
    page.getByRole("button", { name: "Descartar", exact: true }).first().click(),
  ]);
  const estados = (await sql("SELECT estado, cantidad_final FROM decisions")).map((d) => d.estado);
  expect(estados.sort()).toEqual(["descartado", "modificado", "pospuesto"]);
  const [mod] = await sql("SELECT cantidad_final FROM decisions WHERE estado = 'modificado'");
  expect(mod.cantidad_final).toBe(70);
});

test("el Supervisor responde con datos de PostgreSQL y muestra la traza", async ({ page }) => {
  const [{ stock }] = await sql("SELECT stock FROM products WHERE sku = 'SKU-1042'");
  try {
    await sql("UPDATE products SET stock = 1 WHERE sku = 'SKU-1042'");
    await entrar(page, COMPRADOR());
    const supervisor = page.locator("aside").last();
    await supervisor.getByRole("button", { name: "¿Cuánto debería comprar de café?" }).click();
    await expect(supervisor.getByText(/Tienes 1 u en almacén/)).toBeVisible();
    await supervisor.getByText(/^Traza/).click();
    await expect(supervisor.getByText(/Reglas \(respaldo\)/)).toBeVisible();
    await supervisor.getByRole("button", { name: "Aprobar", exact: true }).click();
    await expect(supervisor.getByText(/Decisión registrada: aprobado/)).toBeVisible();
    expect((await sql("SELECT count(*)::int AS n FROM decisions"))[0].n).toBe(1);
  } finally {
    await sql("UPDATE products SET stock = $1 WHERE sku = 'SKU-1042'", [stock]);
  }
});

test("el rol lector consulta pero no puede aprobar", async ({ page, baseURL }) => {
  await entrar(page, LECTOR());
  await page.goto("/productos/SKU-1042");
  await expect(page.getByText(/no puede aprobar compras/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Aprobar", exact: true })).toHaveCount(0);
  const r = await page.request.post("/api/decisions", { data: input(), headers: origin(baseURL) });
  expect(r.status()).toBe(403);
});

test("errores de escritura visibles y reintento sin guardado ficticio", async ({ page }) => {
  await entrar(page, COMPRADOR());
  await page.goto("/productos/SKU-1042");
  await page.route("**/api/decisions", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: "Fallo de prueba al guardar." }),
    }),
  );
  await page.getByRole("button", { name: "Aprobar", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Fallo de prueba al guardar.");
  expect((await sql("SELECT count(*)::int AS n FROM decisions"))[0].n).toBe(0);
  await page.unroute("**/api/decisions");
  await page.getByRole("button", { name: "Aprobar", exact: true }).click();
  await expect(page.getByText(/Decisión registrada: aprobado/)).toBeVisible();
});

test("validación, origen e idempotencia de decisiones", async ({ page, baseURL }) => {
  await entrar(page, COMPRADOR());
  const data = input();
  const post = (d, h = origin(baseURL)) =>
    page.request.post("/api/decisions", { data: d, headers: h });
  expect((await post(data, { Origin: "https://otro.example" })).status()).toBe(403);
  expect((await post({ ...data, cantidadFinal: -1 })).status()).toBe(400);
  const r = await Promise.all([post(data), post(data)]);
  expect(r.map((x) => x.status())).toEqual([200, 200]);
  expect((await sql("SELECT count(*)::int AS n FROM decisions"))[0].n).toBe(1);
});

test("importación: conserva originales, marca 'importado', deduplica y revierte lote inválido", async ({
  page,
  baseURL,
}) => {
  const old = legacy();
  await page.addInitScript(
    (data) => localStorage.setItem("intelli-stock:decisions", JSON.stringify(data)),
    [old],
  );
  await entrar(page, COMPRADOR());
  await page.goto("/historial");
  await page.getByRole("button", { name: /Importar de este navegador/ }).click();
  await expect(page.getByRole("status").filter({ hasText: "completada:" })).toContainText(
    "1 decisiones nuevas",
  );
  await expect(page.getByText(/importado por e2e_comprador/)).toBeVisible();
  await page.getByRole("button", { name: /Importar de este navegador/ }).click();
  await expect(page.getByRole("status").filter({ hasText: "completada:" })).toContainText(
    "0 decisiones nuevas",
  );
  const [fila] = await sql("SELECT usuario, origen, registrado_por FROM decisions WHERE id = $1", [
    old.id,
  ]);
  expect(fila).toEqual({
    usuario: "Usuario histórico",
    origen: "importado",
    registrado_por: "e2e_comprador",
  });
  const bad = [{ ...legacy(), sku: "NO-EXISTE" }, legacy()];
  expect(
    (
      await page.request.post("/api/decisions/import", { data: bad, headers: origin(baseURL) })
    ).status(),
  ).toBe(400);
  expect((await sql("SELECT count(*)::int AS n FROM decisions"))[0].n).toBe(1);
});
