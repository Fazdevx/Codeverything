import { randomUUID } from 'node:crypto';
import { SCHEMA_SQL, SERVICIOS_SEED, EMPRESA_DEFAULT } from './schema.js';

const PG_URL =
  process.env.SUPABASE_DB_URL ||
  process.env.POSTGRES_URL ||
  process.env.POSTGRES_PRISMA_URL ||
  process.env.DATABASE_URL ||
  '';

export const hasDatabase = Boolean(PG_URL);

let pool = null;
let ready = null;

function toPgPlaceholders(sql) {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

function parseUrl(url) {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

function isPoolerUrl(parsed) {
  return Boolean(
    parsed &&
      (parsed.port === '6543' ||
        parsed.hostname.includes('pooler.supabase.com') ||
        parsed.searchParams.get('pgbouncer') === 'true')
  );
}

function sslConfig(parsed) {
  if (parsed && parsed.searchParams.get('sslmode') === 'disable') return undefined;
  const ca = process.env.SUPABASE_DB_CA_CERT;
  if (ca) {
    const pem = ca.includes('BEGIN CERTIFICATE')
      ? ca.replace(/\\n/g, '\n')
      : Buffer.from(ca, 'base64').toString();
    return { ca: pem, rejectUnauthorized: true };
  }
  return { rejectUnauthorized: false };
}

async function setup() {
  if (!PG_URL) {
    throw new Error(
      'Falta la variable de entorno SUPABASE_DB_URL con la cadena de conexion de Supabase. ' +
        'Consiguela en Supabase -> Settings -> Database -> URI (modo Pooler) y guardala en .env (ver .env.example).'
    );
  }
  const { default: pg } = await import('pg');
  const parsed = parseUrl(PG_URL);
  const ssl = sslConfig(parsed);
  if (parsed) parsed.searchParams.delete('sslmode');
  pool = new pg.Pool({
    connectionString: parsed ? parsed.toString() : PG_URL,
    max: Number(process.env.PG_POOL_MAX || 5),
    connectionTimeoutMillis: 10000,
    idleTimeoutMillis: 30000,
    application_name: 'codeverything',
    prepare: !isPoolerUrl(parsed),
    ssl,
  });
  await pool.query('SELECT 1');
  await createSchema();
  await runMigrations();
  await seed();
}

async function createSchema() {
  for (const raw of SCHEMA_SQL.split(';')) {
    const stmt = raw.trim();
    if (stmt) await pool.query(stmt);
  }
}

async function seed() {
  for (const s of SERVICIOS_SEED) {
    await pool.query(
      toPgPlaceholders(
        `INSERT INTO servicios (id, nombre, descripcion, precio, orden, activo)
         VALUES (?, ?, ?, 0, ?, 1)
         ON CONFLICT (id) DO NOTHING`
      ),
      [s.id, s.nombre, s.descripcion, s.orden]
    );
  }
  await pool.query(
    toPgPlaceholders(
      `INSERT INTO empresa (id, nombre, ruc, direccion, telefono, email, web, leyenda, actualizado_en)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (id) DO NOTHING`
    ),
    [EMPRESA_DEFAULT.id, EMPRESA_DEFAULT.nombre, EMPRESA_DEFAULT.ruc, EMPRESA_DEFAULT.direccion,
     EMPRESA_DEFAULT.telefono, EMPRESA_DEFAULT.email, EMPRESA_DEFAULT.web, EMPRESA_DEFAULT.leyenda, nowIso()]
  );
}

function nowIso() {
  return new Date().toISOString();
}

async function pgColumns(table) {
  const r = await pool.query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1`,
    [table]
  );
  return r.rows.map((x) => x.column_name);
}

async function runMigrations() {
  const exec = (sql) => pool.query(sql);

  const empresaCols = await pgColumns('empresa');
  if (empresaCols.includes('cuit') && !empresaCols.includes('ruc')) {
    await exec(`ALTER TABLE empresa RENAME COLUMN cuit TO ruc`);
  }
  if (empresaCols.includes('leyenda')) {
    const vieja = 'Comprobante de pago. No válido como factura.';
    await exec(
      `UPDATE empresa SET leyenda = 'Gracias por su preferencia. Esta boleta no habilita crédito fiscal.' WHERE leyenda = '${vieja.replace(/'/g, "''")}'`
    );
  }

  const clienteCols = await pgColumns('clientes');
  if (!clienteCols.includes('documento')) {
    await exec(`ALTER TABLE clientes ADD COLUMN documento TEXT`);
  }

  const comprobCols = await pgColumns('comprobantes');
  if (!comprobCols.includes('serie')) {
    await exec(`ALTER TABLE comprobantes ADD COLUMN serie TEXT DEFAULT 'B001'`);
    await exec(`UPDATE comprobantes SET serie = 'B001' WHERE serie IS NULL`);
  }
  if (!comprobCols.includes('tipo')) {
    await exec(`ALTER TABLE comprobantes ADD COLUMN tipo TEXT DEFAULT 'Boleta de Venta'`);
    await exec(`UPDATE comprobantes SET tipo = 'Boleta de Venta' WHERE tipo IS NULL`);
  }
  if (!comprobCols.includes('motivo_anulacion')) {
    await exec(`ALTER TABLE comprobantes ADD COLUMN motivo_anulacion TEXT`);
  }
}

export async function query(sql, params = []) {
  if (!ready) ready = setup().catch((err) => { ready = null; throw err; });
  await ready;
  const res = await pool.query(toPgPlaceholders(sql), params);
  return { rows: res.rows.map((r) => ({ ...r })) };
}

export async function getSetting(clave) {
  const { rows } = await query(`SELECT valor FROM settings WHERE clave = ?`, [clave]);
  return rows.length ? rows[0].valor : null;
}

export async function setSetting(clave, valor) {
  await query(
    `INSERT INTO settings (clave, valor, actualizado_en) VALUES (?, ?, ?)
     ON CONFLICT (clave) DO UPDATE SET valor = excluded.valor, actualizado_en = excluded.actualizado_en`,
    [clave, String(valor), nowIso()]
  );
}

export function uuid() {
  return randomUUID();
}

export function now() {
  return new Date().toISOString();
}
