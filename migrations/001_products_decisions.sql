CREATE TABLE products (
  sku text PRIMARY KEY,
  nombre text NOT NULL,
  categoria text NOT NULL,
  proveedor text NOT NULL,
  precio_compra numeric(14,2) NOT NULL CHECK (precio_compra >= 0),
  precio_venta numeric(14,2) NOT NULL CHECK (precio_venta > 0),
  stock integer NOT NULL CHECK (stock >= 0),
  stock_min integer NOT NULL CHECK (stock_min >= 0),
  stock_max integer NOT NULL CHECK (stock_max >= stock_min),
  ventas7 integer NOT NULL CHECK (ventas7 >= 0),
  ventas30 integer NOT NULL CHECK (ventas30 >= 0),
  lead_time integer NOT NULL CHECK (lead_time >= 0),
  tendencia numeric NOT NULL,
  estacionalidad text NOT NULL,
  display_order integer NOT NULL
);

CREATE TABLE decisions (
  id text PRIMARY KEY,
  sku text NOT NULL REFERENCES products(sku),
  nombre text NOT NULL,
  cantidad_sugerida integer NOT NULL CHECK (cantidad_sugerida >= 0),
  cantidad_final integer NOT NULL CHECK (cantidad_final >= 0),
  costo numeric(14,2) NOT NULL CHECK (costo >= 0),
  estado text NOT NULL CHECK (estado IN ('aprobado', 'modificado', 'pospuesto', 'descartado')),
  motivo text NOT NULL,
  fecha timestamptz NOT NULL,
  usuario text NOT NULL,
  created_order bigint GENERATED ALWAYS AS IDENTITY
);
CREATE INDEX decisions_fecha_idx ON decisions (fecha DESC, created_order DESC);
