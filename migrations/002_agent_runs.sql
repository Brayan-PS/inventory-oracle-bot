-- Registro de auditoría de cada consulta al Supervisor y de los agentes que intervinieron.
CREATE TABLE agent_runs (
  id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  consulta text NOT NULL,
  modo text NOT NULL CHECK (modo IN ('llm', 'reglas')),
  modelo text NOT NULL,
  motivo text,
  intencion text NOT NULL,
  respuesta text NOT NULL,
  llamadas jsonb NOT NULL DEFAULT '[]'::jsonb,
  verificacion jsonb,
  tokens_entrada integer NOT NULL DEFAULT 0 CHECK (tokens_entrada >= 0),
  tokens_salida integer NOT NULL DEFAULT 0 CHECK (tokens_salida >= 0),
  costo_usd numeric(12, 6) NOT NULL DEFAULT 0 CHECK (costo_usd >= 0),
  duracion_ms integer NOT NULL CHECK (duracion_ms >= 0)
);
CREATE INDEX agent_runs_created_idx ON agent_runs (created_at DESC);
