-- CodeEverything - esquema de la base de datos (copia de referencia de lib/schema.js). En produccion lo aplica automaticamente el servidor en el primer request. 

CREATE TABLE IF NOT EXISTS clientes (
  id TEXT PRIMARY KEY,
  nombre TEXT NOT NULL,
  documento TEXT,
  email TEXT,
  telefono TEXT,
  direccion TEXT,
  notas TEXT,
  creado_en TEXT NOT NULL,
  actualizado_en TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS leads (
  id TEXT PRIMARY KEY,
  nombre TEXT NOT NULL,
  email TEXT,
  telefono TEXT,
  servicio TEXT,
  mensaje TEXT,
  estado TEXT NOT NULL DEFAULT 'nuevo',
  notas TEXT,
  cliente_id TEXT REFERENCES clientes(id) ON DELETE SET NULL,
  creado_en TEXT NOT NULL,
  actualizado_en TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS servicios (
  id TEXT PRIMARY KEY,
  nombre TEXT NOT NULL,
  descripcion TEXT,
  precio REAL NOT NULL DEFAULT 0,
  orden INTEGER NOT NULL DEFAULT 0,
  activo INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS pedidos (
  id TEXT PRIMARY KEY,
  cliente_id TEXT NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
  servicio_id TEXT REFERENCES servicios(id) ON DELETE SET NULL,
  titulo TEXT NOT NULL,
  descripcion TEXT,
  precio REAL NOT NULL DEFAULT 0,
  estado TEXT NOT NULL DEFAULT 'pendiente',
  fecha_pedido TEXT NOT NULL,
  fecha_entrega TEXT,
  creado_en TEXT NOT NULL,
  actualizado_en TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS presupuestos (
  id TEXT PRIMARY KEY,
  numero INTEGER NOT NULL,
  cliente_id TEXT NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
  estado TEXT NOT NULL DEFAULT 'borrador',
  nota TEXT,
  validez_dias INTEGER NOT NULL DEFAULT 15,
  total REAL NOT NULL DEFAULT 0,
  creado_en TEXT NOT NULL,
  actualizado_en TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS presupuesto_items (
  id TEXT PRIMARY KEY,
  presupuesto_id TEXT NOT NULL REFERENCES presupuestos(id) ON DELETE CASCADE,
  descripcion TEXT NOT NULL,
  cantidad REAL NOT NULL DEFAULT 1,
  precio REAL NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS comprobantes (
  id TEXT PRIMARY KEY,
  numero INTEGER NOT NULL,
  serie TEXT NOT NULL DEFAULT 'B001',
  tipo TEXT NOT NULL DEFAULT 'Boleta de Venta',
  cliente_id TEXT REFERENCES clientes(id) ON DELETE SET NULL,
  pedido_id TEXT REFERENCES pedidos(id) ON DELETE SET NULL,
  concepto TEXT NOT NULL,
  monto REAL NOT NULL DEFAULT 0,
  metodo_pago TEXT,
  fecha TEXT NOT NULL,
  estado TEXT NOT NULL DEFAULT 'pagado',
  motivo_anulacion TEXT,
  notas TEXT,
  creado_en TEXT NOT NULL,
  actualizado_en TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS empresa (
  id TEXT PRIMARY KEY,
  nombre TEXT,
  ruc TEXT,
  direccion TEXT,
  telefono TEXT,
  email TEXT,
  web TEXT,
  leyenda TEXT,
  actualizado_en TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  clave TEXT PRIMARY KEY,
  valor TEXT NOT NULL,
  actualizado_en TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_leads_estado ON leads(estado);
CREATE INDEX IF NOT EXISTS idx_leads_creado ON leads(creado_en);
CREATE INDEX IF NOT EXISTS idx_pedidos_estado ON pedidos(estado);
CREATE INDEX IF NOT EXISTS idx_pedidos_cliente ON pedidos(cliente_id);
CREATE INDEX IF NOT EXISTS idx_presupuestos_cliente ON presupuestos(cliente_id);
CREATE INDEX IF NOT EXISTS idx_items_presupuesto ON presupuesto_items(presupuesto_id);
CREATE INDEX IF NOT EXISTS idx_comprobantes_cliente ON comprobantes(cliente_id);
CREATE INDEX IF NOT EXISTS idx_comprobantes_estado ON comprobantes(estado);
