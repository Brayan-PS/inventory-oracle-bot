# Sistema de Inventario Oracle — Intelli Stock Advisor

MVP académico de gestión inteligente de inventarios. El sistema reúne información de ventas e inventario para presentar alertas, estimaciones de demanda y recomendaciones de reposición que requieren aprobación humana.

> **Importante:** demostración académica con **30 productos simulados**. El Supervisor usa un LLM real (Google Gemini con *function calling*); las compras nunca se ejecutan sin aprobación humana y no hay autenticación de usuarios.

**En línea:** `https://<tu-servicio>.onrender.com` (ver «Despliegue en Render»).

## Arquitectura funcional

La experiencia está organizada alrededor de un Agente Supervisor que coordina cinco funciones especializadas:

1. **Agente Supervisor:** recibe la consulta, organiza el análisis y presenta una respuesta consolidada.
2. **Agente Analista de Ventas:** analiza el comportamiento histórico de ventas.
3. **Agente Predictor de Demanda:** estima la demanda para apoyar la planificación.
4. **Agente Gestor de Inventario:** revisa existencias, cobertura y niveles de stock.
5. **Agente de Reposición:** calcula propuestas de compra y sus prioridades.

Flujo real:

`Consulta → Supervisor (Gemini) decide qué agentes llamar → herramientas de cada agente (solo lectura, datos de PostgreSQL) → Gemini redacta con esos resultados → verificación de cifras → aprobación humana`

- Código: `src/server/supervisor-llm.server.ts` (Supervisor LLM), `src/lib/agents.ts` (5 herramientas de 4 agentes), `src/lib/supervisor.ts` (motor de reglas de respaldo).
- Controles: máximo 6 llamadas a agentes, 45 s de tiempo máximo, 8192 tokens de salida, 1 reintento y modelos de respaldo ante saturación (503/429), 10 consultas/minuto por IP y 300 por día. Si el LLM falla o no hay clave, responde el motor de reglas y la traza indica el motivo.
- Uso de tokens: pantalla **Uso de tokens** con tabla por consulta, gráficas y tope diario (`LLM_DAILY_TOKEN_CAP`).
- Auditoría: cada consulta se guarda en la tabla `agent_runs` (consulta, agentes, argumentos, resultados, tokens, costo y tiempo) y se ve en la pantalla **Agentes IA**.
- El pronóstico es un promedio ponderado 7/30 días + tendencia; sus métricas salen de un backtest sobre el historial simulado (pantalla Predicción).

Las recomendaciones son de apoyo a la decisión. La aprobación final corresponde siempre a una persona.

## Tecnologías principales

- Google Gemini API (LLM del Supervisor, *function calling*)
- React y TypeScript
- TanStack Start / TanStack Router
- Vite
- PostgreSQL
- Docker y Docker Compose
- Node.js

Las versiones exactas de dependencias se encuentran en `package.json` y `package-lock.json`.

## Requisitos

Para ejecutar la aplicación con Docker:

- Docker Desktop instalado y en ejecución.
- Docker Compose disponible desde la terminal.
- Conexión a internet durante la primera construcción para descargar imágenes y dependencias.

No necesitas instalar Node.js ni PostgreSQL directamente en Windows si utilizas Docker Compose.

## Instalación en Windows (PowerShell)

1. Descarga o clona el repositorio y abre PowerShell en la carpeta raíz del proyecto.
2. Crea tu archivo local de configuración a partir de la plantilla:

   ```powershell
   Copy-Item .env.example .env
   ```

3. Abre `.env` y completa localmente las variables necesarias. En particular, define una contraseña propia para `POSTGRES_PASSWORD`. No compartas ese archivo ni lo subas a GitHub.
4. Construye e inicia los servicios:

   ```powershell
   docker compose up --build -d
   ```

5. Comprueba que los contenedores estén activos:

   ```powershell
   docker compose ps
   ```

6. Abre la aplicación en el navegador:

   `http://localhost:3000`

La aplicación espera a que PostgreSQL esté disponible y ejecuta el servicio de migraciones y carga inicial antes de iniciar. Si el puerto predeterminado está ocupado, configura `APP_PORT` en tu archivo `.env` local.

## Variables de entorno

El proyecto utiliza configuración externa para no escribir credenciales dentro del código.

Variables principales:

- `APP_PORT`
- `DB_PORT`
- `POSTGRES_DB`
- `POSTGRES_USER`
- `POSTGRES_PASSWORD`

Supervisor con LLM:

- `GEMINI_API_KEY` (clave propia del equipo, creada en Google AI Studio)
- `GEMINI_MODEL` (por defecto `gemini-3.8-flash`) y `GEMINI_FALLBACK_MODELS` (modelos de respaldo si el principal está saturado)
- `LLM_MAX_TOOL_CALLS`, `LLM_TIMEOUT_MS`, `LLM_MAX_OUTPUT_TOKENS`, `LLM_RATE_PER_MIN`, `LLM_DAILY_CAP` (límites)

En la nube: `DATABASE_URL` (la crea Render a partir de la base de datos).

Variables opcionales para la conexión directa del servidor a PostgreSQL:

- `PGHOST`
- `PGPORT`
- `PGDATABASE`
- `PGUSER`
- `PGPASSWORD`

