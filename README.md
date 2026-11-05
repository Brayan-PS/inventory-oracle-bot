# Intelli Stock Advisor

Quiero que construyas desde cero una aplicación web llamada “Intelli-Stock”, basada en el documento Word adjunto.

Debe ser un MVP visual y funcional de un sistema multiagente inteligente para gestión predictiva de inventarios, orientado al encargado de compras.

La idea principal es:

USUARIO CONSULTA → AGENTE SUPERVISOR INTERPRETA → AGENTES ESPECIALIZADOS ANALIZAN → IA CONSOLIDA → SISTEMA RECOMIENDA → HUMANO APRUEBA.

Usa exactamente la arquitectura planteada en el documento:

- Agente Supervisor

- Agente Analista de Ventas

- Agente Predictor de Demanda

- Agente Gestor de Inventario

- Agente de Reposición

El Supervisor debe ser el centro de la experiencia. El usuario debe poder escribir consultas en lenguaje natural como:

“¿Qué productos debo reponer esta semana?”

“¿Qué productos tienen riesgo crítico?”

“¿Cuánto debería comprar de café?”

“¿Por qué recomiendas esa cantidad?”

“¿Qué productos tienen sobrestock?”

“Muéstrame los productos con menor cobertura.”

El sistema debe simular visualmente cómo el Supervisor consulta a los demás agentes y mostrar estados como:

- Analizando ventas…

- Prediciendo demanda…

- Consultando inventario…

- Calculando reposición…

- Generando recomendación…

Después debe entregar resultados basados en los datos simulados del sistema, no respuestas genéricas.

## Diseño

Quiero una interfaz moderna tipo SaaS / Business Intelligence, limpia, profesional y empresarial.

Usar:

- sidebar lateral

- tarjetas KPI

- gráficos interactivos

- alertas

- rankings

- indicadores

- tablas solo cuando sean necesarias

- panel flotante o persistente del Supervisor IA

No hacer una web compuesta únicamente por tablas.

## Secciones principales

Crear estas páginas:

1. Centro de Inteligencia

2. Productos

3. Reposición

4. Predicción de Demanda

5. Inventario

6. Analítica

7. Agentes IA

8. Reportes

9. Historial de decisiones

## Dashboard principal

Mostrar KPIs como:

- Total SKUs

- Productos críticos

- Riesgo medio

- Productos saludables

- Productos con sobrestock

- Cobertura promedio

- Pedidos pendientes

- Valor del inventario

- Precisión del modelo predictivo

Añadir gráficos como:

- Demanda histórica vs demanda pronosticada vs stock

- Distribución de riesgo

- Top productos en riesgo

- Productos por rotación

- Ventas últimas semanas

- Demanda proyectada 7, 14 y 30 días

- Cobertura de inventario

- Capital inmovilizado

## Productos

Crear mínimo 25 productos simulados de distintas categorías.

Cada producto debe tener:

- SKU

- nombre

- categoría

- precio compra

- precio venta

- stock actual

- stock mínimo

- stock máximo

- ventas 7 días

- ventas 30 días

- demanda prevista

- cobertura

- lead time

- rotación

- riesgo

- proveedor

- cantidad recomendada de reposición

Agregar buscador, filtros y ordenamiento.

Al seleccionar un producto, mostrar una vista detallada con:

- KPIs

- historial de ventas

- forecast

- riesgo

- explicación de IA

- factores que influyeron en la recomendación

- historial de reposiciones

## Agentes IA

Crear una pantalla muy visual llamada “Centro de Agentes IA”.

Mostrar al Agente Supervisor conectado con los demás agentes.

Cada agente debe mostrar:

- estado

- responsabilidad

- última ejecución

- tareas realizadas

- resultado resumido

También debe existir un registro de actividad, por ejemplo:

19:42 Supervisor recibió consulta

19:42 Analista revisando ventas

19:42 Predictor ejecutando forecasting

19:43 Gestor consultando inventario

19:43 Reposición calculando pedido

19:43 Supervisor generó respuesta

## Predicción

Crear una sección específica de Machine Learning.

Mostrar:

- histórico vs predicción

- horizonte 7 / 14 / 30 días

