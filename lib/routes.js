import express from 'express';
import { query, uuid, now, setSetting } from './db.js';
import { TIPOS_COMPROBANTE } from './schema.js';
import {
  requireAuth,
  credentialsOk,
  hashPassword,
  setSession,
  clearSession,
  currentUser,
} from './auth.js';

const ESTADOS_PEDIDO = ['pendiente', 'en proceso', 'entregado', 'cancelado'];
const ESTADOS_LEAD = ['nuevo', 'contactado', 'convertido', 'rechazado'];
const ESTADOS_PRESUPUESTO = ['borrador', 'enviado', 'aprobado', 'pagado', 'rechazado'];

const LOGIN_MAX_FAILS = 5;
const LOGIN_WINDOW_MS = 1000 * 60 * 15;
const loginFails = new Map();

function rateKey(req, usuario) {
  const ip = req.ip || (req.socket && req.socket.remoteAddress) || 'desconocida';
  return `${ip}::${String(usuario || '').toLowerCase()}`;
}

function recordLoginFail(key) {
  const ts = Date.now();
  const rec = loginFails.get(key);
  if (!rec || ts - rec.first > LOGIN_WINDOW_MS) {
    loginFails.set(key, { count: 1, first: ts });
  } else {
    rec.count += 1;
  }
  if (loginFails.size > 500) {
    for (const [k, v] of loginFails) {
      if (ts - v.first > LOGIN_WINDOW_MS) loginFails.delete(k);
    }
  }
}

function loginBlocked(key) {
  const rec = loginFails.get(key);
  return Boolean(rec && rec.count >= LOGIN_MAX_FAILS && Date.now() - rec.first <= LOGIN_WINDOW_MS);
}

async function notificarLead(lead) {
  const url = process.env.LEAD_WEBHOOK_URL;
  if (!url) return;
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: 'codeverything', lead }),
      signal: AbortSignal.timeout(4000),
    });
  } catch {
    /* el webhook es opcional: nunca bloquea la respuesta */
  }
}

function ok(res, data) {
  return res.json({ ok: true, data });
}

function bad(res, error, status = 400) {
  return res.status(status).json({ ok: false, error });
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function startOfMonth(offset = 0) {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth() + offset, 1).toISOString();
}

