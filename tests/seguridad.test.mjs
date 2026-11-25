import { test } from "node:test";
import assert from "node:assert/strict";
import { hashPassword, validarPassword, verifyPassword } from "../scripts/password.mjs";
import { clientIp, RateLimiter } from "../src/server/limits.server.ts";
import { sameOrigin } from "../src/server/origin.server.ts";

test("contraseñas: scrypt con sal aleatoria y verificación", () => {
  const h1 = hashPassword("Clave-Segura-2026");
  const h2 = hashPassword("Clave-Segura-2026");
  assert.match(h1, /^scrypt\$16384\$8\$1\$/);
  assert.notEqual(h1, h2, "la sal cambia en cada hash");
  assert.ok(verifyPassword("Clave-Segura-2026", h1));
  assert.ok(!verifyPassword("clave-segura-2026", h1));
  assert.ok(!verifyPassword("Clave-Segura-2026", "texto-plano"));
  assert.ok(!verifyPassword("x", undefined));
});

test("contraseñas: política mínima", () => {
  assert.match(validarPassword("corta1"), /entre 10 y 200/);
  assert.match(validarPassword("solamenteletras"), /letras y números/);
  assert.equal(validarPassword("Intelli-Stock-2026"), null);
});

const req = (headers = {}, url = "https://app.example/api/x") => new Request(url, { headers });

test("IP del cliente: no confía en valores que el cliente agrega a X-Forwarded-For", () => {
  // El cliente envía "1.1.1.1" falso; el proxy propio agrega la IP real al final.
  const r = req({ "x-forwarded-for": "1.1.1.1, 203.0.113.7" });
  assert.equal(clientIp(r, 1), "203.0.113.7");
  assert.equal(clientIp(r, 2), "1.1.1.1");
  assert.equal(clientIp(req(), 1), "directo");
  assert.equal(clientIp(r, 0), "directo");
});

test("límite por ventana deslizante", () => {
  const l = new RateLimiter(3, 60_000);
  const t = 1_000_000;
  assert.ok(l.permitir("a", t));
  assert.ok(l.permitir("a", t + 1));
  assert.ok(l.permitir("a", t + 2));
  assert.ok(!l.permitir("a", t + 3));
  assert.ok(l.permitir("b", t + 3), "otra clave tiene su propio cupo");
  assert.ok(l.permitir("a", t + 60_001), "la ventana se libera");
});

test("Origin: solo escrituras desde la misma aplicación", () => {
  assert.ok(sameOrigin(req({ origin: "https://app.example", host: "app.example" })));
  assert.ok(!sameOrigin(req({ origin: "https://evil.example", host: "app.example" })));
  assert.ok(!sameOrigin(req({ host: "app.example" })), "sin Origin se rechaza");
  assert.ok(!sameOrigin(req({ origin: "null", host: "app.example" })));
});
