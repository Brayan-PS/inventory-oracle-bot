// Prueba de integración de punta a punta: servidor compilado (.output) + PostgreSQL real +
// Gemini simulado por HTTP (mismo protocolo que la API real: function calling).
//
// Requisitos: `npm run build` y una base PostgreSQL de prueba en DATABASE_URL o PGHOST/PGPORT/
// PGDATABASE/PGUSER/PGPASSWORD. La prueba aplica migraciones y semilla y crea usuarios de prueba.
// Uso: npm run test:integration   (se omite si no hay base configurada)
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { randomBytes, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";

const ROOT = new URL("../../", import.meta.url).pathname;
const hayBase = Boolean(process.env.DATABASE_URL || process.env.PGHOST);
const hayBuild = existsSync(`${ROOT}.output/server/index.mjs`);
const omitir = !hayBase || !hayBuild ? "requiere base PostgreSQL de prueba y npm run build" : false;

const sufijo = randomBytes(3).toString("hex");
const USUARIOS = {
  comprador: { usuario: `compra_${sufijo}`, password: `Compra-${sufijo}-2026` },
  lector: { usuario: `lector_${sufijo}`, password: `Lector-${sufijo}-2026` },
  bloqueo: { usuario: `bloqueo_${sufijo}`, password: `Bloqueo-${sufijo}-2026` },
};
let app;
let gemini;
let BASE;
const llamadasGemini = [];

function db(args, env = {}) {
  const r = spawnSync(process.execPath, ["scripts/db.mjs", ...args], {
    cwd: ROOT,
    env: { ...process.env, ...env },
    encoding: "utf8",
  });
  if (r.status !== 0) throw new Error(r.stderr || r.stdout);
}

/** Groq simulado (formato OpenAI): mismo guion que Gemini. */
const llamadasGroq = [];
function responderGroq(json, req, res) {
  llamadasGroq.push({ auth: req.headers.authorization, json });
  const ultimo = json.messages.at(-1);
  let message;
  if (ultimo.role === "tool") {
    const r = JSON.parse(ultimo.content).resultado;
    message = {
      role: "assistant",
      content: `Comprar ${r.nombre}\nTe recomiendo comprar ${r.cantidad_recomendada} unidades por S/ ${r.costo_soles.toLocaleString("en-US")}.`,
    };
  } else if (/caf[eé]/i.test(ultimo.content ?? "")) {
    message = {
      role: "assistant",
      content: null,
      tool_calls: [
        {
          id: "call_int",
          type: "function",
          function: { name: "calcular_reposicion", arguments: '{"producto":"café"}' },
        },
      ],
    };
  } else {
    message = { role: "assistant", content: "Aclaración\nSolo respondo sobre el inventario." };
  }
  res.writeHead(200, { "content-type": "application/json" });
  res.end(
    JSON.stringify({
      choices: [{ message, finish_reason: "stop" }],
      usage: { prompt_tokens: 900, completion_tokens: 40 },
    }),
  );
}

/** Gemini simulado: pide calcular_reposicion para "café" y redacta con las cifras recibidas. */
function iniciarGemini() {
  return new Promise((resolve) => {
    const srv = createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        const json = JSON.parse(body);
        if (req.url.endsWith("/chat/completions")) return responderGroq(json, req, res);
        llamadasGemini.push({ url: req.url, key: req.headers["x-goog-api-key"], json });
        const ultimo = json.contents.at(-1).parts[0];
        if ((ultimo.text ?? "").includes("[sin cuota]")) {
          res.writeHead(429, { "content-type": "application/json" });
          return res.end(JSON.stringify({ error: { message: "quota exceeded" } }));
        }
        let parts;
        if (ultimo.functionResponse) {
          const r = ultimo.functionResponse.response.resultado;
          parts = [
            {
              text: `Comprar ${r.nombre}\nTe recomiendo comprar ${r.cantidad_recomendada} unidades por S/ ${r.costo_soles.toLocaleString("en-US")}.\n- Cobertura actual: ${r.cobertura_dias} días.`,
            },
          ];
        } else if (/caf[eé]/i.test(ultimo.text ?? "")) {
          parts = [{ functionCall: { name: "calcular_reposicion", args: { producto: "café" } } }];
        } else {
          parts = [{ text: "Aclaración\nSolo respondo sobre el inventario del catálogo." }];
        }
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            candidates: [{ content: { role: "model", parts }, finishReason: "STOP" }],
            usageMetadata: { promptTokenCount: 1000, candidatesTokenCount: 50 },
          }),
        );
      });
    });
    srv.listen(0, "127.0.0.1", () => resolve(srv));
  });
}

