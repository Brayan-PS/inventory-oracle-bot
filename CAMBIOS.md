# Cambios — versión final (noviembre 2026)

## Supervisor con LLM real
- `src/server/supervisor-llm.server.ts`: Supervisor con Google Gemini y *function calling*. Gemini decide qué agentes llamar; la respuesta solo puede usar cifras devueltas por los agentes y se verifica automáticamente.
- `src/lib/agents.ts`: los 4 agentes exponen 5 herramientas de solo lectura (`consultar_ventas`, `predecir_demanda`, `calcular_riesgo_stock`, `consultar_inventario`, `calcular_reposicion`), con escenarios de demanda (`ajuste_demanda_pct`) y manejo de productos inexistentes.
- Límites: 6 llamadas a agentes, 45 s, 8192 tokens de salida, 10 consultas/min por IP, 300/día. Reintento y modelos de respaldo (gemini-3.5-flash, gemini-3.1-flash-lite) si el principal está saturado. Si algo falla, responde el motor de reglas y la traza explica el motivo.
- `POST /api/supervisor` (con verificación de Origin y validación zod) y `GET /api/agent-runs`.

## Auditoría y trazabilidad
- Migración `002_agent_runs.sql`: cada consulta queda registrada con agentes, argumentos, resultados, tokens, costo y tiempo.
- Panel del Supervisor: botón **Traza** con modelo, llamadas, tokens, costo y verificación de cifras.
- Pantalla Agentes IA: registro real desde PostgreSQL (se eliminó el registro de ejemplo y los contadores fijos).

## Pantalla «Uso de tokens» (/tokens)
- Tabla por consulta: fecha y hora, qué se pidió, agentes y herramientas usadas, modelo, modo (LLM/reglas), tokens de entrada/salida/total, costo estimado y tiempo.
- Gráficas: consumo acumulado del día vs tope con proyección al ritmo actual, tokens por hora y últimos 7 días.
- Tope diario de tokens real (LLM_DAILY_TOKEN_CAP, por defecto 1 000 000): al alcanzarlo responde el motor de reglas hasta medianoche (APP_TZ). Endpoint GET /api/token-usage.

## Honestidad de la interfaz
- Se quitaron las etiquetas «LightGBM v2.4» y las métricas fijas (94.2 %, MAE 3.1, etc.). Las métricas ahora salen de un backtest real (42 días de ajuste / 14 de prueba) sobre el historial simulado.
- Aviso permanente de «Datos de demostración».

## Motor de reglas (respaldo)
- Pide aclaración ante consultas fuera de tema, rechaza pedidos de aprobar compras, responde riesgo por producto, escenarios «¿qué pasa si la demanda sube X %?» y productos inexistentes.

## Despliegue y operación
- `render.yaml` + `Dockerfile.render`: servicio web Docker + PostgreSQL gestionado en Render; migraciones y semilla al arrancar.
- Soporte de `DATABASE_URL`; verificación de Origin compatible con proxies HTTPS.
- `npm run db:backup` (pg_dump) y `node scripts/medir.mjs <url>` (12 casos de prueba en línea + tiempos con 10 usuarios simultáneos).

## Pruebas
- `tests/supervisor.test.mjs`: 15 pruebas nuevas (reglas, agentes, LLM con API simulada: delegación, verificación de cifras, sin clave, error HTTP, límite de llamadas y tiempo máximo).
