-- Usuarios con rol, sesiones del lado del servidor y auditoría que el cliente no puede falsificar.

CREATE TABLE usuarios (
  usuario text PRIMARY KEY CHECK (usuario ~ '^[a-z0-9._-]{3,40}$'),
  nombre text NOT NULL CHECK (length(nombre) BETWEEN 1 AND 120),
  rol text NOT NULL CHECK (rol IN ('admin', 'comprador', 'lector')),
  password_hash text NOT NULL,
  activo boolean NOT NULL DEFAULT true,
  intentos_fallidos integer NOT NULL DEFAULT 0,
  bloqueado_hasta timestamptz,
  creado_en timestamptz NOT NULL DEFAULT now()
);

-- Solo se guarda el hash SHA-256 del token de sesión: un volcado de la base no permite usar sesiones.
CREATE TABLE sesiones (
  token_hash text PRIMARY KEY,
  usuario text NOT NULL REFERENCES usuarios(usuario) ON DELETE CASCADE,
  creada_en timestamptz NOT NULL DEFAULT now(),
  expira_en timestamptz NOT NULL
);
CREATE INDEX sesiones_usuario_idx ON sesiones (usuario);
CREATE INDEX sesiones_expira_idx ON sesiones (expira_en);

-- Registro de accesos (inicio de sesión correcto/fallido, cierre, bloqueo).
CREATE TABLE auditoria_accesos (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  creado_en timestamptz NOT NULL DEFAULT now(),
  usuario text NOT NULL,
  evento text NOT NULL CHECK (evento IN ('login_ok', 'login_fallido', 'logout', 'bloqueo')),
  ip text
);
CREATE INDEX auditoria_accesos_fecha_idx ON auditoria_accesos (creado_en DESC);

-- Decisiones: quién las registró y cuándo lo pone el servidor, no el cliente.
ALTER TABLE decisions
  ADD COLUMN origen text NOT NULL DEFAULT 'app' CHECK (origen IN ('app', 'importado')),
  ADD COLUMN registrado_por text,
  ADD COLUMN registrado_en timestamptz NOT NULL DEFAULT now();

-- Trazas del Supervisor: usuario que consultó y mensajes entre agentes.
ALTER TABLE agent_runs
  ADD COLUMN usuario text,
  ADD COLUMN mensajes jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN correccion boolean NOT NULL DEFAULT false;
CREATE INDEX agent_runs_usuario_idx ON agent_runs (usuario, created_at DESC);