async function esperarListo(url, ms = 20000) {
  const fin = Date.now() + ms;
  while (Date.now() < fin) {
    try {
      const r = await fetch(`${url}/health/ready`);
      if (r.ok) return;
    } catch {
      /* aún arrancando */
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error("El servidor no respondió /health/ready");
}

before(async () => {
  if (omitir) return;
  db(["migrate"]);
  db(["seed"]);
  db(["user", USUARIOS.comprador.usuario, "comprador", "Comprador de prueba"], {
    USER_PASSWORD: USUARIOS.comprador.password,
  });
  db(["user", USUARIOS.lector.usuario, "lector", "Lector de prueba"], {
    USER_PASSWORD: USUARIOS.lector.password,
  });
  db(["user", USUARIOS.bloqueo.usuario, "lector", "Cuenta a bloquear"], {
    USER_PASSWORD: USUARIOS.bloqueo.password,
  });
  gemini = await iniciarGemini();
  const port = 3200 + Math.floor(Math.random() * 500);
  BASE = `http://127.0.0.1:${port}`;
  app = spawn(process.execPath, [".output/server/index.mjs"], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(port),
      HOST: "127.0.0.1",
      NODE_ENV: "production",
      GEMINI_API_KEY: "clave-de-prueba",
      GEMINI_MODEL: "modelo-simulado",
      GEMINI_FALLBACK_MODELS: "",
      GEMINI_BASE_URL: `http://127.0.0.1:${gemini.address().port}`,
      GROQ_API_KEY: "gsk_prueba_integracion",
      GROQ_BASE_URL: `http://127.0.0.1:${gemini.address().port}/openai/v1`,
    },
    stdio: "ignore",
  });
  await esperarListo(BASE);
});

after(() => {
  app?.kill();
  gemini?.close();
});

const jsonHeaders = () => ({ "Content-Type": "application/json", Origin: BASE });
async function login(u) {
  const r = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify(u),
  });
  const cookie = r.headers.get("set-cookie")?.split(";")[0];
  return { status: r.status, cookie, body: await r.json() };
}
const conCookie = (cookie, extra = {}) => ({ ...jsonHeaders(), Cookie: cookie, ...extra });

test("sin sesión: la API responde 401 y la página no envía datos", { skip: omitir }, async () => {
  for (const ruta of ["/api/decisions", "/api/agent-runs", "/api/token-usage"]) {
    assert.equal((await fetch(`${BASE}${ruta}`)).status, 401, ruta);
  }
  const html = await (await fetch(`${BASE}/`)).text();
  assert.match(html, /Ingresar/);
  assert.doesNotMatch(html, /SKU-1042/);
});

test("login: cookie HttpOnly, credenciales malas y CSRF", { skip: omitir }, async () => {
  const mala = await login({ usuario: USUARIOS.comprador.usuario, password: "incorrecta1" });
  assert.equal(mala.status, 401);
  const sinOrigen = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(USUARIOS.comprador),
  });
  assert.equal(sinOrigen.status, 403);
  const r = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify(USUARIOS.comprador),
  });
  assert.equal(r.status, 200);
  assert.match(r.headers.get("set-cookie"), /HttpOnly; SameSite=Lax/);
});

test(
  "Supervisor con LLM: delega en Reposición, los agentes colaboran y queda auditado",
  { skip: omitir },
  async () => {
    const { cookie } = await login(USUARIOS.comprador);
    const r = await fetch(`${BASE}/api/supervisor`, {
      method: "POST",
      headers: conCookie(cookie),
      body: JSON.stringify({ consulta: "¿Cuánto debería comprar de café?" }),
    });
    assert.equal(r.status, 200);
    const reply = await r.json();
    assert.equal(reply.traza.modo, "llm");
    assert.equal(reply.recomendacion.cantidad, 210);
    assert.deepEqual(reply.traza.verificacion.noEncontrados, []);
    assert.ok(reply.traza.mensajes.some((m) => m.de === "reposicion" && m.para === "predictor"));
    assert.ok(reply.traza.mensajes.some((m) => m.de === "predictor" && m.para === "ventas"));
    // La clave viaja en el encabezado.
    assert.equal(llamadasGemini.at(-1).key, "clave-de-prueba");
    assert.ok(!llamadasGemini.at(-1).url.includes("clave-de-prueba"));

    const runs = await (
      await fetch(`${BASE}/api/agent-runs`, { headers: conCookie(cookie) })
    ).json();
    const run = runs.find((x) => x.id === reply.runId);
    assert.ok(run, "la consulta quedó en agent_runs");
    assert.equal(run.usuario, USUARIOS.comprador.usuario);
    assert.ok(run.mensajes.length >= 10);
  },
);

