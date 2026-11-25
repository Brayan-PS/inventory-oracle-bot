# Intelli-Stock — Sistema multiagente de reposición de inventarios

MVP académico (Tecnologías Emergentes, Grupo 10). Un **Agente Supervisor con LLM** (Google Gemini; **Groq** de respaldo automático) recibe preguntas en lenguaje natural y delega en **cuatro agentes especializados que colaboran entre sí** para decidir qué, cuánto y cuándo reponer. Toda compra requiere aprobación humana.

> **Datos de demostración:** 30 productos simulados. El historial de ventas es simulado pero coherente (sus últimos 7 y 30 días suman exactamente las ventas registradas).

**En línea:** `https://<tu-servicio>.onrender.com` (ver «Despliegue en Render»). · **Usuario para el docente:** `docente` (la contraseña se entrega aparte; nunca se guarda en el repositorio).

![CI](../../actions/workflows/ci.yml/badge.svg)

## Arquitectura multiagente

```
Usuario ─► Supervisor (Gemini → Groq, function calling) ──► herramientas de los agentes
                │                                         │
                │        ┌────────────── bus de mensajes entre agentes ───────────────┐
                │        │  Reposición ─► Predictor ─► Analista de Ventas              │
                │        │      │             └──────► Gestor de Inventario            │
                │        │      └──► Gestor de Inventario ─► Analista de Ventas        │
                │        └─────────────────────────────────────────────────────────────┘
                ▼
   verificación de TODAS las cifras ─► (1 corrección) ─► respuesta ─► aprobación humana
```

| Agente | Responsabilidad | Pide datos a |
|---|---|---|
| **Supervisor** | Interpreta la consulta con Gemini, decide a quién delegar, verifica cifras y consolida | Todos (por herramientas) |
| **Analista de Ventas** | Ventas 7/30 días, rotación, tendencia, margen, rankings | Gestor (stock para la rotación) |
| **Predictor de Demanda** | Demanda 7/14/30 días y riesgo de quiebre | Analista (ventas), Gestor (cobertura) |
| **Gestor de Inventario** | Stock, mínimos/máximos, proveedor, cobertura, sobrestock, búsqueda de productos | Predictor (demanda), Analista (rotación) |
| **Reposición** | Cantidad, costo, momento y prioridad de compra; decide y explica su decisión | Predictor (demanda y riesgo), Gestor (stock y cobertura) |

- **Comunicación:** mensajes estructurados (`de`, `para`, `tipo`, `asunto`, `contenido`) en un bus (`src/lib/agents.ts`). Cada solicitud y respuesta queda en la traza.
- **Memoria:** memoria de trabajo compartida por consulta (un dato pedido dos veces se responde de memoria) y memoria de conversación (los últimos 3 turnos se envían a Gemini).
- **Proveedores:** Gemini es el principal. Si responde con cuota agotada (429), clave inválida, saturación, error de red o **no responde en 20 s**, la misma consulta se repite con **Groq** (`llama-3.3-70b-versatile`, respaldo `openai/gpt-oss-120b`) con los mismos agentes y controles. Tras agotar la cuota, Gemini queda en pausa 15 min para no demorar cada consulta. Si los dos fallan, responde el motor de reglas. La traza indica qué proveedor respondió y por qué.
- **Control:** máx. 6 llamadas a agentes, 45 s, 8192 tokens, reintento y modelos de respaldo; verificación de **todas** las cifras de la respuesta contra los datos de los agentes, con una ronda de corrección; si persisten cifras sin respaldo, responde el motor de reglas.
- **Auditoría:** cada consulta se guarda en `agent_runs` (usuario, agentes, argumentos, mensajes entre agentes, verificación, tokens, costo y tiempo) y se ve en **Agentes IA** y **Uso de tokens**.

Código: `src/server/supervisor-llm.server.ts` (Supervisor), `src/lib/agents.ts` (agentes y bus), `src/lib/inventory.ts` (cálculos por especialidad), `src/lib/catalogo.ts` (búsqueda de productos), `src/lib/supervisor.ts` (motor de reglas de respaldo).

## Seguridad

- **Inicio de sesión** con usuarios en PostgreSQL; contraseñas con **scrypt** y sal; sesiones del lado del servidor (la base guarda solo el hash SHA-256 del token); cookie `HttpOnly`, `SameSite=Lax` y `Secure` en HTTPS.
- **Roles:** `admin` (todo, ve toda la auditoría), `comprador` (consulta y aprueba), `lector` (consulta, no aprueba).
- **Bloqueo** de la cuenta 15 min tras 5 intentos fallidos; límite de intentos por IP; registro de accesos en `auditoria_accesos`.
- **Auditoría no falsificable:** el usuario y la fecha de cada decisión los pone el servidor; lo importado queda marcado como `importado` con quién y cuándo lo importó.
- **CSRF:** verificación de `Origin` en todas las escrituras. **Validación** con zod y consultas parametrizadas.
- **Límites de costo** por usuario y por día contados en PostgreSQL (sobreviven a reinicios); IP tomada solo de los valores de `X-Forwarded-For` que agrega el proxy propio.
- **Cabeceras:** `X-Frame-Options`, `nosniff`, `Referrer-Policy`, `HSTS` en HTTPS, `frame-ancestors 'none'`.
- Ninguna herramienta de los agentes escribe datos ni ejecuta compras.