- MAE

- RMSE

- WAPE

- precisión estimada

- variables utilizadas

Usar los conceptos definidos en el documento adjunto.

## Reposición

La IA debe recomendar:

- qué producto comprar

- cuánto comprar

- cuándo comprar

- prioridad

- riesgo

- costo estimado

- explicación

Permitir:

- aprobar

- modificar cantidad

- posponer

- descartar

IMPORTANTE:

Toda compra debe requerir aprobación humana. No ejecutar compras automáticamente.

## Simulador

Agregar una sección “¿Qué pasaría si...?”

Ejemplos:

“¿Qué pasa si no repongo café?”

Mostrar:

- días hasta quiebre

- unidades potencialmente perdidas

- ventas potenciales perdidas

- probabilidad de quiebre

“¿Qué pasa si compro 100 unidades?”

Mostrar:

- nueva cobertura

- riesgo de sobrestock

- capital invertido

## Datos

Los datos pueden ser simulados, pero deben ser coherentes entre sí.

Si un producto tiene poco stock y alta demanda, debe tener riesgo alto.

Si tiene mucho stock y poca demanda, debe marcarse posible sobrestock.

Las respuestas del Supervisor deben utilizar realmente esos datos.

## Importante

Usa el Word adjunto como fuente principal para la lógica, arquitectura multiagente, funciones de los agentes, flujo de interacción y motor predictivo.

Quiero que el resultado parezca un MVP avanzado y presentable en una exposición universitaria.

El usuario debe sentir que tiene un analista inteligente de inventarios que le dice:

QUÉ comprar,

CUÁNTO comprar,

CUÁNDO comprar

y POR QUÉ.

This project was built with [Lovable](https://lovable.dev).

**Live app**: https://inventory-oracle-bot.lovable.app

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/a84afde5-32ed-4eef-a828-0fd6dbce9bbe).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

### Docker local (aplicación + PostgreSQL)

Requiere Docker Desktop iniciado con contenedores Linux. En PowerShell, desde la
raíz del repositorio:

```powershell
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
# Edita .env y reemplaza POSTGRES_PASSWORD por tu contraseña local.
docker compose up --build -d
docker compose ps
```

Abre http://localhost:3000. Si el puerto está ocupado, cambia APP_PORT en .env
(por ejemplo, 3001) y ejecuta de nuevo `docker compose up -d`.
Si ya existe un .env, consérvalo en lugar de sobrescribirlo con la plantilla.

La imagen usa Node 24.16.0 y compila Nitro con `NITRO_PRESET=node_server`.
El objetivo de compilación de Lovable conserva su configuración. Docker utiliza
`package-lock.json` mediante `npm ci`; no necesita Node o PostgreSQL instalados
directamente en Windows. El primer build necesita internet para descargar
imágenes y dependencias.

La aplicación lee productos y guarda decisiones en PostgreSQL. El servicio
transitorio `migrate` aplica las migraciones SQL y carga los 30 productos originales
solo si el catálogo está vacío; app espera a que termine. No sobrescribe productos
existentes ni borra decisiones. Los cálculos, simulaciones y estados se conservan;
chat y actividad siguen en memoria. `/health/ready` comprueba acceso a las tablas.

El sistema continúa siendo una demostración local sin autenticación. Para ejecutar
esta versión fuera de Compose, incluido Lovable, el servidor necesita acceso a una
base PostgreSQL con el esquema inicializado. No hay respaldo localStorage como
fuente alternativa silenciosa cuando falla la base.

Migraciones y semilla se pueden repetir mediante:

```powershell
docker compose run --rm migrate
```

Los SQL aplicados se registran con checksum en `schema_migrations`. Agrega otra
migración para cambios futuros; no edites un SQL ya aplicado. La semilla de
`seeds/products.json` se omite si ya existen productos. Docker usa PGHOST=db y
PGPORT=5432; las variables POSTGRES_* de .env inicializan la base y PG* conectan
el servidor. Ninguna credencial se envía al navegador.

### Conservar decisiones del navegador anterior

En Historial se puede importar el historial de este navegador o un archivo JSON;
también descargar una copia si se detecta historial local. La importación preserva
id, fecha y usuario originales, no duplica identificadores y no borra localStorage.
Un lote con SKU desconocido o datos inválidos se rechaza sin importación parcial.

