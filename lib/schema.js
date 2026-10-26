export const SCHEMA_SQL = `
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
  notas TEXT,
  motivo_anulacion TEXT,
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
`;

export const SERVICIOS_SEED = [
  {
    id: 'svc-office',
    nombre: 'Instalación Microsoft Office',
    descripcion: 'Instalación y activación de Microsoft Office 2019, 2021 y Microsoft 365. Incluye Word, Excel, PowerPoint, Outlook y más.',
    orden: 1,
  },
  {
    id: 'svc-adobe',
    nombre: 'Instalación Adobe Creative Cloud',
    descripcion: 'Instalación y activación de Adobe Creative Cloud 2020, 2021 y 2022. Incluye Photoshop, Illustrator, Premiere Pro, After Effects y más.',
    orden: 2,
  },
  {
    id: 'svc-corel',
    nombre: 'Instalación Corel Draw',
    descripcion: 'Instalación y activación de Corel Draw Graphics Suite 2020, 2021 y 2022. Ideal para diseño gráfico, ilustración y edición de fotos.',
    orden: 3,
  },
  {
    id: 'svc-autocad',
    nombre: 'Instalación AutoCAD',
    descripcion: 'Instalación y activación de AutoCAD 2020, 2021 y 2022. Perfecto para diseño arquitectónico, ingeniería y modelado 3D.',
    orden: 4,
  },
  {
    id: 'svc-windows',
    nombre: 'Instalación Windows 10/11',
    descripcion: 'Instalación y activación de Windows 10 y Windows 11. Incluye configuración inicial, drivers y actualizaciones.',
    orden: 5,
  },
  {
    id: 'svc-remoto',
    nombre: 'Instalación Remota',
    descripcion: 'Instalación y activación de tu software a distancia mediante conexión remota. Office, Adobe, Corel, AutoCAD o Windows, sin moverte de tu casa.',
    orden: 6,
  },
  {
    id: 'svc-mantenimiento',
    nombre: 'Mantenimiento Remoto',
    descripcion: 'Limpieza, optimización, actualización de drivers y resolución de problemas a distancia. Dejamos tu equipo rápido, actualizado y seguro.',
    orden: 7,
  },
  {
    id: 'svc-web',
    nombre: 'Desarrollo Web',
    descripcion: 'Desarrollo de sitios web responsivos y modernos. Incluye diseño UX/UI, optimización SEO y mantenimiento.',
    orden: 8,
  },
];

export const EMPRESA_DEFAULT = {
  id: 'principal',
  nombre: 'CodeEverything',
  ruc: '',
  direccion: '',
  telefono: '',
  email: '',
  web: '',
  leyenda: 'Gracias por su preferencia. Esta boleta no habilita crédito fiscal.',
};

export const TIPOS_COMPROBANTE = [
  { tipo: 'Boleta de Venta', serie: 'B001' },
  { tipo: 'Factura', serie: 'F001' },
  { tipo: 'Recibo de Pago', serie: 'R001' },
];