## Ejecutar localmente SIN Docker (recomendado para probar)

`npm ci` descarga un PostgreSQL 17 embebido.

```powershell
npm.cmd ci
npm.cmd run local          # desarrollo → la URL aparece en la consola
npm.cmd run local:prod     # igual que en la nube → http://localhost:3000
npm.cmd run local:reset    # borra la base local (.pgdata) para empezar de cero
```

La primera vez se crea el usuario **demo** (admin) con una contraseña aleatoria que se muestra en la consola y se guarda en `.pgdata/credenciales-demo.txt`. La contraseña de la base local también es aleatoria (`.pgdata/.clave-db`). Para usar Gemini, crea `.env` con `GEMINI_API_KEY=tu_clave`.

> Si ya tenías una carpeta `.pgdata` de la versión anterior, define una vez `LOCAL_DB_PASSWORD` en `.env` con la contraseña que usaba esa versión, o ejecuta `npm.cmd run local:reset`.

## Ejecutar con Docker Compose

1. `Copy-Item .env.example .env` y completa `POSTGRES_PASSWORD`, `DEMO_USER` y `DEMO_PASSWORD` (10+ caracteres con letras y números).
2. `docker compose up --build -d`
3. Abre `http://localhost:3000` e inicia sesión con el usuario de demostración.

## Usuarios

```powershell
# La contraseña se pasa por variable de entorno, nunca por la línea de comandos.
$env:USER_PASSWORD = "Clave-Segura-2026"; npm.cmd run db:user -- ana comprador "Ana Pérez"
```

Roles válidos: `admin`, `comprador`, `lector`. Cambiar la contraseña cierra las sesiones abiertas de ese usuario.

## Despliegue en Render (en línea con PostgreSQL)

1. Crea una clave en Google AI Studio (aistudio.google.com → *Get API key*).
2. En Render: **New → Blueprint**, conecta este repositorio y acepta `render.yaml` (servicio web Docker `intelli-stock` + base `intelli-stock-db`).
3. Render pedirá `GEMINI_API_KEY`, `GROQ_API_KEY` (respaldo, opcional) y `DEMO_PASSWORD` (contraseña del usuario `docente`).
4. Al arrancar se aplican las migraciones, la semilla y el usuario de demostración.
5. Comprueba `https://<tu-servicio>.onrender.com/health/ready` → `{"status":"ready"}`.
6. Inicia sesión, haz una consulta en el panel del Supervisor y abre **Traza**: debe decir **LLM** y mostrar los mensajes entre agentes.

El plan gratuito de Render suspende el servicio tras un rato sin uso; la primera visita puede tardar cerca de un minuto.

## Variables de entorno

Ver `.env.example` (solo nombres y valores no secretos). Principales: `POSTGRES_*` / `PG*` / `DATABASE_URL` (base de datos), `GEMINI_API_KEY`, `GEMINI_MODEL`, `GEMINI_FALLBACK_MODELS` (LLM principal), `GROQ_API_KEY`, `GROQ_MODEL`, `GROQ_FALLBACK_MODELS` (LLM de respaldo), `LLM_*` (límites), `DEMO_USER`, `DEMO_PASSWORD`, `DEMO_NOMBRE`, `DEMO_ROL` (usuario de demostración), `SESSION_HOURS`, `TRUSTED_PROXY_HOPS`, `DATABASE_SSL`.

**No publiques contraseñas, claves API ni tokens** en el repositorio, cuestionarios, capturas o documentos. Si alguno se publicó por error, revócalo o cámbialo.

## Pruebas

```powershell
npm.cmd test                 # 50 pruebas unitarias (cálculos, búsqueda, agentes, Supervisor con Gemini y Groq simulados, seguridad)
npm.cmd run typecheck
npm.cmd run lint
npm.cmd run build
npm.cmd run test:integration # servidor compilado + PostgreSQL real + Gemini y Groq simulados por HTTP (8 pruebas)
npm.cmd run test:e2e         # navegador real con Playwright (9 pruebas); usa una base de PRUEBA y E2E_ALLOW_DB_RESET=1
```

GitHub Actions (`.github/workflows/ci.yml`) ejecuta todo lo anterior con PostgreSQL 17 en cada push.

## Medición en línea

```powershell
$env:MEDIR_USUARIO = "docente"; $env:MEDIR_PASSWORD = "<contraseña>"
node scripts/medir.mjs https://<tu-servicio>.onrender.com
```

## Respaldo de la base de datos

```powershell
npm.cmd run db:respaldo                       # JSON en backups/ (funciona en Docker, Render y local)
npm.cmd run db:restaurar -- backups/<archivo>.json
npm.cmd run db:backup                         # pg_dump dentro del contenedor de Docker Compose
```

El respaldo JSON no incluye contraseñas ni sesiones. La carpeta `backups/` está excluida de Git.

## Comandos útiles (Docker)

```powershell
docker compose logs --tail 100 app db
docker compose stop      # detener sin borrar datos
docker compose start
docker compose down      # conserva el volumen; evita "down -v" si quieres conservar los datos
```

## Alcance de la demostración

- Catálogo simulado de 30 productos; las métricas del pronóstico salen de un backtest sobre ese historial simulado.
- Las recomendaciones nunca ejecutan compras: la aprobación es siempre humana.
- No usar con datos reales sin una revisión de seguridad adicional.
