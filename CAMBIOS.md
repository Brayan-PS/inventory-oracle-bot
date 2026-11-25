# Cambios — versión 3 (noviembre 2026)

## v3.2 — Groq también cuando Gemini es lento
- Cada llamada a un proveedor tiene su propio límite (`LLM_PROVIDER_TIMEOUT_MS`, 20 s). Si Gemini no responde a tiempo, la consulta pasa a Groq con el tiempo que queda (antes la lentitud de Gemini consumía los 45 s de la consulta y respondía el motor de reglas sin probar Groq).
- `GEMINI_THINKING_LEVEL` (opcional, por ejemplo `low`) reduce la latencia de Gemini 3.
- 2 pruebas nuevas (Gemini lento → Groq; nivel de razonamiento).

## v3.1 — Groq como respaldo de Gemini
- `src/server/supervisor-llm.server.ts`: capa de proveedores. Gemini es el principal; si responde 429 (cuota), 400/401/403 (clave), 5xx (saturación) o hay error de red, **la misma consulta se repite con Groq** (`/openai/v1/chat/completions`, function calling) con los mismos agentes, memoria, límites y verificación de cifras.
- Groq usa `llama-3.3-70b-versatile` y, si ese modelo está limitado, `openai/gpt-oss-120b`.
- Tras agotar la cuota de Gemini, queda en pausa `GEMINI_PAUSA_CUOTA_MIN` minutos (15) y las consultas van directo a Groq.
- La traza y `agent_runs` indican el proveedor y el motivo del respaldo; costo estimado con el precio de cada proveedor.
- Variables nuevas: `GROQ_API_KEY` (única obligatoria para activar el respaldo), `GROQ_MODEL`, `GROQ_FALLBACK_MODELS`, `GROQ_PRICE_IN_PER_M`, `GROQ_PRICE_OUT_PER_M`, `GEMINI_PAUSA_CUOTA_MIN`.
- Pruebas: 6 unitarias y 1 de integración nuevas (Gemini 429 → Groq, pausa, clave inválida, modelo de respaldo de Groq, ambos caídos → reglas, argumentos mal formados).

Correcciones a partir de la evaluación con la rúbrica del curso. Cada punto indica el archivo y la prueba que lo comprueba.

## Arquitectura multiagente (sección E)
- **Los agentes colaboran por mensajes.** Bus de mensajes (`src/lib/agents.ts`): Reposición pide demanda y riesgo al Predictor y stock/cobertura al Gestor; el Predictor pide ventas al Analista; el Gestor pide demanda al Predictor y rotación al Analista. Cada solicitud y respuesta queda en la traza (`mensajes`) y en `agent_runs`. Prueba: `agentes: Reposición delega en Predictor y Gestor…`.
- **Cálculos separados por especialidad** (`src/lib/inventory.ts`: `pronosticarDemanda`, `calcularRiesgo`, `calcularRotacion`, `calcularCobertura`, `esSobrestock`, `calcularReposicion`). Los resultados por mensajes coinciden con el sistema en los 30 SKUs y en escenarios ±% (prueba dedicada).
- **Memoria:** de trabajo compartida por consulta (un dato no se pide dos veces) y de conversación (últimos 3 turnos se envían a Gemini).
- **Decisión propia del agente de Reposición** con su motivo (`decision_del_agente`).
- **Verificación de TODAS las cifras** (antes se ignoraban las menores que 10). Si hay cifras sin respaldo, el Supervisor pide una corrección a Gemini; si persisten, responde el motor de reglas.
- Nueva herramienta `buscar_producto` y rankings: más/menos vendidos, margen, rotación, lead time y filtro por categoría.
- Pantalla **Agentes IA**: mensajes entre agentes por consulta y conteo de colaboraciones (quién pidió qué a quién).

## Requerimientos funcionales (sección C)
- **Búsqueda de productos corregida** (`src/lib/catalogo.ts`): "pan" y "té" ya se encuentran; "te" (pronombre) no se confunde; plurales; varios productos ("arroz y azúcar"); ambigüedad ("jabón" → pregunta cuál).
- Motor de reglas de respaldo: ventas de un producto ("¿cuánto café vendí?"), stock, demanda, proveedor, margen y rankings; ya no responde el plan de compra a preguntas que no lo piden.