export function buildRouter() {
  const api = express.Router();

  api.use(express.json({ limit: '1mb' }));

  api.get('/health', (req, res) => ok(res, { status: 'ok' }));

  api.post('/auth/login', async (req, res) => {
    const { usuario, contrasena } = req.body || {};
    const key = rateKey(req, usuario);
    if (loginBlocked(key)) {
      return bad(res, 'Demasiados intentos. Espera unos minutos y vuelve a intentar.', 429);
    }
    if (!(await credentialsOk(usuario, contrasena))) {
      recordLoginFail(key);
      return bad(res, 'Usuario o contraseña incorrectos', 401);
    }
    loginFails.delete(key);
    setSession(res, usuario);
    return ok(res, { usuario });
  });

  api.post('/auth/logout', (req, res) => {
    clearSession(res);
    return ok(res, {});
  });

  api.get('/auth/me', (req, res) => {
    const user = currentUser(req);
    if (!user) return bad(res, 'No autenticado', 401);
    return ok(res, { usuario: user.sub });
  });

  api.post('/contact', async (req, res) => {
    const { nombre, email, telefono, servicio, mensaje } = req.body || {};
    if (!nombre || !String(nombre).trim()) return bad(res, 'El nombre es obligatorio');
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email))) {
      return bad(res, 'El email es obligatorio o no es válido');
    }
    const ts = now();
    const { rows } = await query(
      `INSERT INTO leads (id, nombre, email, telefono, servicio, mensaje, estado, notas, cliente_id, creado_en, actualizado_en)
       VALUES (?, ?, ?, ?, ?, ?, 'nuevo', NULL, NULL, ?, ?) RETURNING *`,
      [uuid(), String(nombre).trim(), String(email).trim(), telefono || null, servicio || null, mensaje || null, ts, ts]
    );
    await notificarLead(rows[0]);
    return ok(res, { recibido: true });
  });

  api.get('/publico', async (req, res) => {
    const { rows } = await query(
      `SELECT nombre, precio FROM servicios WHERE activo = 1 ORDER BY orden ASC`
    );
    return ok(res, {
      servicios: rows.map((r) => ({ nombre: r.nombre, precio: num(r.precio) })),
    });
  });

  api.get('/servicios', requireAuth, async (req, res) => {
    const soloActivos = req.query.activos === '1';
    const { rows } = await query(
      `SELECT * FROM servicios ${soloActivos ? 'WHERE activo = 1' : ''} ORDER BY orden ASC`
    );
    return ok(res, rows.map((r) => ({ ...r, activo: num(r.activo) })));
  });

  api.put('/servicios/:id', requireAuth, async (req, res) => {
    const { rows } = await query(`SELECT * FROM servicios WHERE id = ?`, [req.params.id]);
    if (!rows.length) return bad(res, 'Servicio no encontrado', 404);
    const s = rows[0];
    const body = req.body || {};
    const nombre = body.nombre ?? s.nombre;
    const descripcion = body.descripcion ?? s.descripcion;
    const precio = body.precio != null ? num(body.precio) : num(s.precio);
    const orden = body.orden != null ? num(body.orden) : num(s.orden);
    const activo = body.activo != null ? (body.activo ? 1 : 0) : num(s.activo);
    const upd = await query(
      `UPDATE servicios SET nombre = ?, descripcion = ?, precio = ?, orden = ?, activo = ? WHERE id = ? RETURNING *`,
      [nombre, descripcion, precio, orden, activo, req.params.id]
    );
    return ok(res, { ...upd.rows[0], activo: num(upd.rows[0].activo) });
  });

  api.post('/servicios', requireAuth, async (req, res) => {
    const { nombre, descripcion, precio, activo } = req.body || {};
    if (!nombre || !String(nombre).trim()) return bad(res, 'El nombre es obligatorio');
    const { rows: max } = await query(`SELECT COALESCE(MAX(orden), 0) AS n FROM servicios`);
    const { rows } = await query(
      `INSERT INTO servicios (id, nombre, descripcion, precio, orden, activo)
       VALUES (?, ?, ?, ?, ?, ?) RETURNING *`,
      [uuid(), String(nombre).trim(), descripcion || null, num(precio), num(max[0].n) + 1, activo ? 1 : 0]
    );
    return ok(res, { ...rows[0], activo: num(rows[0].activo) });
  });

  api.delete('/servicios/:id', requireAuth, async (req, res) => {
    const { rows } = await query(`SELECT id FROM servicios WHERE id = ?`, [req.params.id]);
    if (!rows.length) return bad(res, 'Servicio no encontrado', 404);
    await query(`DELETE FROM servicios WHERE id = ?`, [req.params.id]);
    return ok(res, {});
  });

  api.use(requireAuth);

  api.post('/auth/cambiar-contrasena', async (req, res) => {
    const user = currentUser(req);
    if (!user) return bad(res, 'No autenticado', 401);
    const { actual, nueva } = req.body || {};
    if (!actual || !nueva) return bad(res, 'Completa ambos campos');
    if (String(nueva).length < 6) return bad(res, 'La contraseña nueva debe tener al menos 6 caracteres');
    if (!(await credentialsOk(user.sub, actual))) return bad(res, 'La contraseña actual es incorrecta', 403);
    await setSetting('admin_pass_hash', hashPassword(nueva));
    return ok(res, {});
  });

  api.get('/backup', async (req, res) => {
    const tablas = ['clientes', 'leads', 'servicios', 'pedidos', 'presupuestos', 'presupuesto_items', 'comprobantes', 'empresa'];
    const dump = {};
    for (const t of tablas) {
      dump[t] = (await query(`SELECT * FROM ${t}`)).rows;
    }
    return ok(res, { app: 'codeverything', generado_en: now(), tablas: dump });
  });

  api.get('/dashboard', async (req, res) => {
    const mes = startOfMonth(0);
    const seisMeses = startOfMonth(-5);

    const [
      leadsTotal,
      leadsMes,
      clientesTotal,
      clientesMes,
      porEstado,
      ingresosMes,
      porCobrar,
      topServicios,
      serie,
      presupuestosEstado,
      leadsRecientes,
      pedidosRecientes,
    ] = await Promise.all([
      query(`SELECT COUNT(*) AS n FROM leads`),
      query(`SELECT COUNT(*) AS n FROM leads WHERE creado_en >= ?`, [mes]),
      query(`SELECT COUNT(*) AS n FROM clientes`),
      query(`SELECT COUNT(*) AS n FROM clientes WHERE creado_en >= ?`, [mes]),
      query(
        `SELECT estado, COUNT(*) AS n, COALESCE(SUM(precio), 0) AS monto
         FROM pedidos GROUP BY estado`
      ),
      query(
        `SELECT COUNT(*) AS n, COALESCE(SUM(precio), 0) AS monto
         FROM pedidos WHERE estado = 'entregado' AND fecha_pedido >= ?`,
        [mes]
      ),
      query(
        `SELECT COALESCE(SUM(precio), 0) AS monto
         FROM pedidos WHERE estado IN ('pendiente', 'en proceso')`
      ),
      query(
        `SELECT COALESCE(s.nombre, 'Sin servicio') AS nombre, COUNT(*) AS n, COALESCE(SUM(p.precio), 0) AS monto
         FROM pedidos p LEFT JOIN servicios s ON s.id = p.servicio_id
         GROUP BY COALESCE(s.nombre, 'Sin servicio')
         ORDER BY n DESC LIMIT 5`
      ),
      query(`SELECT fecha_pedido, precio FROM pedidos WHERE fecha_pedido >= ?`, [seisMeses]),
      query(
        `SELECT estado, COUNT(*) AS n FROM presupuestos GROUP BY estado`
      ),
      query(`SELECT * FROM leads ORDER BY creado_en DESC LIMIT 5`),
      query(
        `SELECT p.*, c.nombre AS cliente_nombre, s.nombre AS servicio_nombre
         FROM pedidos p
         LEFT JOIN clientes c ON c.id = p.cliente_id
         LEFT JOIN servicios s ON s.id = p.servicio_id
         ORDER BY p.creado_en DESC LIMIT 5`
      ),
    ]);

    const activos = porEstado.rows
      .filter((r) => r.estado === 'pendiente' || r.estado === 'en proceso')
      .reduce((acc, r) => acc + num(r.n), 0);

    const meses = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date();
      const first = new Date(d.getFullYear(), d.getMonth() - i, 1);
      const key = `${first.getFullYear()}-${String(first.getMonth() + 1).padStart(2, '0')}`;
      meses.push({ key, label: first.toLocaleDateString('es-PE', { month: 'short', year: '2-digit' }), monto: 0 });
    }
    for (const row of serie.rows) {
      const key = String(row.fecha_pedido || '').slice(0, 7);
      const m = meses.find((x) => x.key === key);
      if (m) m.monto += num(row.precio);
    }

    return ok(res, {
      leads: { total: num(leadsTotal.rows[0].n), mes: num(leadsMes.rows[0].n) },
      clientes: { total: num(clientesTotal.rows[0].n), mes: num(clientesMes.rows[0].n) },
      pedidos: {
        activos,
        porEstado: porEstado.rows.map((r) => ({ estado: r.estado, n: num(r.n), monto: num(r.monto) })),
        recientes: pedidosRecientes.rows,
      },
      ingresos: {
        mes: num(ingresosMes.rows[0].monto),
        entregados: num(ingresosMes.rows[0].n),
        porCobrar: num(porCobrar.rows[0].monto),
      },
      topServicios: topServicios.rows.map((r) => ({ nombre: r.nombre, n: num(r.n), monto: num(r.monto) })),
      serie: meses,
      presupuestos: presupuestosEstado.rows.map((r) => ({ estado: r.estado, n: num(r.n) })),
      leadsRecientes: leadsRecientes.rows,
    });
  });

  api.get('/clientes', async (req, res) => {
    const q = String(req.query.q || '').trim();
    const { rows } = await query(
      `SELECT c.*,
        (SELECT COUNT(*) FROM pedidos p WHERE p.cliente_id = c.id) AS pedidos,
        (SELECT COUNT(*) FROM presupuestos pr WHERE pr.cliente_id = c.id) AS presupuestos
       FROM clientes c
       WHERE (? = '' OR c.nombre ILIKE '%' || ? || '%'
           OR COALESCE(c.email, '') ILIKE '%' || ? || '%'
           OR COALESCE(c.telefono, '') ILIKE '%' || ? || '%')
       ORDER BY c.creado_en DESC
       LIMIT 300`,
      [q, q, q, q]
    );
    return ok(res, rows.map((r) => ({ ...r, pedidos: num(r.pedidos), presupuestos: num(r.presupuestos) })));
  });

  api.get('/clientes/:id', async (req, res) => {
    const { rows } = await query(`SELECT * FROM clientes WHERE id = ?`, [req.params.id]);
    if (!rows.length) return bad(res, 'Cliente no encontrado', 404);
    const [pedidos, presupuestos, comprobantes] = await Promise.all([
      query(
        `SELECT p.*, s.nombre AS servicio_nombre FROM pedidos p
         LEFT JOIN servicios s ON s.id = p.servicio_id
         WHERE p.cliente_id = ? ORDER BY p.creado_en DESC`,
        [req.params.id]
      ),
      query(`SELECT * FROM presupuestos WHERE cliente_id = ? ORDER BY creado_en DESC`, [req.params.id]),
      query(`SELECT * FROM comprobantes WHERE cliente_id = ? ORDER BY creado_en DESC`, [req.params.id]),
    ]);
    return ok(res, {
      ...rows[0],
      pedidos: pedidos.rows,
      presupuestos: presupuestos.rows.map((p) => ({ ...p, total: num(p.total), numero: num(p.numero) })),
      comprobantes: comprobantes.rows.map((c) => ({ ...c, monto: num(c.monto), numero: num(c.numero) })),
    });
  });

  api.post('/clientes', async (req, res) => {
    const { nombre, documento, email, telefono, direccion, notas } = req.body || {};
    if (!nombre || !String(nombre).trim()) return bad(res, 'El nombre es obligatorio');
    const ts = now();
    const { rows } = await query(
      `INSERT INTO clientes (id, nombre, documento, email, telefono, direccion, notas, creado_en, actualizado_en)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`,
      [uuid(), String(nombre).trim(), documento || null, email || null, telefono || null, direccion || null, notas || null, ts, ts]
    );
    return ok(res, rows[0]);
  });

  api.put('/clientes/:id', async (req, res) => {
    const { nombre, documento, email, telefono, direccion, notas } = req.body || {};
    if (!nombre || !String(nombre).trim()) return bad(res, 'El nombre es obligatorio');
    const { rows } = await query(
      `UPDATE clientes SET nombre = ?, documento = ?, email = ?, telefono = ?, direccion = ?, notas = ?, actualizado_en = ?
       WHERE id = ? RETURNING *`,
      [String(nombre).trim(), documento || null, email || null, telefono || null, direccion || null, notas || null, now(), req.params.id]
    );
    if (!rows.length) return bad(res, 'Cliente no encontrado', 404);
    return ok(res, rows[0]);
  });

  api.delete('/clientes/:id', async (req, res) => {
    await query(`DELETE FROM clientes WHERE id = ?`, [req.params.id]);
    return ok(res, {});
  });

  api.get('/leads', async (req, res) => {
    const estado = String(req.query.estado || '').trim();
    const { rows } = await query(
      `SELECT * FROM leads
       WHERE (? = '' OR estado = ?)
       ORDER BY creado_en DESC LIMIT 300`,
      [estado, estado]
    );
    return ok(res, rows);
  });

  api.post('/leads', async (req, res) => {
    const { nombre, email, telefono, servicio, mensaje, notas } = req.body || {};
    if (!nombre || !String(nombre).trim()) return bad(res, 'El nombre es obligatorio');
    const ts = now();
    const { rows } = await query(
      `INSERT INTO leads (id, nombre, email, telefono, servicio, mensaje, estado, notas, cliente_id, creado_en, actualizado_en)
       VALUES (?, ?, ?, ?, ?, ?, 'nuevo', ?, NULL, ?, ?) RETURNING *`,
      [uuid(), String(nombre).trim(), email || null, telefono || null, servicio || null, mensaje || null, notas || null, ts, ts]
    );
    await notificarLead(rows[0]);
    return ok(res, rows[0]);
  });

  api.patch('/leads/:id', async (req, res) => {
    const { rows } = await query(`SELECT * FROM leads WHERE id = ?`, [req.params.id]);
    if (!rows.length) return bad(res, 'Lead no encontrado', 404);
    const lead = rows[0];
    const body = req.body || {};
    const estado = body.estado ?? lead.estado;
    if (!ESTADOS_LEAD.includes(estado)) return bad(res, 'Estado inválido');
    const notas = body.notas ?? lead.notas;
    const upd = await query(
      `UPDATE leads SET estado = ?, notas = ?, actualizado_en = ? WHERE id = ? RETURNING *`,
      [estado, notas, now(), req.params.id]
    );
    return ok(res, upd.rows[0]);
  });

  api.post('/leads/:id/convertir', async (req, res) => {
    const { rows } = await query(`SELECT * FROM leads WHERE id = ?`, [req.params.id]);
    if (!rows.length) return bad(res, 'Lead no encontrado', 404);
    const lead = rows[0];
    const ts = now();
    const created = await query(
      `INSERT INTO clientes (id, nombre, email, telefono, direccion, notas, creado_en, actualizado_en)
       VALUES (?, ?, ?, ?, NULL, ?, ?, ?) RETURNING *`,
      [uuid(), lead.nombre, lead.email, lead.telefono, `Convertido desde el lead del ${String(lead.creado_en).slice(0, 10)}`, ts, ts]
    );
    await query(
      `UPDATE leads SET estado = 'convertido', cliente_id = ?, actualizado_en = ? WHERE id = ?`,
      [created.rows[0].id, ts, lead.id]
    );
    return ok(res, { cliente: created.rows[0] });
  });

  api.delete('/leads/:id', async (req, res) => {
    await query(`DELETE FROM leads WHERE id = ?`, [req.params.id]);
    return ok(res, {});
  });

  api.get('/pedidos', async (req, res) => {
    const estado = String(req.query.estado || '').trim();
    const cliente = String(req.query.cliente_id || '').trim();
    const q = String(req.query.q || '').trim();
    const { rows } = await query(
      `SELECT p.*, c.nombre AS cliente_nombre, c.telefono AS cliente_telefono, s.nombre AS servicio_nombre
       FROM pedidos p
       LEFT JOIN clientes c ON c.id = p.cliente_id
       LEFT JOIN servicios s ON s.id = p.servicio_id
       WHERE (? = '' OR p.estado = ?)
         AND (? = '' OR p.cliente_id = ?)
         AND (? = '' OR p.titulo ILIKE '%' || ? || '%'
              OR COALESCE(c.nombre, '') ILIKE '%' || ? || '%'
              OR COALESCE(c.telefono, '') ILIKE '%' || ? || '%'
              OR COALESCE(s.nombre, '') ILIKE '%' || ? || '%')
       ORDER BY p.creado_en DESC LIMIT 500`,
      [estado, estado, cliente, cliente, q, q, q, q, q]
    );
    return ok(res, rows.map((r) => ({ ...r, precio: num(r.precio) })));
  });

  api.get('/pedidos/:id', async (req, res) => {
    const { rows } = await query(
      `SELECT p.*, c.nombre AS cliente_nombre, c.email AS cliente_email, c.telefono AS cliente_telefono,
        c.documento AS cliente_documento, c.direccion AS cliente_direccion, s.nombre AS servicio_nombre
       FROM pedidos p
       LEFT JOIN clientes c ON c.id = p.cliente_id
       LEFT JOIN servicios s ON s.id = p.servicio_id
       WHERE p.id = ?`,
      [req.params.id]
    );
    if (!rows.length) return bad(res, 'Pedido no encontrado', 404);
    const comprob = await query(
      `SELECT co.*, cli.nombre AS cliente_nombre
       FROM comprobantes co
       LEFT JOIN clientes cli ON cli.id = co.cliente_id
       WHERE co.pedido_id = ?
       ORDER BY co.creado_en DESC`,
      [req.params.id]
    );
    return ok(res, {
      ...rows[0],
      precio: num(rows[0].precio),
      comprobantes: comprob.rows.map((r) => ({ ...r, monto: num(r.monto), numero: num(r.numero) })),
    });
  });

  api.post('/pedidos', async (req, res) => {
    const { cliente_id, servicio_id, titulo, descripcion, precio, estado, fecha_entrega } = req.body || {};
    if (!cliente_id) return bad(res, 'El cliente es obligatorio');
    if (!titulo || !String(titulo).trim()) return bad(res, 'El título es obligatorio');
    if (estado && !ESTADOS_PEDIDO.includes(estado)) return bad(res, 'Estado inválido');
    const { rows: cli } = await query(`SELECT id FROM clientes WHERE id = ?`, [cliente_id]);
    if (!cli.length) return bad(res, 'Cliente no encontrado', 404);
    let precioFinal = num(precio);
    if (servicio_id) {
      const { rows: svc } = await query(`SELECT precio FROM servicios WHERE id = ?`, [servicio_id]);
      if (!precio && svc.length) precioFinal = num(svc[0].precio);
    }
    const ts = now();
    const { rows } = await query(
      `INSERT INTO pedidos (id, cliente_id, servicio_id, titulo, descripcion, precio, estado, fecha_pedido, fecha_entrega, creado_en, actualizado_en)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`,
      [
        uuid(), cliente_id, servicio_id || null, String(titulo).trim(), descripcion || null,
        precioFinal, estado || 'pendiente', ts.slice(0, 10), fecha_entrega || null, ts, ts,
      ]
    );
    return ok(res, { ...rows[0], precio: precioFinal });
  });

  api.patch('/pedidos/:id', async (req, res) => {
    const { rows } = await query(`SELECT * FROM pedidos WHERE id = ?`, [req.params.id]);
    if (!rows.length) return bad(res, 'Pedido no encontrado', 404);
    const p = rows[0];
    const body = req.body || {};
    const estado = body.estado ?? p.estado;
    if (!ESTADOS_PEDIDO.includes(estado)) return bad(res, 'Estado inválido');
    const upd = await query(
      `UPDATE pedidos SET servicio_id = ?, titulo = ?, descripcion = ?, precio = ?, estado = ?, fecha_entrega = ?, actualizado_en = ?
       WHERE id = ? RETURNING *`,
      [
        body.servicio_id ?? p.servicio_id,
        body.titulo ?? p.titulo,
        body.descripcion ?? p.descripcion,
        body.precio != null ? num(body.precio) : num(p.precio),
        estado,
        body.fecha_entrega ?? p.fecha_entrega,
        now(),
        req.params.id,
      ]
    );
    return ok(res, { ...upd.rows[0], precio: num(upd.rows[0].precio) });
  });

  api.delete('/pedidos/:id', async (req, res) => {
    await query(`DELETE FROM pedidos WHERE id = ?`, [req.params.id]);
    return ok(res, {});
  });

  api.get('/presupuestos', async (req, res) => {
    const estado = String(req.query.estado || '').trim();
    const { rows } = await query(
      `SELECT pr.*, c.nombre AS cliente_nombre,
        (SELECT COUNT(*) FROM presupuesto_items i WHERE i.presupuesto_id = pr.id) AS items
       FROM presupuestos pr
       LEFT JOIN clientes c ON c.id = pr.cliente_id
       WHERE (? = '' OR pr.estado = ?)
       ORDER BY pr.creado_en DESC LIMIT 300`,
      [estado, estado]
    );
    return ok(
      res,
      rows.map((r) => ({ ...r, total: num(r.total), numero: num(r.numero), items: num(r.items) }))
    );
  });

  api.post('/presupuestos', async (req, res) => {
    const { cliente_id, items, nota, validez_dias, estado } = req.body || {};
    if (!cliente_id) return bad(res, 'El cliente es obligatorio');
    if (!Array.isArray(items) || !items.length) return bad(res, 'Agrega al menos un ítem');
    if (estado && !ESTADOS_PRESUPUESTO.includes(estado)) return bad(res, 'Estado inválido');
    const { rows: cli } = await query(`SELECT id FROM clientes WHERE id = ?`, [cliente_id]);
    if (!cli.length) return bad(res, 'Cliente no encontrado', 404);

    const cleaned = items
      .map((i) => ({
        descripcion: String(i.descripcion || '').trim(),
        cantidad: Math.max(0.01, num(i.cantidad) || 1),
        precio: Math.max(0, num(i.precio)),
      }))
      .filter((i) => i.descripcion);
    if (!cleaned.length) return bad(res, 'Agrega al menos un ítem con descripción');
    const total = cleaned.reduce((acc, i) => acc + i.cantidad * i.precio, 0);

    const ts = now();
    const { rows: prev } = await query(`SELECT COALESCE(MAX(numero), 0) AS n FROM presupuestos`);
    const numero = num(prev[0].n) + 1;
    const id = uuid();
    const { rows } = await query(
      `INSERT INTO presupuestos (id, numero, cliente_id, estado, nota, validez_dias, total, creado_en, actualizado_en)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`,
      [id, numero, cliente_id, estado || 'borrador', nota || null, num(validez_dias) || 15, total, ts, ts]
    );
    for (const i of cleaned) {
      await query(
        `INSERT INTO presupuesto_items (id, presupuesto_id, descripcion, cantidad, precio) VALUES (?, ?, ?, ?, ?)`,
        [uuid(), id, i.descripcion, i.cantidad, i.precio]
      );
    }
    return ok(res, { ...rows[0], total });
  });

  api.get('/presupuestos/:id', async (req, res) => {
    const { rows } = await query(
      `SELECT pr.*, c.nombre AS cliente_nombre, c.email AS cliente_email, c.telefono AS cliente_telefono, c.direccion AS cliente_direccion
       FROM presupuestos pr
       LEFT JOIN clientes c ON c.id = pr.cliente_id
       WHERE pr.id = ?`,
      [req.params.id]
    );
    if (!rows.length) return bad(res, 'Presupuesto no encontrado', 404);
    const items = await query(`SELECT * FROM presupuesto_items WHERE presupuesto_id = ?`, [req.params.id]);
    return ok(res, {
      ...rows[0],
      total: num(rows[0].total),
      numero: num(rows[0].numero),
      items: items.rows.map((i) => ({ ...i, cantidad: num(i.cantidad), precio: num(i.precio) })),
    });
  });

  api.patch('/presupuestos/:id', async (req, res) => {
    const { rows } = await query(`SELECT * FROM presupuestos WHERE id = ?`, [req.params.id]);
    if (!rows.length) return bad(res, 'Presupuesto no encontrado', 404);
    const pr = rows[0];
    const body = req.body || {};
    const estado = body.estado ?? pr.estado;
    if (!ESTADOS_PRESUPUESTO.includes(estado)) return bad(res, 'Estado inválido');

    let total = num(pr.total);
    if (Array.isArray(body.items)) {
      const cleaned = body.items
        .map((i) => ({
          descripcion: String(i.descripcion || '').trim(),
          cantidad: Math.max(0.01, num(i.cantidad) || 1),
          precio: Math.max(0, num(i.precio)),
        }))
        .filter((i) => i.descripcion);
      if (!cleaned.length) return bad(res, 'Agrega al menos un ítem con descripción');
      total = cleaned.reduce((acc, i) => acc + i.cantidad * i.precio, 0);
      await query(`DELETE FROM presupuesto_items WHERE presupuesto_id = ?`, [pr.id]);
      for (const i of cleaned) {
        await query(
          `INSERT INTO presupuesto_items (id, presupuesto_id, descripcion, cantidad, precio) VALUES (?, ?, ?, ?, ?)`,
          [uuid(), pr.id, i.descripcion, i.cantidad, i.precio]
        );
      }
    }

    const upd = await query(
      `UPDATE presupuestos SET estado = ?, nota = ?, validez_dias = ?, total = ?, actualizado_en = ?
       WHERE id = ? RETURNING *`,
      [
        estado,
        body.nota ?? pr.nota,
        body.validez_dias != null ? num(body.validez_dias) : num(pr.validez_dias),
        total,
        now(),
        pr.id,
      ]
    );
    return ok(res, { ...upd.rows[0], total, numero: num(upd.rows[0].numero) });
  });

  api.delete('/presupuestos/:id', async (req, res) => {
    await query(`DELETE FROM presupuestos WHERE id = ?`, [req.params.id]);
    return ok(res, {});
  });

  api.get('/empresa', async (req, res) => {
    const { rows } = await query(`SELECT * FROM empresa WHERE id = 'principal'`);
    if (!rows.length) return ok(res, { id: 'principal', nombre: '', ruc: '', leyenda: '' });
    return ok(res, rows[0]);
  });

  api.put('/empresa', async (req, res) => {
    const { rows } = await query(`SELECT * FROM empresa WHERE id = 'principal'`);
    const body = req.body || {};
    const prev = rows[0] || {};
    const data = {
      nombre: body.nombre ?? prev.nombre ?? '',
      ruc: body.ruc ?? prev.ruc ?? '',
      direccion: body.direccion ?? prev.direccion ?? '',
      telefono: body.telefono ?? prev.telefono ?? '',
      email: body.email ?? prev.email ?? '',
      web: body.web ?? prev.web ?? '',
      leyenda: body.leyenda ?? prev.leyenda ?? '',
    };
    if (!rows.length) {
      const ins = await query(
        `INSERT INTO empresa (id, nombre, ruc, direccion, telefono, email, web, leyenda, actualizado_en)
         VALUES ('principal', ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`,
        [data.nombre, data.ruc, data.direccion, data.telefono, data.email, data.web, data.leyenda, now()]
      );
      return ok(res, ins.rows[0]);
    }
    const upd = await query(
      `UPDATE empresa SET nombre = ?, ruc = ?, direccion = ?, telefono = ?, email = ?, web = ?, leyenda = ?, actualizado_en = ?
       WHERE id = 'principal' RETURNING *`,
      [data.nombre, data.ruc, data.direccion, data.telefono, data.email, data.web, data.leyenda, now()]
    );
    return ok(res, upd.rows[0]);
  });

  api.get('/comprobantes', async (req, res) => {
    const estado = String(req.query.estado || '').trim();
    const q = String(req.query.q || '').trim();
    const { rows } = await query(
      `SELECT co.*, c.nombre AS cliente_nombre
       FROM comprobantes co
       LEFT JOIN clientes c ON c.id = co.cliente_id
       WHERE (? = '' OR co.estado = ?)
         AND (? = '' OR co.concepto ILIKE '%' || ? || '%'
              OR COALESCE(c.nombre, '') ILIKE '%' || ? || '%'
              OR COALESCE(co.serie, '') ILIKE '%' || ? || '%'
              OR CAST(co.numero AS TEXT) ILIKE '%' || ? || '%')
       ORDER BY co.creado_en DESC LIMIT 500`,
      [estado, estado, q, q, q, q, q]
    );
    return ok(res, rows.map((r) => ({ ...r, monto: num(r.monto), numero: num(r.numero) })));
  });

  api.post('/comprobantes', async (req, res) => {
    const { cliente_id, pedido_id, concepto, monto, metodo_pago, fecha, notas, tipo } = req.body || {};
    if (!cliente_id) return bad(res, 'El cliente es obligatorio');
    if (!concepto || !String(concepto).trim()) return bad(res, 'El concepto es obligatorio');
    if (num(monto) <= 0) return bad(res, 'El monto debe ser mayor a cero');
    const conf = TIPOS_COMPROBANTE.find((t) => t.tipo === tipo) || TIPOS_COMPROBANTE[0];
    const { rows: cli } = await query(`SELECT id FROM clientes WHERE id = ?`, [cliente_id]);
    if (!cli.length) return bad(res, 'Cliente no encontrado', 404);
    if (pedido_id) {
      const { rows: ped } = await query(`SELECT id FROM pedidos WHERE id = ?`, [pedido_id]);
      if (!ped.length) return bad(res, 'Pedido no encontrado', 404);
    }
    const ts = now();
    const { rows: prev } = await query(
      `SELECT COALESCE(MAX(numero), 0) AS n FROM comprobantes WHERE serie = ?`,
      [conf.serie]
    );
    const numero = num(prev[0].n) + 1;
    const { rows } = await query(
      `INSERT INTO comprobantes (id, numero, serie, tipo, cliente_id, pedido_id, concepto, monto, metodo_pago, fecha, estado, notas, creado_en, actualizado_en)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pagado', ?, ?, ?) RETURNING *`,
      [uuid(), numero, conf.serie, conf.tipo, cliente_id, pedido_id || null, String(concepto).trim(), num(monto),
       metodo_pago || null, String(fecha || ts).slice(0, 10), notas || null, ts, ts]
    );
    return ok(res, { ...rows[0], monto: num(rows[0].monto), numero });
  });

  api.get('/comprobantes/:id', async (req, res) => {
    const { rows } = await query(
      `SELECT co.*, c.nombre AS cliente_nombre, c.documento AS cliente_documento, c.email AS cliente_email, c.telefono AS cliente_telefono, c.direccion AS cliente_direccion,
        p.titulo AS pedido_titulo
       FROM comprobantes co
       LEFT JOIN clientes c ON c.id = co.cliente_id
       LEFT JOIN pedidos p ON p.id = co.pedido_id
       WHERE co.id = ?`,
      [req.params.id]
    );
    if (!rows.length) return bad(res, 'Comprobante no encontrado', 404);
    return ok(res, { ...rows[0], monto: num(rows[0].monto), numero: num(rows[0].numero) });
  });

  api.patch('/comprobantes/:id', async (req, res) => {
    const { rows } = await query(`SELECT * FROM comprobantes WHERE id = ?`, [req.params.id]);
    if (!rows.length) return bad(res, 'Comprobante no encontrado', 404);
    const co = rows[0];
    const body = req.body || {};
    const estado = body.estado ?? co.estado;
    if (!['pagado', 'anulado'].includes(estado)) return bad(res, 'Estado inválido');

    let tipo = co.tipo;
    let serie = co.serie;
    let numero = num(co.numero);
    if (body.tipo && body.tipo !== co.tipo) {
      const conf = TIPOS_COMPROBANTE.find((t) => t.tipo === body.tipo);
      if (!conf) return bad(res, 'Tipo de comprobante inválido');
      tipo = conf.tipo;
      serie = conf.serie;
      const { rows: prev } = await query(
        `SELECT COALESCE(MAX(numero), 0) AS n FROM comprobantes WHERE serie = ? AND id != ?`,
        [serie, co.id]
      );
      numero = num(prev[0].n) + 1;
    }

    let pedidoId = co.pedido_id;
    if (body.pedido_id !== undefined) {
      pedidoId = body.pedido_id || null;
      if (pedidoId) {
        const { rows: ped } = await query(`SELECT id FROM pedidos WHERE id = ?`, [pedidoId]);
        if (!ped.length) return bad(res, 'Pedido no encontrado', 404);
      }
    }

    let motivo = co.motivo_anulacion;
    if (body.motivo_anulacion !== undefined) {
      motivo = String(body.motivo_anulacion || '').trim() || null;
    }
    if (body.estado === 'pagado') motivo = null;
    if (estado === 'anulado' && !motivo) return bad(res, 'Indica el motivo de anulación');

    const upd = await query(
      `UPDATE comprobantes SET numero = ?, serie = ?, tipo = ?, pedido_id = ?, concepto = ?, monto = ?, metodo_pago = ?, fecha = ?, estado = ?, notas = ?, motivo_anulacion = ?, actualizado_en = ?
       WHERE id = ? RETURNING *`,
      [
        numero, serie, tipo, pedidoId,
        body.concepto != null ? String(body.concepto).trim() : co.concepto,
        body.monto != null ? num(body.monto) : num(co.monto),
        body.metodo_pago != null ? body.metodo_pago : co.metodo_pago,
        body.fecha != null ? String(body.fecha).slice(0, 10) : co.fecha,
        estado,
        body.notas != null ? body.notas : co.notas,
        motivo,
        now(),
        req.params.id,
      ]
    );
    return ok(res, { ...upd.rows[0], monto: num(upd.rows[0].monto), numero: num(upd.rows[0].numero) });
  });

  api.delete('/comprobantes/:id', async (req, res) => {
    await query(`DELETE FROM comprobantes WHERE id = ?`, [req.params.id]);
    return ok(res, {});
  });

  return api;
}