test(
  "decisiones: el servidor fija usuario y fecha; el lector no puede aprobar",
  { skip: omitir },
  async () => {
    const comprador = await login(USUARIOS.comprador);
    const lector = await login(USUARIOS.lector);
    const decision = {
      id: randomUUID(),
      sku: "SKU-1042",
      nombre: "Café de Grano 500g",
      cantidadSugerida: 210,
      cantidadFinal: 210,
      costo: 3885,
      estado: "aprobado",
      motivo: "Integración",
      usuario: "Usuario falsificado",
      fecha: "2020-01-01T00:00:00Z",
    };
    const prohibido = await fetch(`${BASE}/api/decisions`, {
      method: "POST",
      headers: conCookie(lector.cookie),
      body: JSON.stringify(decision),
    });
    assert.equal(prohibido.status, 403);

    const ok = await fetch(`${BASE}/api/decisions`, {
      method: "POST",
      headers: conCookie(comprador.cookie),
      body: JSON.stringify(decision),
    });
    assert.equal(ok.status, 200);
    const guardada = (await ok.json()).decisions.find((d) => d.id === decision.id);
    assert.equal(guardada.registradoPor, USUARIOS.comprador.usuario);
    assert.match(guardada.usuario, /Comprador de prueba/);
    assert.notEqual(guardada.fecha.slice(0, 4), "2020");
    assert.equal(guardada.origen, "app");

    const evil = await fetch(`${BASE}/api/decisions`, {
      method: "POST",
      headers: conCookie(comprador.cookie, { Origin: "https://evil.example" }),
      body: JSON.stringify({ ...decision, id: randomUUID() }),
    });
    assert.equal(evil.status, 403);
  },
);

test(
  "importación: conserva el dato original pero queda marcada y sin duplicar",
  { skip: omitir },
  async () => {
    const { cookie } = await login(USUARIOS.comprador);
    const id = `legacy-${randomUUID()}`;
    const lote = [
      {
        id,
        sku: "SKU-2210",
        nombre: "Té Matcha Premium 200g",
        cantidadSugerida: 10,
        cantidadFinal: 10,
        costo: 240,
        estado: "aprobado",
        motivo: "Historial anterior",
        usuario: "Usuario histórico",
        fecha: "2026-09-01T12:00:00.000Z",
      },
    ];
    const enviar = () =>
      fetch(`${BASE}/api/decisions/import`, {
        method: "POST",
        headers: conCookie(cookie),
        body: JSON.stringify(lote),
      }).then((r) => r.json());
    const r1 = await enviar();
    assert.equal(r1.inserted, 1);
    const d = r1.decisions.find((x) => x.id === id);
    assert.equal(d.origen, "importado");
    assert.equal(d.usuario, "Usuario histórico");
    assert.equal(d.registradoPor, USUARIOS.comprador.usuario);
    assert.equal((await enviar()).inserted, 0);
  },
);

test("cerrar sesión invalida la cookie en el servidor", { skip: omitir }, async () => {
  const { cookie } = await login(USUARIOS.lector);
  assert.equal((await fetch(`${BASE}/api/auth/me`, { headers: { Cookie: cookie } })).status, 200);
  await fetch(`${BASE}/api/auth/logout`, { method: "POST", headers: conCookie(cookie) });
  assert.equal((await fetch(`${BASE}/api/auth/me`, { headers: { Cookie: cookie } })).status, 401);
});

test("bloqueo tras 5 intentos fallidos aunque se cambie la IP", { skip: omitir }, async () => {
  for (let i = 0; i < 5; i++) {
    await fetch(`${BASE}/api/auth/login`, {
      method: "POST",
      headers: { ...jsonHeaders(), "X-Forwarded-For": `10.9.0.${i}` },
      body: JSON.stringify({ usuario: USUARIOS.bloqueo.usuario, password: "incorrecta1" }),
    });
  }
  const r = await login(USUARIOS.bloqueo);
  assert.equal(r.status, 423);
});

// Va al final: deja a Gemini "en pausa por cuota" para el resto de este servidor de prueba.
test(
  "respaldo Gemini → Groq: cuota agotada en Gemini y responde Groq con los mismos agentes",
  { skip: omitir },
  async () => {
    const { cookie } = await login(USUARIOS.comprador);
    const r = await fetch(`${BASE}/api/supervisor`, {
      method: "POST",
      headers: conCookie(cookie),
      body: JSON.stringify({ consulta: "[sin cuota] ¿Cuánto debería comprar de café?" }),
    });
    const reply = await r.json();
    assert.equal(reply.traza.modo, "llm");
    assert.equal(reply.traza.proveedor, "groq");
    assert.match(reply.traza.modelo, /Groq \(respaldo: Cuota de Gemini agotada/);
    assert.equal(reply.recomendacion.cantidad, 210);
    assert.ok(reply.traza.mensajes.some((m) => m.de === "reposicion" && m.para === "predictor"));
    assert.equal(llamadasGroq.at(-1).auth, "Bearer gsk_prueba_integracion");
    const runs = await (
      await fetch(`${BASE}/api/agent-runs`, { headers: conCookie(cookie) })
    ).json();
    assert.match(runs.find((x) => x.id === reply.runId).modelo, /Groq/);
  },
);