Si las decisiones estaban en otro origen (por ejemplo localhost:5173 o Lovable),
expórtalas allí antes de cambiar de versión. Desde la consola del navegador en ese
origen, puedes obtener el JSON para guardarlo en un archivo:

```javascript
localStorage.getItem("intelli-stock:decisions")
```

Si DevTools muestra una cadena con comillas/escapes, usa la opción de copiar el
valor de la cadena para obtener el array JSON, sin comillas externas. Importa el
archivo desde Historial en localhost:3000. Conserva el original como respaldo.

Comandos útiles:

```powershell
docker compose logs --tail 100 app db
docker compose stop
docker compose start
docker compose down
```

`down` conserva los datos de PostgreSQL en el volumen `postgres_data` del
proyecto. **`down -v` elimina ese volumen y sus datos.** No lo uses para detener
normalmente el sistema. Cambiar POSTGRES_PASSWORD en .env no cambia la contraseña
de una base ya inicializada; requiere actualizar el rol dentro de PostgreSQL.

PostgreSQL publica `127.0.0.1:5433` en Windows (configurable con DB_PORT).
En pgAdmin instalado en este equipo, usa host `127.0.0.1`, puerto `5433`, base y
usuario `intelli_stock` y la contraseña POSTGRES_PASSWORD de .env. Si cambiaste
POSTGRES_DB o POSTGRES_USER, usa esos valores. Para acceder desde su contenedor:

```powershell
docker compose exec db psql -U intelli_stock -d intelli_stock
```

Respaldo y restauración de comprobación en otra base (no sobrescribe la principal):

```powershell
New-Item -ItemType Directory -Force backups | Out-Null
docker compose exec db pg_dump -U intelli_stock -d intelli_stock -Fc -f /tmp/intelli-stock.dump
docker compose cp db:/tmp/intelli-stock.dump ./backups/intelli-stock.dump
docker compose exec db createdb -U intelli_stock intelli_stock_restore_check
docker compose exec db pg_restore -U intelli_stock -d intelli_stock_restore_check --exit-on-error /tmp/intelli-stock.dump
```

El ejemplo guarda el dump dentro del contenedor antes de copiarlo para evitar
alterar archivos binarios por redirección en Windows PowerShell. Usa nombres
fechados para conservar varios respaldos. La base de comprobación debe ser nueva.
Estos comandos usan el usuario/base de la plantilla; reemplaza `intelli_stock`
si configuraste otros nombres en .env.

### Desarrollo de la aplicación con Node local

Requiere Node 24.16.0, npm y .env configurado. La base puede seguir en Docker,
publicada solo en loopback, puerto 5433:

```powershell
npm.cmd ci
docker compose up -d db
docker compose run --rm migrate
npm.cmd run dev
```

El comando dev lee .env; el servidor local usa POSTGRES_* y 127.0.0.1:5433 por
defecto. Si usas otra base, establece PGHOST, PGPORT, PGDATABASE, PGUSER y PGPASSWORD
en el entorno del servidor. No copies esas variables a VITE_*.

### Verificaciones

```powershell
npm.cmd test
npm.cmd run typecheck
npm.cmd run build
```

Las pruebas de navegador usan otro proyecto Compose y volumen, en puerto 3001.
No las dirijas al entorno principal: eliminan decisiones únicamente del proyecto
de pruebas `inventory-oracle-bot-test`.

```powershell
$env:APP_PORT = "3001"
$env:DB_PORT = "5434"
docker compose -p inventory-oracle-bot-test up --build -d --wait
Remove-Item Env:APP_PORT
Remove-Item Env:DB_PORT
npm.cmd exec playwright -- install chromium
npm.cmd run test:e2e
docker compose -p inventory-oracle-bot-test down
```

El volumen de pruebas queda conservado; está separado del volumen principal.
La compilación fuera de Docker usa el destino Lovable predeterminado; Docker
selecciona Node con NITRO_PRESET. Los errores de formato del código de plantilla
ajeno a esta integración no se corrigen mediante un reformateo global.
