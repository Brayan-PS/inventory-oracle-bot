import { test, expect } from "@playwright/test";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";

// SQL cleanup is intentionally restricted to the separate test Compose project.
const project = "inventory-oracle-bot-test";
process.env.APP_PORT = "3001";
process.env.DB_PORT = "5434";
function docker(args) {
  const result = spawnSync("docker", ["compose", "-p", project, ...args], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
  return result.stdout.trim();
}
function sql(query) {
  return docker([
    "exec",
    "-T",
    "db",
    "sh",
    "-c",
    'exec psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "$1"',
    "test",
    query,
  ]);
}
const input = () => ({
  id: randomUUID(),
  sku: "SKU-1042",
  nombre: "Café de Grano 500g",
  cantidadSugerida: 230,
  cantidadFinal: 230,
  costo: 4255,
  estado: "aprobado",
  motivo: "E2E: verificación",
});
const legacy = () => ({
  ...input(),
  id: `e2e-${randomUUID()}`,
  fecha: "2026-09-01T12:00:00.000Z",
  usuario: "Usuario histórico",
});
const headers = { Origin: "http://localhost:3001" };

test.beforeEach(() => {
  sql("DELETE FROM decisions");
});
test.afterAll(() => {
  sql("DELETE FROM decisions");
});

test("rutas, estilos, navegación y 404", async ({ page, request }) => {
  for (const route of [
    "/",
    "/productos",
    "/productos/SKU-1042",
    "/reposicion",
    "/prediccion",
    "/inventario",
    "/analitica",
    "/agentes",
    "/reportes",
    "/historial",
    "/simulador",
  ]) {
    const response = await request.get(route);
    expect(response.status(), route).toBe(200);
  }
  expect((await request.get("/productos/SKU-INEXISTENTE")).status()).toBe(404);
  await page.goto("/productos");
  await page.getByRole("textbox", { name: "Buscar producto" }).fill("Café de Grano");
  await page
    .getByRole("link", { name: /Café de Grano 500g/ })
    .first()
    .click();
  await expect(
    page.getByRole("heading", { name: "Café de Grano 500g", exact: true }),
  ).toBeVisible();
});

test("aprobar desde ficha, modificar, posponer y descartar desde el plan", async ({
  page,
  request,
}) => {
  await page.goto("/productos/SKU-1042");
  await page.getByRole("button", { name: "Aprobar", exact: true }).click();
  await expect(page.getByText("◆ Decisión registrada: aprobado.", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText("◆ Decisión registrada: aprobado.", { exact: true })).toBeVisible();
  await page.goto("/reposicion");
  await page.getByRole("button", { name: "Modificar cantidad", exact: true }).first().click();
  await page.getByRole("spinbutton", { name: "Nueva cantidad" }).fill("70");
  await Promise.all([
    page.waitForResponse(
      (r) => r.url().endsWith("/api/decisions") && r.request().method() === "POST" && r.ok(),
    ),
    page.getByRole("button", { name: "Confirmar", exact: true }).click(),
  ]);
  await Promise.all([
    page.waitForResponse(
      (r) => r.url().endsWith("/api/decisions") && r.request().method() === "POST" && r.ok(),
    ),
    page.getByRole("button", { name: "Posponer", exact: true }).first().click(),
  ]);
  await Promise.all([
    page.waitForResponse(
      (r) => r.url().endsWith("/api/decisions") && r.request().method() === "POST" && r.ok(),
    ),
    page.getByRole("button", { name: "Descartar", exact: true }).first().click(),
  ]);
  const decisions = await (await request.get("/api/decisions")).json();
  expect(decisions.map((d) => d.estado).sort()).toEqual([
    "aprobado",
    "descartado",
    "modificado",
    "pospuesto",
  ]);
  expect(decisions.find((d) => d.estado === "modificado").cantidadFinal).toBe(70);
  expect(Number(sql("SELECT count(*) FROM decisions"))).toBe(4);
  await page.goto("/historial");
  await expect(
    page.getByText("Aprobado desde la ficha del producto.", { exact: true }),
  ).toBeVisible();
});

test("el Supervisor usa el catálogo PostgreSQL y permite aprobar", async ({ page, request }) => {
  const original = sql("SELECT stock FROM products WHERE sku = 'SKU-1042'");
  try {
    sql("UPDATE products SET stock = 1 WHERE sku = 'SKU-1042'");
    await page.goto("/productos/SKU-1042");
    await expect(page.getByText("Stock actual", { exact: true }).locator("..")).toContainText(
      "1 u",
    );
    await page
      .getByRole("button", { name: "¿Cuánto debería comprar de café?", exact: true })
      .first()
      .click();
    const supervisor = page.locator("aside").last();
    await expect(supervisor.getByText(/Tienes 1 u en almacén/)).toBeVisible();
    await supervisor.getByRole("button", { name: "Aprobar", exact: true }).click();
    await expect(supervisor.getByText(/Decisión registrada: aprobado/)).toBeVisible();
    expect((await (await request.get("/api/decisions")).json()).length).toBe(1);
  } finally {
    sql(`UPDATE products SET stock = ${Number(original)} WHERE sku = 'SKU-1042'`);
  }
});

test("errores de escritura visibles y reintento sin guardado ficticio", async ({
  page,
  request,
}) => {
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
  expect((await (await request.get("/api/decisions")).json()).length).toBe(0);
  await expect(page.getByRole("button", { name: "Aprobar", exact: true })).toBeVisible();
  await page.unroute("**/api/decisions");
  await page.getByRole("button", { name: "Aprobar", exact: true }).click();
  await expect(page.getByText(/Decisión registrada: aprobado/)).toBeVisible();
});

test("validación, origen e idempotencia de decisiones", async ({ request }) => {
  const data = input();
  expect(
    (
      await request.post("/api/decisions", { data, headers: { Origin: "https://otro.example" } })
    ).status(),
  ).toBe(403);
  expect(
    (
      await request.post("/api/decisions", { data: { ...data, cantidadFinal: -1 }, headers })
    ).status(),
  ).toBe(400);
  const responses = await Promise.all([
    request.post("/api/decisions", { data, headers }),
    request.post("/api/decisions", { data, headers }),
  ]);
  expect(responses.map((r) => r.status())).toEqual([200, 200]);
  expect((await (await request.get("/api/decisions")).json()).length).toBe(1);
});

test("importación de navegador/archivo conserva originales, deduplica y revierte lote inválido", async ({
  page,
  request,
}) => {
  const old = legacy();
  await page.addInitScript(
    (data) => localStorage.setItem("intelli-stock:decisions", JSON.stringify(data)),
    [old],
  );
  await page.goto("/historial");
  await page.getByRole("button", { name: /Importar de este navegador/ }).click();
  await expect(page.getByRole("status").filter({ hasText: "completada:" })).toContainText("1 decisiones nuevas");
  expect(
    await page.evaluate(() => JSON.parse(localStorage.getItem("intelli-stock:decisions"))),
  ).toEqual([old]);
  await page.getByRole("button", { name: /Importar de este navegador/ }).click();
  await expect(page.getByRole("status").filter({ hasText: "completada:" })).toContainText("0 decisiones nuevas");
  const fileEntry = { ...legacy(), estado: "pospuesto", cantidadFinal: 0, costo: 0 };
  await page
    .locator('input[type="file"]')
    .setInputFiles({
      name: "legacy.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify([fileEntry])),
    });
  await expect(page.getByRole("status").filter({ hasText: "completada:" })).toContainText("1 decisiones nuevas");
  const saved = await (await request.get("/api/decisions")).json();
  expect(saved.find((d) => d.id === old.id)).toEqual(old);
  const bad = [{ ...legacy(), sku: "NO-EXISTE" }, legacy()];
  expect((await request.post("/api/decisions/import", { data: bad, headers })).status()).toBe(400);
  expect((await (await request.get("/api/decisions")).json()).length).toBe(2);
});

test("persistencia tras recrear contenedores y repetir inicialización", async ({ request }) => {
  test.setTimeout(120000);
  const data = input();
  expect((await request.post("/api/decisions", { data, headers })).status()).toBe(200);
  const before = sql("SELECT count(*) FROM products");
  docker(["up", "-d", "--force-recreate", "--wait", "--wait-timeout", "60", "db"]);
  docker(["run", "--rm", "--no-deps", "migrate"]);
  docker(["up", "-d", "--force-recreate", "--no-deps", "--wait", "--wait-timeout", "60", "app"]);
  expect(sql("SELECT count(*) FROM products")).toBe(before);
  const rows = await (await request.get("/api/decisions")).json();
  expect(rows.map((d) => d.id)).toEqual([data.id]);
});