La plantilla `.env.example` contiene únicamente los nombres de las variables. Cada persona debe crear su propio `.env` local y completar allí los valores que correspondan. **No publiques contraseñas, claves API ni tokens en el repositorio, en cuestionarios, capturas o documentos de entrega.** Si una integración requiere una clave, documenta únicamente el nombre de la variable de entorno que la contiene.

## Ejecutar localmente SIN Docker (recomendado para probar)

No necesitas Docker ni instalar PostgreSQL: `npm ci` descarga un PostgreSQL 17 embebido.

```powershell
npm.cmd ci
npm.cmd run local          # modo desarrollo → http://127.0.0.1:8080
npm.cmd run local:prod     # igual que en la nube → http://localhost:3000
npm.cmd run local:reset    # borra la base local (.pgdata) para empezar de cero
```

Para usar Gemini en local, crea un archivo `.env` con `GEMINI_API_KEY=tu_clave` (y opcionalmente `GEMINI_MODEL=gemini-3.8-flash`). Sin clave, el Supervisor responde con el motor de reglas. `Ctrl + C` detiene la app y la base.

## Despliegue en Render (en línea con PostgreSQL)

1. Crea una clave en Google AI Studio (aistudio.google.com → *Get API key*).
2. En Render: **New → Blueprint**, conecta este repositorio y acepta `render.yaml` (crea el servicio web Docker `intelli-stock` y la base `intelli-stock-db`).
3. Cuando Render lo pida, pega la clave en `GEMINI_API_KEY`.
4. Espera el despliegue. Al arrancar se aplican las migraciones y la semilla automáticamente.
5. Comprueba `https://<tu-servicio>.onrender.com/health/ready` → `{"status":"ready"}`.
6. Haz una consulta en el panel del Supervisor y abre **Traza**: debe decir **LLM**. Si dice «Reglas (respaldo)», el motivo aparece ahí (por ejemplo, un nombre de modelo que cambió: ajusta `GEMINI_MODEL`).

El plan gratuito de Render suspende el servicio tras un rato sin uso; la primera visita puede tardar cerca de un minuto en despertar.

## Medición en línea

```powershell
node scripts/medir.mjs https://<tu-servicio>.onrender.com
```

Ejecuta 12 casos de prueba contra la URL pública (incluye consulta fuera de tema, producto inexistente, escenario +20 % e intento de inyección), mide la carga de la página con 10 usuarios simultáneos y genera `resultados-medicion.md` y `.json`.

## Respaldo de la base de datos

```powershell
npm.cmd run db:backup
```

Crea `backups/intelli_stock_<fecha>.sql` con `pg_dump` (carpeta excluida de Git). Para restaurar:
`docker compose exec -T db psql -U <usuario> -d <base> < backups/<archivo>.sql`

## Comandos útiles

Ver los registros de la aplicación y la base de datos:

```powershell
docker compose logs --tail 100 app db
```

Detener los servicios sin eliminar los datos:

```powershell
docker compose stop
```

Volver a iniciarlos:

```powershell
docker compose start
```

Detener y retirar los contenedores:

```powershell
docker compose down
```

`docker compose down` conserva el volumen de PostgreSQL. Evita `docker compose down -v` si necesitas conservar los datos, porque elimina el volumen asociado.

## Ejecución para desarrollo (opcional)

Si deseas ejecutar el servidor de desarrollo fuera de Docker, necesitas Node.js 24.16.0, npm y un archivo `.env` local correctamente configurado. Puedes mantener PostgreSQL dentro de Docker:

```powershell
npm.cmd ci
docker compose up -d db
docker compose run --rm migrate
npm.cmd run dev
```

## Pruebas y validaciones

Con las dependencias instaladas y la base configurada, puedes ejecutar:

```powershell
npm.cmd test
npm.cmd run typecheck
npm.cmd run build
```

Para las pruebas de extremo a extremo:

```powershell
npm.cmd run test:e2e
```

## Seguridad y archivos excluidos

Los siguientes elementos no deben publicarse:

- `.env` y cualquier archivo `.env.*` con configuración local.
- `node_modules/`, porque las dependencias se instalan mediante `npm ci`.
- `backups/`, porque puede contener volcados de bases de datos.
- Archivos locales, resultados de pruebas y reportes generados.

El repositorio conserva `.gitignore` para excluir estos elementos. Antes de cada publicación, revisa los archivos preparados para confirmar que no se hayan añadido credenciales ni datos privados.

Si alguna contraseña, clave API o token llegó a publicarse por error, eliminar el archivo en un commit posterior no basta: debes revocar o rotar el secreto afectado.

## Alcance de la demostración

- La aplicación requiere acceso a PostgreSQL para las funciones que dependen de persistencia.
- Los datos iniciales se cargan mediante el proceso de migración/semilla del proyecto.
- Esta versión no incorpora autenticación; la instancia pública solo contiene datos simulados. No la uses con datos reales.
- Las recomendaciones de reposición no ejecutan compras automáticamente.

## Autoría y uso académico

Proyecto desarrollado como MVP académico para demostrar un enfoque de análisis y apoyo a la toma de decisiones en la gestión de inventarios.