## Seguridad y auditoría (sección H)
- **Inicio de sesión** con usuarios en PostgreSQL (scrypt + sal), sesiones del lado del servidor (solo se guarda el hash del token), cookie HttpOnly/SameSite/Secure, cierre de sesión real.
- **Roles:** admin, comprador, lector. El lector no puede aprobar ni importar.
- **Bloqueo** tras 5 intentos fallidos (15 min) y registro de accesos (`auditoria_accesos`).
- **Auditoría no falsificable:** usuario y fecha de las decisiones los pone el servidor; lo importado queda marcado (`origen = importado`, `registrado_por`, `registrado_en`).
- **Privacidad:** cada usuario ve solo sus consultas (`agent_runs`); el admin ve todas.
- **Límites:** la IP ya no se toma del primer valor de `X-Forwarded-For` (falsificable); topes diarios contados en PostgreSQL (sobreviven a reinicios); límite por usuario; límite de escrituras.
- **Sin contraseñas en el código:** `scripts/local.mjs` genera claves aleatorias. TLS a la base verificando el certificado por defecto.
- Cabeceras de seguridad (X-Frame-Options, nosniff, HSTS en HTTPS, frame-ancestors).

## Datos honestos (secciones D y H)
- El historial simulado **cuadra exactamente** con ventas de 7 y 30 días (antes difería hasta 29 % en 12 productos).
- El backtest **estima** nivel, patrón semanal y tendencia con los datos de ajuste (no usa el campo `tendencia` que generó la serie).
- El gráfico del dashboard ya no inventa el pronóstico pasado ni el stock histórico: el pronóstico pasado usa solo datos previos a cada semana; el stock muestra el actual y su proyección sin reposición.
- Se eliminó el "historial de reposiciones" ficticio de la ficha del producto: ahora muestra las decisiones reales guardadas en PostgreSQL.
- Textos corregidos ("datos reales" → "datos de demostración"; el panel indica si respondió Gemini o el motor de reglas).

## Pruebas, calidad y operación (secciones G e I)
- 42 pruebas unitarias, 7 de integración (servidor compilado + PostgreSQL real + Gemini simulado por HTTP) y 9 de navegador (Playwright).
- `npm run lint` sin errores; GitHub Actions ejecuta lint, tipos, pruebas, build, integración y navegador con PostgreSQL 17.
- Respaldo JSON portable (`npm run db:respaldo` / `db:restaurar`) que funciona también en Render.
- `npm run db:user` para crear usuarios; usuario de demostración desde `DEMO_USER`/`DEMO_PASSWORD` (Render los pide en el Blueprint).
- `scripts/medir.mjs` inicia sesión antes de medir (`MEDIR_USUARIO`, `MEDIR_PASSWORD`).

## Migración
`migrations/003_usuarios_auditoria.sql` (nueva). Las migraciones 001 y 002 no cambian, así que una base existente se actualiza sola al arrancar.

## Qué actualizar en el cuestionario (Word)
- **A5/G2/G5/G7:** URL de Render, `/health/ready` en línea y medición con `scripts/medir.mjs` (adjuntar `resultados-medicion.md`).
- **A6/J2:** el repositorio con estos cambios y commits de ambos integrantes.
- **C3/C4/G6/H3:** hay login y roles; usuario de prueba `docente` (contraseña entregada aparte).
- **D1:** versiones reales de `package-lock.json` (TypeScript 5.9.3, React 19.3.1, Tailwind 4.3.3).
- **E1/E3/E4/E5/E6/E9/E10, F1–F5, H2/H4:** Gemini con function calling, bus de mensajes entre agentes, memoria, verificación con corrección, traza real tomada de la URL en línea (botón **Traza** → mensajes entre agentes).
- **I1/I2:** métricas del backtest (WAPE 13.6 % sobre historial simulado) y resultados de las pruebas automáticas.
- **K:** marcar las tres declaraciones.
