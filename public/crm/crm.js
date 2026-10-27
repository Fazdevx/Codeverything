(function () {
  'use strict';

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  const loginScreen = $('#loginScreen');
  const appShell = $('#appShell');
  const view = $('#view');
  const pageTitle = $('#pageTitle');

  const TITULOS = {
    dashboard: 'Dashboard',
    clientes: 'Clientes',
    leads: 'Leads',
    servicios: 'Servicios',
    pedidos: 'Pedidos',
    presupuestos: 'Presupuestos',
    comprobantes: 'Comprobantes',
    empresa: 'Mi empresa',
  };

  const BADGES = {
    nuevo: 'blue',
    contactado: 'amber',
    convertido: 'green',
    rechazado: 'red',
    pendiente: 'amber',
    'en proceso': 'blue',
    entregado: 'green',
    cancelado: 'gray',
    borrador: 'gray',
    enviado: 'blue',
    aprobado: 'green',
    pagado: 'dark',
  };

  let charts = [];
  let clientesCache = [];
  let serviciosCache = [];

  /* ---------- Helpers ---------- */

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  function money(n) {
    return 'S/ ' + Number(n || 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function fdate(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    return isNaN(d) ? String(iso).slice(0, 10) : d.toLocaleDateString('es-PE');
  }

  function badge(estado) {
    const color = BADGES[estado] || 'gray';
    return `<span class="badge ${color}">${esc(estado)}</span>`;
  }

  function waLink(telefono) {
    let digits = String(telefono || '').replace(/\D/g, '');
    if (digits.length < 6) return null;
    if (digits.startsWith('0')) digits = digits.slice(1);
    if (!digits.startsWith('51')) digits = '51' + digits;
    return 'https://wa.me/' + digits;
  }

  /* ---------- Paginación ---------- */

  const PAGE_SIZE = 25;

  function paginar(rows, page) {
    const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
    const p = Math.min(Math.max(0, page), pages - 1);
    return { page: p, pages, total: rows.length, slice: rows.slice(p * PAGE_SIZE, p * PAGE_SIZE + PAGE_SIZE) };
  }

  function pagerHtml(info) {
    if (!info.total || info.pages <= 1) return '';
    return `
      <div class="pager">
        <button class="btn btn-ghost btn-sm" data-page="${info.page - 1}" ${info.page === 0 ? 'disabled' : ''}>Anterior</button>
        <span class="pager-info">${info.page + 1} / ${info.pages}</span>
        <button class="btn btn-ghost btn-sm" data-page="${info.page + 1}" ${info.page === info.pages - 1 ? 'disabled' : ''}>Siguiente</button>
        <span class="pager-info">${info.total} registro(s)</span>
      </div>`;
  }

  function bindPager(root, setPage) {
    $$('[data-page]', root).forEach((b) => b.addEventListener('click', () => setPage(Number(b.dataset.page))));
  }

  function exportCsv(filename, rows, columns) {
    const head = columns.map((c) => `"${c.label}"`).join(';');
    const lines = rows.map((r) =>
      columns.map((c) => `"${String(r[c.key] == null ? '' : r[c.key]).replace(/"/g, '""')}"`).join(';')
    ).join('\r\n');
    const blob = new Blob(['\ufeff' + head + '\r\n' + lines], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(a.href);
    toast('Archivo CSV descargado');
  }

  async function api(path, opts) {
    opts = opts || {};
    const init = {
      method: opts.method || 'GET',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
    };
    if (opts.body != null) init.body = JSON.stringify(opts.body);
    const res = await fetch('/api' + path, init);
    let json = null;
    try { json = await res.json(); } catch (e) { /* sin body */ }
    if (res.status === 401) {
      showLogin();
      throw new Error('No autenticado');
    }
    if (!res.ok || !json || !json.ok) {
      throw new Error((json && json.error) || 'Error inesperado');
    }
    return json.data;
  }

  let toastTimer = null;
  function toast(msg, isError) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.toggle('error', Boolean(isError));
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 3200);
  }

  /* ---------- Modal ---------- */

  const overlay = $('#modalOverlay');
  const modalForm = $('#modalForm');
  let modalOnSubmit = null;

  function openModal({ title, html, submitLabel, onSubmit }) {
    $('#modalTitle').textContent = title;
    $('#modalBody').innerHTML = html;
    $('#modalSubmit').textContent = submitLabel || 'Guardar';
    modalOnSubmit = onSubmit || null;
    overlay.classList.remove('hidden');
    setTimeout(() => {
      const first = $('#modalBody input, #modalBody select, #modalBody textarea');
      if (first) first.focus();
    }, 50);
  }

  function closeModal() {
    overlay.classList.add('hidden');
    $('#modalBody').innerHTML = '';
    modalOnSubmit = null;
  }

  $('#modalClose').addEventListener('click', closeModal);
  $('#modalCancel').addEventListener('click', closeModal);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });

  modalForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!modalOnSubmit) return closeModal();
    const btn = $('#modalSubmit');
    btn.disabled = true;
    try {
      await modalOnSubmit(new FormData(modalForm), modalForm);
    } catch (err) {
      toast(err.message || 'Error', true);
    } finally {
      btn.disabled = false;
    }
  });

  /* ---------- Auth ---------- */

  function showLogin() {
    appShell.classList.add('hidden');
    loginScreen.classList.remove('hidden');
    stopLeadsBadge();
  }

  function showApp(usuario) {
    loginScreen.classList.add('hidden');
    appShell.classList.remove('hidden');
    $('#sidebarUser').textContent = 'Sesión de ' + usuario;
    startLeadsBadge();
  }

  /* ---------- Badge de leads nuevos ---------- */

  let leadsBadgeTimer = null;

  async function refreshLeadsBadge() {
    const el = $('#leadsBadge');
    if (!el) return;
    try {
      const leads = await api('/leads?estado=nuevo');
      el.textContent = String(leads.length);
      el.classList.toggle('hidden', !leads.length);
    } catch (e) {
      /* sin sesión o error de red: no bloquea la app */
    }
  }

  function startLeadsBadge() {
    stopLeadsBadge();
    refreshLeadsBadge();
    leadsBadgeTimer = setInterval(refreshLeadsBadge, 60000);
  }

  function stopLeadsBadge() {
    if (leadsBadgeTimer) clearInterval(leadsBadgeTimer);
    leadsBadgeTimer = null;
    const el = $('#leadsBadge');
    if (el) el.classList.add('hidden');
  }

  $('#loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = $('#loginMsg');
    msg.textContent = '';
    try {
      const data = await api('/auth/login', {
        method: 'POST',
        body: { usuario: $('#loginUser').value.trim(), contrasena: $('#loginPass').value },
      });
      showApp(data.usuario);
      if (!location.hash || location.hash === '#/') location.hash = '#/dashboard';
      navigate();
    } catch (err) {
      msg.textContent = err.message;
    }
  });

  $('#logoutBtn').addEventListener('click', async () => {
    try { await api('/auth/logout', { method: 'POST' }); } catch (e) { /* idem */ }
    showLogin();
  });

  /* ---------- Buscador global ---------- */

  let searchTimer = null;

  function searchItemHtml(hash, titulo, sub) {
    return `<a class="search-item" href="${hash}"><span>${esc(titulo)}</span><span class="pager-info">${esc(sub)}</span></a>`;
  }

  async function globalSearch(q) {
    const panel = $('#searchPanel');
    panel.classList.remove('hidden');
    panel.innerHTML = '<div class="search-empty">Buscando…</div>';
    try {
      const [clientes, pedidos, comprobantes] = await Promise.all([
        api('/clientes?q=' + encodeURIComponent(q)),
        api('/pedidos?q=' + encodeURIComponent(q)),
        api('/comprobantes?q=' + encodeURIComponent(q)),
      ]);
      const grupos = [];
      if (clientes.length) {
        grupos.push(['Clientes', clientes.slice(0, 5)
          .map((c) => searchItemHtml('#/clientes/' + c.id, c.nombre, c.documento || c.email || ''))]);
      }
      if (pedidos.length) {
        grupos.push(['Pedidos', pedidos.slice(0, 5)
          .map((p) => searchItemHtml('#/pedidos/' + p.id, p.titulo, p.cliente_nombre || ''))]);
      }
      if (comprobantes.length) {
        grupos.push(['Comprobantes', comprobantes.slice(0, 5)
          .map((c) => searchItemHtml('#/comprobantes/' + c.id, numComprobante(c), c.cliente_nombre || ''))]);
      }
      panel.innerHTML = grupos.length
        ? grupos.map(([titulo, items]) => `<div class="search-group-title">${titulo}</div>${items.join('')}`).join('')
        : `<div class="search-empty">Sin resultados para “${esc(q)}”</div>`;
      $$('.search-item', panel).forEach((a) => a.addEventListener('click', () => {
        panel.classList.add('hidden');
        $('#globalSearch').value = '';
      }));
    } catch (err) {
      panel.innerHTML = `<div class="search-empty">${esc(err.message)}</div>`;
    }
  }

  $('#globalSearch').addEventListener('input', (e) => {
    const q = e.target.value.trim();
    clearTimeout(searchTimer);
    if (q.length < 2) {
      $('#searchPanel').classList.add('hidden');
      return;
    }
    searchTimer = setTimeout(() => globalSearch(q), 300);
  });

  $('#globalSearch').addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      $('#searchPanel').classList.add('hidden');
      e.target.blur();
    }
    if (e.key === 'Enter') {
      const first = $('#searchPanel .search-item');
      if (first) {
        e.preventDefault();
        first.click();
      }
    }
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('#topbarSearch')) $('#searchPanel').classList.add('hidden');
  });

  /* ---------- Router ---------- */

  function parseHash() {
    const raw = (location.hash || '').replace(/^#\/?/, '');
    const parts = raw.split('/');
    const name = TITULOS[parts[0]] ? parts[0] : 'dashboard';
    return { name, id: parts[1] || null };
  }

  async function navigate() {
    const { name, id } = parseHash();
    charts.forEach((c) => c.destroy());
    charts = [];
    pageTitle.textContent = TITULOS[name];
    $$('.sidebar-nav a').forEach((a) => {
      a.classList.toggle('active', a.getAttribute('data-route') === name);
    });
    setSidebar(false);
    const panel = $('#searchPanel');
    if (panel) panel.classList.add('hidden');
    view.innerHTML = '<div class="empty">Cargando…</div>';
    try {
      if (name === 'clientes' && id) return await renderClienteDetalle(id);
      if (name === 'presupuestos' && id) return await renderPresupuestoDetalle(id);
      if (name === 'comprobantes' && id) return await renderComprobanteDetalle(id);
      if (name === 'pedidos' && id) return await renderPedidoDetalle(id);
      await ({
        dashboard: renderDashboard,
        clientes: renderClientes,
        leads: renderLeads,
        servicios: renderServicios,
        pedidos: renderPedidos,
        presupuestos: renderPresupuestos,
        comprobantes: renderComprobantes,
        empresa: renderEmpresa,
      })[name]();
    } catch (err) {
      view.innerHTML = `<div class="empty"><strong>Ocurrió un error</strong>${esc(err.message)}</div>`;
    }
  }

  window.addEventListener('hashchange', navigate);

  function setSidebar(open) {
    $('#sidebar').classList.toggle('open', open);
    $('#sidebarOverlay').classList.toggle('hidden', !open);
  }

  $('#hamburger').addEventListener('click', () => setSidebar(!$('#sidebar').classList.contains('open')));
  $('#sidebarOverlay').addEventListener('click', () => setSidebar(false));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') setSidebar(false);
  });

  /* ---------- Dashboard ---------- */

  async function renderDashboard() {
    const d = await api('/dashboard');
    view.innerHTML = `
      <div class="stats">
        <div class="stat accent">
          <div class="stat-label">Ingresos del mes</div>
          <div class="stat-value">${money(d.ingresos.mes)}</div>
          <div class="stat-sub">${d.ingresos.entregados} pedido(s) entregado(s) · ${money(d.ingresos.porCobrar)} por cobrar</div>
        </div>
        <div class="stat">
          <div class="stat-label">Leads del mes</div>
          <div class="stat-value">${d.leads.mes}</div>
          <div class="stat-sub">${d.leads.total} en total</div>
        </div>
        <div class="stat">
          <div class="stat-label">Clientes</div>
          <div class="stat-value">${d.clientes.total}</div>
          <div class="stat-sub">${d.clientes.mes} nuevo(s) este mes</div>
        </div>
        <div class="stat">
          <div class="stat-label">Pedidos activos</div>
          <div class="stat-value">${d.pedidos.activos}</div>
          <div class="stat-sub">pendientes y en proceso</div>
        </div>
      </div>

      <div class="charts">
        <div class="card chart-card">
          <h3>Ingresos — últimos 6 meses</h3>
          <div class="chart-wrap"><canvas id="chartIngresos"></canvas></div>
        </div>
        <div class="card chart-card">
          <h3>Servicios más pedidos</h3>
          <div class="chart-wrap"><canvas id="chartTop"></canvas></div>
        </div>
      </div>

      <div class="dash-lists">
        <div class="card">
          <h3 class="section-title">Últimos leads</h3>
          <div class="list-card">
            ${d.leadsRecientes.length ? d.leadsRecientes.map((l) => `
              <div class="list-item">
                <div class="grow">
                  <div class="name">${esc(l.nombre)}</div>
                  <div class="sub">${esc(l.servicio || l.email || '')}</div>
                </div>
                ${badge(l.estado)}
              </div>`).join('') : '<div class="empty">Sin leads todavía.</div>'}
          </div>
        </div>
        <div class="card">
          <h3 class="section-title">Últimos pedidos</h3>
          <div class="list-card">
            ${d.pedidos.recientes.length ? d.pedidos.recientes.map((p) => `
              <div class="list-item">
                <div class="grow">
                  <div class="name">${esc(p.titulo)}</div>
                  <div class="sub">${esc(p.cliente_nombre || '')} · ${money(p.precio)}</div>
                </div>
                ${badge(p.estado)}
              </div>`).join('') : '<div class="empty">Sin pedidos todavía.</div>'}
          </div>
        </div>
      </div>`;

    const colors = ['#6b73c9', '#8fa8e0', '#a5b0e8', '#4ade80', '#fbbf24'];
    const ctx1 = $('#chartIngresos');
    if (ctx1) {
      charts.push(new Chart(ctx1, {
        type: 'line',
        data: {
          labels: d.serie.map((m) => m.label),
          datasets: [{
            label: 'Ingresos',
            data: d.serie.map((m) => m.monto),
            borderColor: '#6b73c9',
            backgroundColor: 'rgba(107,115,201,0.12)',
            fill: true,
            tension: 0.35,
            pointBackgroundColor: '#6b73c9',
          }],
        },
        options: {
          maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: { y: { beginAtZero: true, ticks: { callback: (v) => money(v) } } },
        },
      }));
    }
    const ctx2 = $('#chartTop');
    if (ctx2) {
      const top = d.topServicios.length ? d.topServicios : [{ nombre: 'Sin datos', n: 1 }];
      charts.push(new Chart(ctx2, {
        type: 'doughnut',
        data: {
          labels: top.map((s) => s.nombre),
          datasets: [{
            data: top.map((s) => s.n),
            backgroundColor: colors,
            borderWidth: 0,
          }],
        },
        options: {
          maintainAspectRatio: false,
          plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, padding: 14 } } },
        },
      }));
    }
  }

  /* ---------- Clientes ---------- */

  function clienteFormHtml(c) {
    c = c || {};
    return `
      <div class="field"><label>Nombre y apellido / Razón social *</label>
        <input name="nombre" required value="${esc(c.nombre)}"></div>
      <div class="field-row">
        <div class="field"><label>Documento (DNI / RUC)</label><input name="documento" value="${esc(c.documento)}" placeholder="Ej: 74586932 o 20601234567"></div>
        <div class="field"><label>Email</label><input type="email" name="email" value="${esc(c.email)}"></div>
      </div>
      <div class="field-row">
        <div class="field"><label>Teléfono</label><input name="telefono" value="${esc(c.telefono)}" placeholder="Ej: 987 654 321"></div>
        <div class="field"><label>Dirección</label><input name="direccion" value="${esc(c.direccion)}"></div>
      </div>
      <div class="field"><label>Notas</label><textarea name="notas" rows="3">${esc(c.notas)}</textarea></div>`;
  }

  function readClienteForm(fd) {
    return {
      nombre: String(fd.get('nombre') || '').trim(),
      documento: String(fd.get('documento') || '').trim() || null,
      email: String(fd.get('email') || '').trim() || null,
      telefono: String(fd.get('telefono') || '').trim() || null,
      direccion: String(fd.get('direccion') || '').trim() || null,
      notas: String(fd.get('notas') || '').trim() || null,
    };
  }

  async function renderClientes() {
    view.innerHTML = `
      <div class="toolbar">
        <input class="input input-search" id="clienteSearch" placeholder="Buscar por nombre, email o teléfono…">
        <button class="btn btn-ghost btn-sm" id="btnExportClientes">Exportar CSV</button>
        <div class="spacer"></div>
        <button class="btn btn-primary" id="btnNuevoCliente">+ Nuevo cliente</button>
      </div>
      <div id="clientesTable"></div>`;

    const table = $('#clientesTable');
    let page = 0;

    async function load(q) {
      clientesCache = await api('/clientes' + (q ? '?q=' + encodeURIComponent(q) : ''));
      if (!clientesCache.length) {
        table.innerHTML = '<div class="card empty"><strong>Sin clientes</strong>Crea el primer cliente con el botón "+ Nuevo cliente".</div>';
        return;
      }
      const info = paginar(clientesCache, page);
      page = info.page;
      table.innerHTML = `
        <div class="table-wrap"><table>
          <thead><tr><th>Nombre</th><th>Contacto</th><th>Pedidos</th><th>Presupuestos</th><th>Registro</th><th></th></tr></thead>
          <tbody>${info.slice.map((c) => `
            <tr>
              <td><strong>${esc(c.nombre)}</strong>${c.documento ? `<div class="muted">${esc(c.documento)}</div>` : ''}</td>
              <td class="muted">${esc(c.email || '—')}<br>${esc(c.telefono || '')}</td>
              <td>${c.pedidos}</td>
              <td>${c.presupuestos}</td>
              <td class="muted">${fdate(c.creado_en)}</td>
              <td><div class="row-actions">
                <button class="icon-btn" data-ver="${c.id}">Ver</button>
                <button class="icon-btn" data-editar="${c.id}">Editar</button>
                <button class="icon-btn danger" data-borrar="${c.id}">Borrar</button>
              </div></td>
            </tr>`).join('')}
          </tbody>
        </table></div>` + pagerHtml(info);

      bindPager(table, (p) => { page = p; load($('#clienteSearch').value.trim()); });
      $$('[data-ver]', table).forEach((b) => b.addEventListener('click', () => { location.hash = '#/clientes/' + b.dataset.ver; }));
      $$('[data-editar]', table).forEach((b) => b.addEventListener('click', () => {
        const c = clientesCache.find((x) => x.id === b.dataset.editar);
        openModal({
          title: 'Editar cliente',
          html: clienteFormHtml(c),
          onSubmit: async (fd) => {
            await api('/clientes/' + c.id, { method: 'PUT', body: readClienteForm(fd) });
            closeModal();
            toast('Cliente actualizado');
            load($('#clienteSearch').value.trim());
          },
        });
      }));
      $$('[data-borrar]', table).forEach((b) => b.addEventListener('click', async () => {
        if (!confirm('¿Borrar este cliente? Sus pedidos y presupuestos también se eliminarán.')) return;
        await api('/clientes/' + b.dataset.borrar, { method: 'DELETE' });
        toast('Cliente eliminado');
        load($('#clienteSearch').value.trim());
      }));
    }

    let t = null;
    $('#clienteSearch').addEventListener('input', (e) => {
      clearTimeout(t);
      page = 0;
      t = setTimeout(() => load(e.target.value.trim()), 250);
    });
    $('#btnExportClientes').addEventListener('click', () => {
      if (!clientesCache.length) return toast('No hay clientes para exportar', true);
      exportCsv('clientes.csv', clientesCache, [
        { key: 'nombre', label: 'Nombre' },
        { key: 'documento', label: 'DNI/RUC' },
        { key: 'email', label: 'Email' },
        { key: 'telefono', label: 'Teléfono' },
        { key: 'direccion', label: 'Dirección' },
        { key: 'notas', label: 'Notas' },
        { key: 'creado_en', label: 'Fecha de registro' },
      ]);
    });
    $('#btnNuevoCliente').addEventListener('click', () => {
      openModal({
        title: 'Nuevo cliente',
        html: clienteFormHtml(null),
        onSubmit: async (fd) => {
          await api('/clientes', { method: 'POST', body: readClienteForm(fd) });
          closeModal();
          toast('Cliente creado');
          load($('#clienteSearch').value.trim());
        },
      });
    });

    await load('');
  }

  async function renderClienteDetalle(id) {
    const c = await api('/clientes/' + id);
    view.innerHTML = `
      <div class="toolbar">
        <button class="btn btn-ghost btn-sm" onclick="location.hash='#/clientes'">← Volver</button>
        <div class="spacer"></div>
        <button class="btn btn-primary btn-sm" id="btnEditCliente">Editar</button>
      </div>
      <div class="detail-grid">
        <div class="card detail-info">
          <h3>${esc(c.nombre)}</h3>
          <span class="muted">Cliente desde ${fdate(c.creado_en)}</span>
          <div class="detail-list">
            <div class="detail-row"><span>Documento</span><span>${esc(c.documento || '—')}</span></div>
            <div class="detail-row"><span>Email</span><span>${esc(c.email || '—')}</span></div>
            <div class="detail-row"><span>Teléfono</span><span>${esc(c.telefono || '—')}</span></div>
            <div class="detail-row"><span>Dirección</span><span>${esc(c.direccion || '—')}</span></div>
            <div class="detail-row"><span>Notas</span><span>${esc(c.notas || '—')}</span></div>
          </div>
        </div>
        <div>
          <div class="card" style="margin-bottom:16px">
            <h3 class="section-title">Pedidos (${c.pedidos.length})</h3>
            ${c.pedidos.length ? `<div class="table-wrap"><table>
              <thead><tr><th>Título</th><th>Servicio</th><th>Precio</th><th>Estado</th></tr></thead>
              <tbody>${c.pedidos.map((p) => `<tr>
                <td><button class="icon-btn" data-ver-pedido="${p.id}">${esc(p.titulo)}</button></td><td class="muted">${esc(p.servicio_nombre || '—')}</td>
                <td>${money(p.precio)}</td><td>${badge(p.estado)}</td></tr>`).join('')}</tbody>
            </table></div>` : '<div class="empty">Sin pedidos.</div>'}
          </div>
          <div class="card" style="margin-bottom:16px">
            <h3 class="section-title">Presupuestos (${c.presupuestos.length})</h3>
            ${c.presupuestos.length ? `<div class="table-wrap"><table>
              <thead><tr><th>N°</th><th>Total</th><th>Estado</th><th>Fecha</th></tr></thead>
              <tbody>${c.presupuestos.map((p) => `<tr>
                <td><button class="icon-btn" data-ver-presu="${p.id}">#${p.numero}</button></td><td>${money(p.total)}</td>
                <td>${badge(p.estado)}</td><td class="muted">${fdate(p.creado_en)}</td></tr>`).join('')}</tbody>
            </table></div>` : '<div class="empty">Sin presupuestos.</div>'}
          </div>
          <div class="card">
            <h3 class="section-title">Comprobantes (${c.comprobantes.length})</h3>
            ${c.comprobantes.length ? `<div class="table-wrap"><table>
              <thead><tr><th>Comprobante</th><th>Concepto</th><th>Monto</th><th>Estado</th></tr></thead>
              <tbody>${c.comprobantes.map((co) => `<tr>
                <td><button class="icon-btn" data-ver-comprob="${co.id}">${numComprobante(co)}</button></td>
                <td class="muted">${esc(co.concepto)}</td>
                <td>${money(co.monto)}</td><td>${badge(co.estado)}</td></tr>`).join('')}</tbody>
            </table></div>` : '<div class="empty">Sin comprobantes.</div>'}
          </div>
        </div>
      </div>`;

    $$('[data-ver-pedido]').forEach((b) => b.addEventListener('click', () => { location.hash = '#/pedidos/' + b.dataset.verPedido; }));
    $$('[data-ver-presu]').forEach((b) => b.addEventListener('click', () => { location.hash = '#/presupuestos/' + b.dataset.verPresu; }));
    $$('[data-ver-comprob]').forEach((b) => b.addEventListener('click', () => { location.hash = '#/comprobantes/' + b.dataset.verComprob; }));

    $('#btnEditCliente').addEventListener('click', () => {
      openModal({
        title: 'Editar cliente',
        html: clienteFormHtml(c),
        onSubmit: async (fd) => {
          await api('/clientes/' + c.id, { method: 'PUT', body: readClienteForm(fd) });
          closeModal();
          toast('Cliente actualizado');
          navigate();
        },
      });
    });
  }

  /* ---------- Leads ---------- */

  async function renderLeads() {
    view.innerHTML = `
      <div class="toolbar">
        <div class="chips" id="leadChips">
          <button class="chip active" data-estado="">Todos</button>
          <button class="chip" data-estado="nuevo">Nuevos</button>
          <button class="chip" data-estado="contactado">Contactados</button>
          <button class="chip" data-estado="convertido">Convertidos</button>
          <button class="chip" data-estado="rechazado">Rechazados</button>
        </div>
        <button class="btn btn-ghost btn-sm" id="btnExportLeads">Exportar CSV</button>
        <div class="spacer"></div>
        <button class="btn btn-primary" id="btnNuevoLead">+ Nuevo lead</button>
      </div>
      <div id="leadsTable"></div>`;

    const table = $('#leadsTable');
    let estado = '';
    let page = 0;
    let leadsCache = [];

    async function load() {
      const leads = await api('/leads' + (estado ? '?estado=' + estado : ''));
      leadsCache = leads;
      if (!leads.length) {
        table.innerHTML = '<div class="card empty"><strong>Sin leads</strong>Los contactos del formulario web aparecen acá automáticamente.</div>';
        return;
      }
      const info = paginar(leads, page);
      page = info.page;
      table.innerHTML = `
        <div class="table-wrap"><table>
          <thead><tr><th>Nombre</th><th>Contacto</th><th>Servicio</th><th>Estado</th><th>Fecha</th><th></th></tr></thead>
          <tbody>${info.slice.map((l) => `
            <tr>
              <td><strong>${esc(l.nombre)}</strong></td>
              <td class="muted">${esc(l.email || '—')}<br>${esc(l.telefono || '')}</td>
              <td class="muted">${esc(l.servicio || '—')}</td>
              <td>${badge(l.estado)}</td>
              <td class="muted">${fdate(l.creado_en)}</td>
              <td><div class="row-actions">
                ${waLink(l.telefono) ? `<a class="icon-btn wa-btn" href="${waLink(l.telefono)}?text=${encodeURIComponent('Hola ' + l.nombre + ', gracias por contactar a CodeEverything.')}" target="_blank" rel="noopener">WhatsApp</a>` : ''}
                ${l.estado !== 'convertido' && l.estado !== 'rechazado' ? `
                  <button class="icon-btn" data-convertir="${l.id}">Convertir</button>
                  <button class="icon-btn" data-contactado="${l.id}">Contactado</button>
                  <button class="icon-btn danger" data-rechazar="${l.id}">Rechazar</button>` : ''}
                <button class="icon-btn" data-ver="${l.id}">Ver</button>
              </div></td>
            </tr>`).join('')}
          </tbody>
        </table></div>` + pagerHtml(info);

      bindPager(table, (p) => { page = p; load(); });
      refreshLeadsBadge();

      const patch = async (id, body, msg) => {
        await api('/leads/' + id, { method: 'PATCH', body });
        toast(msg);
        load();
      };

      $$('[data-convertir]', table).forEach((b) => b.addEventListener('click', async () => {
        if (!confirm('¿Convertir este lead en cliente?')) return;
        await api('/leads/' + b.dataset.convertir + '/convertir', { method: 'POST', body: {} });
        toast('Lead convertido en cliente');
        load();
      }));
      $$('[data-contactado]', table).forEach((b) => b.addEventListener('click', () => patch(b.dataset.contactado, { estado: 'contactado' }, 'Marcado como contactado')));
      $$('[data-rechazar]', table).forEach((b) => b.addEventListener('click', () => patch(b.dataset.rechazar, { estado: 'rechazado' }, 'Lead rechazado')));
      $$('[data-ver]', table).forEach((b) => b.addEventListener('click', () => {
        const l = leads.find((x) => x.id === b.dataset.ver);
        openModal({
          title: 'Detalle del lead',
          html: `
            <div class="detail-list">
              <div class="detail-row"><span>Nombre</span><span>${esc(l.nombre)}</span></div>
              <div class="detail-row"><span>Email</span><span>${esc(l.email || '—')}</span></div>
              <div class="detail-row"><span>Teléfono</span><span>${esc(l.telefono || '—')}</span></div>
              <div class="detail-row"><span>Servicio</span><span>${esc(l.servicio || '—')}</span></div>
              <div class="detail-row"><span>Mensaje</span><span>${esc(l.mensaje || '—')}</span></div>
            </div>
            <div class="field"><label>Notas internas</label><textarea name="notas" rows="3">${esc(l.notas)}</textarea></div>`,
          onSubmit: async (fd) => {
            await api('/leads/' + l.id, { method: 'PATCH', body: { notas: String(fd.get('notas') || '') } });
            closeModal();
            toast('Lead actualizado');
            load();
          },
        });
      }));
    }

    $$('#leadChips .chip').forEach((chip) => chip.addEventListener('click', () => {
      $$('#leadChips .chip').forEach((c) => c.classList.remove('active'));
      chip.classList.add('active');
      estado = chip.dataset.estado;
      page = 0;
      load();
    }));

    $('#btnExportLeads').addEventListener('click', () => {
      if (!leadsCache.length) return toast('No hay leads para exportar', true);
      exportCsv('leads.csv', leadsCache, [
        { key: 'nombre', label: 'Nombre' },
        { key: 'email', label: 'Email' },
        { key: 'telefono', label: 'Teléfono' },
        { key: 'servicio', label: 'Servicio' },
        { key: 'estado', label: 'Estado' },
        { key: 'mensaje', label: 'Mensaje' },
        { key: 'creado_en', label: 'Fecha' },
      ]);
    });

    $('#btnNuevoLead').addEventListener('click', () => {
      openModal({
        title: 'Nuevo lead',
        html: `
          <div class="field"><label>Nombre *</label><input name="nombre" required></div>
          <div class="field-row">
            <div class="field"><label>Email</label><input type="email" name="email"></div>
            <div class="field"><label>Teléfono</label><input name="telefono"></div>
          </div>
          <div class="field"><label>Servicio</label><input name="servicio" placeholder="Ej: Instalación AutoCAD"></div>
          <div class="field"><label>Mensaje</label><textarea name="mensaje" rows="3"></textarea></div>`,
        onSubmit: async (fd) => {
          await api('/leads', {
            method: 'POST',
            body: {
              nombre: String(fd.get('nombre') || '').trim(),
              email: String(fd.get('email') || '').trim() || null,
              telefono: String(fd.get('telefono') || '').trim() || null,
              servicio: String(fd.get('servicio') || '').trim() || null,
              mensaje: String(fd.get('mensaje') || '').trim() || null,
            },
          });
          closeModal();
          toast('Lead creado');
          load();
        },
      });
    });

    await load();
  }

  /* ---------- Servicios ---------- */

  async function renderServicios() {
    view.innerHTML = `
      <div class="toolbar">
        <div class="spacer"></div>
        <button class="btn btn-primary" id="btnNuevoServicio">+ Nuevo servicio</button>
      </div>
      <div id="serviciosTable"></div>`;

    const table = $('#serviciosTable');
    let page = 0;

    async function load() {
      const servicios = await api('/servicios');
      serviciosCache = servicios;
      if (!servicios.length) {
        table.innerHTML = '<div class="card empty"><strong>Sin servicios</strong>Crea el primero con el botón "+ Nuevo servicio".</div>';
        return;
      }
      const info = paginar(servicios, page);
      page = info.page;
      table.innerHTML = `
        <div class="table-wrap"><table>
          <thead><tr><th>Servicio</th><th>Precio de referencia</th><th>Estado</th><th></th></tr></thead>
          <tbody>${info.slice.map((s) => `
            <tr>
              <td>
                <strong>${esc(s.nombre)}</strong>
                <div class="muted" style="max-width:520px;margin-top:4px">${esc(s.descripcion || '')}</div>
              </td>
              <td>${Number(s.precio) > 0 ? money(s.precio) : '<span class="muted">A consultar</span>'}</td>
              <td>${Number(s.activo) ? '<span class="badge green">Activo</span>' : '<span class="badge gray">Oculto</span>'}</td>
              <td><div class="row-actions">
                <button class="icon-btn" data-editar="${s.id}">Editar</button>
                <button class="icon-btn danger" data-borrar="${s.id}">Borrar</button>
              </div></td>
            </tr>`).join('')}
          </tbody>
        </table></div>
        <p class="muted" style="margin-top:14px">El precio de referencia se usa al crear pedidos. Déjalo en 0 para cotizar caso por caso.</p>` + pagerHtml(info);

      bindPager(table, (p) => { page = p; load(); });
      $$('[data-editar]', table).forEach((b) => b.addEventListener('click', () => {
        const s = servicios.find((x) => x.id === b.dataset.editar);
        openModal({
          title: 'Editar servicio',
          html: `
            <div class="field"><label>Nombre</label><input name="nombre" value="${esc(s.nombre)}"></div>
            <div class="field"><label>Descripción</label><textarea name="descripcion" rows="3">${esc(s.descripcion)}</textarea></div>
            <div class="field-row">
              <div class="field"><label>Precio de referencia</label><input type="number" step="0.01" min="0" name="precio" value="${s.precio}"></div>
              <div class="field"><label>Mostrar en pedidos</label>
                <select name="activo">
                  <option value="1" ${Number(s.activo) ? 'selected' : ''}>Activo</option>
                  <option value="0" ${!Number(s.activo) ? 'selected' : ''}>Oculto</option>
                </select>
              </div>
            </div>`,
          onSubmit: async (fd) => {
            await api('/servicios/' + s.id, {
              method: 'PUT',
              body: {
                nombre: String(fd.get('nombre') || '').trim() || s.nombre,
                descripcion: String(fd.get('descripcion') || '').trim(),
                precio: Number(fd.get('precio') || 0),
                activo: fd.get('activo') === '1',
              },
            });
            closeModal();
            toast('Servicio actualizado');
            load();
          },
        });
      }));

      $$('[data-borrar]', table).forEach((b) => b.addEventListener('click', async () => {
        if (!confirm('¿Borrar este servicio? Los pedidos que lo usan quedarán sin servicio.')) return;
        try {
          await api('/servicios/' + b.dataset.borrar, { method: 'DELETE' });
          toast('Servicio eliminado');
          load();
        } catch (err) {
          toast(err.message, true);
        }
      }));
    }

    $('#btnNuevoServicio').addEventListener('click', () => {
      openModal({
        title: 'Nuevo servicio',
        html: `
          <div class="field"><label>Nombre *</label><input name="nombre" required placeholder="Ej: Instalación de Windows 11"></div>
          <div class="field"><label>Descripción</label><textarea name="descripcion" rows="3" placeholder="Qué incluye el servicio"></textarea></div>
          <div class="field-row">
            <div class="field"><label>Precio de referencia</label><input type="number" step="0.01" min="0" name="precio" value="0"></div>
            <div class="field"><label>Mostrar en pedidos</label>
              <select name="activo">
                <option value="1">Activo</option>
                <option value="0">Oculto</option>
              </select>
            </div>
          </div>`,
        onSubmit: async (fd) => {
          const nombre = String(fd.get('nombre') || '').trim();
          if (!nombre) return toast('El nombre es obligatorio', true);
          await api('/servicios', {
            method: 'POST',
            body: {
              nombre,
              descripcion: String(fd.get('descripcion') || '').trim() || null,
              precio: Number(fd.get('precio') || 0),
              activo: fd.get('activo') === '1',
            },
          });
          closeModal();
          toast('Servicio creado');
          load();
        },
      });
    });

    await load();
  }

  /* ---------- Pedidos ---------- */

  async function loadClientesForSelect() {
    if (!clientesCache.length) clientesCache = await api('/clientes');
    return clientesCache;
  }

  async function loadServiciosForSelect() {
    if (!serviciosCache.length) serviciosCache = await api('/servicios?activos=1');
    return serviciosCache;
  }

  function opcionesClientes(clientes, selectedId) {
    return clientes.map((c) => `<option value="${c.id}" ${c.id === selectedId ? 'selected' : ''}>${esc(c.nombre)}</option>`).join('');
  }

  async function renderPedidos() {
    view.innerHTML = `
      <div class="toolbar">
        <select class="select" id="filtroEstado">
          <option value="">Todos los estados</option>
          <option>pendiente</option>
          <option>en proceso</option>
          <option>entregado</option>
          <option>cancelado</option>
        </select>
        <button class="btn btn-ghost btn-sm" id="btnExportPedidos">Exportar CSV</button>
        <div class="spacer"></div>
        <button class="btn btn-primary" id="btnNuevoPedido">+ Nuevo pedido</button>
      </div>
      <div id="pedidosTable"></div>`;

    const table = $('#pedidosTable');
    let pedidosCache = [];
    let page = 0;

    async function load() {
      const estado = $('#filtroEstado').value;
      const pedidos = await api('/pedidos' + (estado ? '?estado=' + encodeURIComponent(estado) : ''));
      pedidosCache = pedidos;
      if (!pedidos.length) {
        table.innerHTML = '<div class="card empty"><strong>Sin pedidos</strong>Crea el primer pedido asignando un servicio a un cliente.</div>';
        return;
      }
      const info = paginar(pedidos, page);
      page = info.page;
      table.innerHTML = `
        <div class="table-wrap"><table>
          <thead><tr><th>Pedido</th><th>Cliente</th><th>Servicio</th><th>Precio</th><th>Estado</th><th>Entrega</th><th></th></tr></thead>
          <tbody>${info.slice.map((p) => `
            <tr>
              <td><strong>${esc(p.titulo)}</strong><div class="muted">${fdate(p.fecha_pedido)}</div></td>
              <td>${esc(p.cliente_nombre || '—')}</td>
              <td class="muted">${esc(p.servicio_nombre || '—')}</td>
              <td>${money(p.precio)}</td>
              <td>
                <select class="select" data-estado-id="${p.id}" style="padding:6px 10px;font-size:0.82rem">
                  ${['pendiente', 'en proceso', 'entregado', 'cancelado'].map((e) => `<option ${e === p.estado ? 'selected' : ''}>${e}</option>`).join('')}
                </select>
              </td>
              <td class="muted">${p.fecha_entrega ? fdate(p.fecha_entrega) : '—'}</td>
              <td><div class="row-actions">
                <button class="icon-btn" data-ver="${p.id}">Ver</button>
                <button class="icon-btn" data-editar="${p.id}">Editar</button>
                <button class="icon-btn danger" data-borrar="${p.id}">Borrar</button>
              </div></td>
            </tr>`).join('')}
          </tbody>
        </table></div>` + pagerHtml(info);

      bindPager(table, (p) => { page = p; load(); });
      $$('[data-ver]', table).forEach((b) => b.addEventListener('click', () => { location.hash = '#/pedidos/' + b.dataset.ver; }));
      $$('[data-estado-id]', table).forEach((sel) => sel.addEventListener('change', async () => {
        try {
          await api('/pedidos/' + sel.dataset.estadoId, { method: 'PATCH', body: { estado: sel.value } });
          toast('Estado actualizado');
        } catch (err) {
          toast(err.message, true);
          navigate();
        }
      }));
      $$('[data-borrar]', table).forEach((b) => b.addEventListener('click', async () => {
        if (!confirm('¿Borrar este pedido?')) return;
        await api('/pedidos/' + b.dataset.borrar, { method: 'DELETE' });
        toast('Pedido eliminado');
        load();
      }));
      $$('[data-editar]', table).forEach((b) => b.addEventListener('click', async () => {
        const p = pedidos.find((x) => x.id === b.dataset.editar);
        const [clientes, servicios] = await Promise.all([loadClientesForSelect(), loadServiciosForSelect()]);
        openModal({
          title: 'Editar pedido',
          html: `
            <div class="field"><label>Cliente</label>
              <select name="cliente_id" disabled>${opcionesClientes(clientes, p.cliente_id)}</select></div>
            <div class="field"><label>Servicio</label>
              <select name="servicio_id">
                <option value="">— Sin servicio —</option>
                ${servicios.map((s) => `<option value="${s.id}" ${s.id === p.servicio_id ? 'selected' : ''}>${esc(s.nombre)}</option>`).join('')}
              </select></div>
            <div class="field"><label>Título *</label><input name="titulo" required value="${esc(p.titulo)}"></div>
            <div class="field"><label>Descripción</label><textarea name="descripcion" rows="2">${esc(p.descripcion)}</textarea></div>
            <div class="field-row">
              <div class="field"><label>Precio</label><input type="number" step="0.01" min="0" name="precio" value="${p.precio}"></div>
              <div class="field"><label>Estado</label>
                <select name="estado">${['pendiente', 'en proceso', 'entregado', 'cancelado'].map((e) => `<option ${e === p.estado ? 'selected' : ''}>${e}</option>`).join('')}</select>
              </div>
            </div>
            <div class="field"><label>Fecha de entrega</label><input type="date" name="fecha_entrega" value="${p.fecha_entrega ? String(p.fecha_entrega).slice(0, 10) : ''}"></div>`,
          onSubmit: async (fd) => {
            await api('/pedidos/' + p.id, {
              method: 'PATCH',
              body: {
                servicio_id: String(fd.get('servicio_id') || '') || null,
                titulo: String(fd.get('titulo') || '').trim(),
                descripcion: String(fd.get('descripcion') || '').trim() || null,
                precio: Number(fd.get('precio') || 0),
                estado: fd.get('estado'),
                fecha_entrega: String(fd.get('fecha_entrega') || '') || null,
              },
            });
            closeModal();
            toast('Pedido actualizado');
            load();
          },
        });
      }));
    }

    $('#filtroEstado').addEventListener('change', () => { page = 0; load(); });

    $('#btnExportPedidos').addEventListener('click', () => {
      if (!pedidosCache.length) return toast('No hay pedidos para exportar', true);
      exportCsv('pedidos.csv', pedidosCache, [
        { key: 'titulo', label: 'Título' },
        { key: 'cliente_nombre', label: 'Cliente' },
        { key: 'servicio_nombre', label: 'Servicio' },
        { key: 'precio', label: 'Precio' },
        { key: 'estado', label: 'Estado' },
        { key: 'fecha_pedido', label: 'Fecha de pedido' },
        { key: 'fecha_entrega', label: 'Entrega' },
      ]);
    });

    $('#btnNuevoPedido').addEventListener('click', async () => {
      const clientes = await loadClientesForSelect();
      if (!clientes.length) return toast('Primero crea un cliente', true);
      const servicios = await loadServiciosForSelect();
      openModal({
        title: 'Nuevo pedido',
        html: `
          <div class="field"><label>Cliente *</label>
            <select name="cliente_id" required><option value="">Selecciona…</option>${opcionesClientes(clientes)}</select></div>
          <div class="field"><label>Servicio</label>
            <select name="servicio_id" id="pedidoServicio">
              <option value="">— Sin servicio —</option>
              ${servicios.map((s) => `<option value="${s.id}" data-precio="${s.precio}">${esc(s.nombre)}</option>`).join('')}
            </select></div>
          <div class="field"><label>Título *</label><input name="titulo" required placeholder="Ej: Instalación de Office 2021"></div>
          <div class="field"><label>Descripción</label><textarea name="descripcion" rows="2"></textarea></div>
          <div class="field-row">
            <div class="field"><label>Precio (se completa solo con el servicio)</label><input type="number" step="0.01" min="0" name="precio" value="0"></div>
            <div class="field"><label>Fecha de entrega</label><input type="date" name="fecha_entrega"></div>
          </div>`,
        onSubmit: async (fd) => {
          await api('/pedidos', {
            method: 'POST',
            body: {
              cliente_id: fd.get('cliente_id'),
              servicio_id: String(fd.get('servicio_id') || '') || null,
              titulo: String(fd.get('titulo') || '').trim(),
              descripcion: String(fd.get('descripcion') || '').trim() || null,
              precio: Number(fd.get('precio') || 0),
              fecha_entrega: String(fd.get('fecha_entrega') || '') || null,
            },
          });
          closeModal();
          toast('Pedido creado');
          load();
        },
      });
      const sel = $('#pedidoServicio');
      const precioInput = $('#modalBody [name=precio]');
      sel.addEventListener('change', () => {
        const opt = sel.selectedOptions[0];
        const precio = Number((opt && opt.dataset.precio) || 0);
        if (precio > 0) precioInput.value = precio;
      });
    });

    await load();
  }

  async function renderPedidoDetalle(id) {
    const p = await api('/pedidos/' + id);

    view.innerHTML = `
      <div class="toolbar">
        <button class="btn btn-ghost btn-sm" onclick="location.hash='#/pedidos'">← Volver</button>
        <div class="spacer"></div>
        <button class="btn btn-primary btn-sm" id="btnPedidoComprobante">Emitir comprobante</button>
      </div>
      <div class="detail-grid">
        <div class="card detail-info">
          <h3>${esc(p.titulo)}</h3>
          <span class="muted">Pedido el ${fdate(p.fecha_pedido)}</span>
          <div class="detail-list">
            <div class="detail-row"><span>Estado</span><span>${badge(p.estado)}</span></div>
            <div class="detail-row"><span>Cliente</span><span>${esc(p.cliente_nombre || '—')}</span></div>
            <div class="detail-row"><span>Documento</span><span>${esc(p.cliente_documento || '—')}</span></div>
            <div class="detail-row"><span>Email</span><span>${esc(p.cliente_email || '—')}</span></div>
            <div class="detail-row"><span>Teléfono</span><span>${esc(p.cliente_telefono || '—')}</span></div>
            <div class="detail-row"><span>Servicio</span><span>${esc(p.servicio_nombre || '—')}</span></div>
            <div class="detail-row"><span>Precio</span><span>${money(p.precio)}</span></div>
            <div class="detail-row"><span>Fecha de entrega</span><span>${p.fecha_entrega ? fdate(p.fecha_entrega) : '—'}</span></div>
            <div class="detail-row"><span>Descripción</span><span>${esc(p.descripcion || '—')}</span></div>
          </div>
          <div style="margin-top:18px">
            <label class="muted" style="font-size:0.8rem;text-transform:uppercase;letter-spacing:0.05em">Cambiar estado</label>
            <select class="select" id="pedidoEstado" style="margin-top:6px">
              ${['pendiente', 'en proceso', 'entregado', 'cancelado'].map((e) => `<option ${e === p.estado ? 'selected' : ''}>${e}</option>`).join('')}
            </select>
          </div>
        </div>
        <div>
          <div class="card" style="margin-bottom:16px">
            <h3 class="section-title">Cliente</h3>
            <div class="detail-list">
              <div class="detail-row"><span>Nombre</span><span>${esc(p.cliente_nombre || '—')}</span></div>
              <div class="detail-row"><span>Contacto</span><span>${esc(p.cliente_telefono || p.cliente_email || '—')}</span></div>
              <div class="detail-row"><span>Dirección</span><span>${esc(p.cliente_direccion || '—')}</span></div>
            </div>
          </div>
          <div class="card">
            <h3 class="section-title">Comprobantes del pedido (${p.comprobantes.length})</h3>
            ${p.comprobantes.length ? `<div class="table-wrap"><table>
              <thead><tr><th>Comprobante</th><th>Tipo</th><th>Monto</th><th>Estado</th></tr></thead>
              <tbody>${p.comprobantes.map((c) => `<tr>
                <td><button class="icon-btn" data-ver-comprob="${c.id}">${numComprobante(c)}</button></td>
                <td class="muted">${esc(c.tipo || 'Boleta de Venta')}</td>
                <td>${money(c.monto)}</td>
                <td>${badge(c.estado)}</td></tr>`).join('')}</tbody>
            </table></div>` : '<div class="empty">Sin comprobantes vinculados.</div>'}
          </div>
        </div>
      </div>`;

    $('#pedidoEstado').addEventListener('change', async (e) => {
      await api('/pedidos/' + p.id, { method: 'PATCH', body: { estado: e.target.value } });
      toast('Estado actualizado');
    });
    $$('[data-ver-comprob]').forEach((b) => b.addEventListener('click', () => { location.hash = '#/comprobantes/' + b.dataset.verComprob; }));
    $('#btnPedidoComprobante').addEventListener('click', () => {
      abrirNuevoComprobante({
        cliente_id: p.cliente_id,
        pedido_id: p.id,
        concepto: p.titulo,
        monto: p.precio,
      });
    });
  }

  /* ---------- Presupuestos ---------- */

  function itemsEditorHtml(items) {
    items = items && items.length ? items : [{ descripcion: '', cantidad: 1, precio: 0 }];
    return `
      <div class="items-editor" id="itemsEditor">
        ${items.map((i) => itemRowHtml(i)).join('')}
      </div>
      <button type="button" class="btn btn-ghost btn-sm" id="addItem" style="align-self:flex-start">+ Agregar ítem</button>
      <div class="items-total"><span>Total</span><span id="itemsTotal">$ 0</span></div>`;
  }

  function itemRowHtml(i) {
    i = i || {};
    return `
      <div class="item-row">
        <input name="item_desc" placeholder="Descripción del servicio" value="${esc(i.descripcion)}" required>
        <input name="item_cant" type="number" min="0.01" step="0.01" value="${i.cantidad || 1}" title="Cantidad">
        <input name="item_precio" type="number" min="0" step="0.01" value="${i.precio || 0}" title="Precio unitario">
        <button type="button" class="item-remove" title="Quitar ítem">✕</button>
      </div>`;
  }

  function bindItemsEditor(root) {
    const editor = $('#itemsEditor', root);
    const totalEl = $('#itemsTotal', root);

    function recalc() {
      let total = 0;
      $$('.item-row', editor).forEach((row) => {
        const cant = Number($('[name=item_cant]', row).value) || 0;
        const precio = Number($('[name=item_precio]', row).value) || 0;
        total += cant * precio;
      });
      totalEl.textContent = money(total);
    }

    function bindRow(row) {
      $$('.item-remove', row).forEach((b) => b.addEventListener('click', () => {
        if ($$('.item-row', editor).length > 1) {
          row.remove();
          recalc();
        }
      }));
      $$('input', row).forEach((inp) => inp.addEventListener('input', recalc));
    }

    $$('.item-row', editor).forEach(bindRow);
    $('#addItem', root).addEventListener('click', () => {
      const div = document.createElement('div');
      div.innerHTML = itemRowHtml(null);
      const row = div.firstElementChild;
      editor.appendChild(row);
      bindRow(row);
      $('[name=item_desc]', row).focus();
    });
    recalc();
  }

  function readItems(root) {
    return $$('#itemsEditor .item-row', root).map((row) => ({
      descripcion: String($('[name=item_desc]', row).value || '').trim(),
      cantidad: Number($('[name=item_cant]', row).value) || 1,
      precio: Number($('[name=item_precio]', row).value) || 0,
    })).filter((i) => i.descripcion);
  }

  async function renderPresupuestos() {
    view.innerHTML = `
      <div class="toolbar">
        <select class="select" id="filtroPresu">
          <option value="">Todos los estados</option>
          <option>borrador</option><option>enviado</option><option>aprobado</option><option>pagado</option><option>rechazado</option>
        </select>
        <button class="btn btn-ghost btn-sm" id="btnExportPresupuestos">Exportar CSV</button>
        <div class="spacer"></div>
        <button class="btn btn-primary" id="btnNuevoPresu">+ Nuevo presupuesto</button>
      </div>
      <div id="presuTable"></div>`;

    const table = $('#presuTable');
    let presusCache = [];
    let page = 0;

    async function load() {
      const estado = $('#filtroPresu').value;
      const presus = await api('/presupuestos' + (estado ? '?estado=' + encodeURIComponent(estado) : ''));
      presusCache = presus;
      if (!presus.length) {
        table.innerHTML = '<div class="card empty"><strong>Sin presupuestos</strong>Crea el primero con el botón "+ Nuevo presupuesto".</div>';
        return;
      }
      const info = paginar(presus, page);
      page = info.page;
      table.innerHTML = `
        <div class="table-wrap"><table>
          <thead><tr><th>N°</th><th>Cliente</th><th>Ítems</th><th>Total</th><th>Estado</th><th>Fecha</th><th></th></tr></thead>
          <tbody>${info.slice.map((p) => `
            <tr>
              <td><strong>#${p.numero}</strong></td>
              <td>${esc(p.cliente_nombre || '—')}</td>
              <td class="muted">${p.items}</td>
              <td>${money(p.total)}</td>
              <td>
                <select class="select" data-estado-id="${p.id}" style="padding:6px 10px;font-size:0.82rem">
                  ${['borrador', 'enviado', 'aprobado', 'pagado', 'rechazado'].map((e) => `<option ${e === p.estado ? 'selected' : ''}>${e}</option>`).join('')}
                </select>
              </td>
              <td class="muted">${fdate(p.creado_en)}</td>
              <td><div class="row-actions">
                <button class="icon-btn" data-ver="${p.id}">Ver</button>
                <button class="icon-btn danger" data-borrar="${p.id}">Borrar</button>
              </div></td>
            </tr>`).join('')}
          </tbody>
        </table></div>` + pagerHtml(info);

      bindPager(table, (p) => { page = p; load(); });
      $$('[data-estado-id]', table).forEach((sel) => sel.addEventListener('change', async () => {
        try {
          await api('/presupuestos/' + sel.dataset.estadoId, { method: 'PATCH', body: { estado: sel.value } });
          toast('Estado actualizado');
        } catch (err) {
          toast(err.message, true);
          navigate();
        }
      }));
      $$('[data-ver]', table).forEach((b) => b.addEventListener('click', () => { location.hash = '#/presupuestos/' + b.dataset.ver; }));
      $$('[data-borrar]', table).forEach((b) => b.addEventListener('click', async () => {
        if (!confirm('¿Borrar este presupuesto?')) return;
        await api('/presupuestos/' + b.dataset.borrar, { method: 'DELETE' });
        toast('Presupuesto eliminado');
        load();
      }));
    }

    $('#filtroPresu').addEventListener('change', () => { page = 0; load(); });

    $('#btnExportPresupuestos').addEventListener('click', () => {
      if (!presusCache.length) return toast('No hay presupuestos para exportar', true);
      exportCsv('presupuestos.csv', presusCache, [
        { key: 'numero', label: 'Número' },
        { key: 'cliente_nombre', label: 'Cliente' },
        { key: 'total', label: 'Total' },
        { key: 'estado', label: 'Estado' },
        { key: 'items', label: 'Ítems' },
        { key: 'creado_en', label: 'Fecha' },
      ]);
    });

    $('#btnNuevoPresu').addEventListener('click', async () => {
      const clientes = await loadClientesForSelect();
      if (!clientes.length) return toast('Primero crea un cliente', true);
      openModal({
        title: 'Nuevo presupuesto',
        submitLabel: 'Crear presupuesto',
        html: `
          <div class="field"><label>Cliente *</label>
            <select name="cliente_id" required><option value="">Selecciona…</option>${opcionesClientes(clientes)}</select></div>
          ${itemsEditorHtml(null)}
          <div class="field-row">
            <div class="field"><label>Validez (días)</label><input type="number" name="validez_dias" min="1" value="15"></div>
            <div class="field"><label>Estado</label>
              <select name="estado"><option>borrador</option><option>enviado</option><option>aprobado</option></select></div>
          </div>
          <div class="field"><label>Nota</label><textarea name="nota" rows="2" placeholder="Condiciones de pago, alcance…"></textarea></div>`,
        onSubmit: async (fd) => {
          const items = readItems($('#modalBody'));
          if (!items.length) return toast('Agrega al menos un ítem', true);
          await api('/presupuestos', {
            method: 'POST',
            body: {
              cliente_id: fd.get('cliente_id'),
              items,
              validez_dias: Number(fd.get('validez_dias') || 15),
              estado: fd.get('estado'),
              nota: String(fd.get('nota') || '').trim() || null,
            },
          });
          closeModal();
          toast('Presupuesto creado');
          load();
        },
      });
      bindItemsEditor($('#modalBody'));
    });

    await load();
  }

  async function renderPresupuestoDetalle(id) {
    const p = await api('/presupuestos/' + id);
    const totalCantidad = p.items.reduce((a, i) => a + Number(i.cantidad), 0);

    view.innerHTML = `
      <div class="presupuesto-actions">
        <button class="btn btn-ghost btn-sm" onclick="location.hash='#/presupuestos'">← Volver</button>
        <button class="btn btn-ghost btn-sm" id="btnEditarPresu">Editar ítems</button>
        <button class="btn btn-ghost btn-sm" id="btnPresuPedido">Convertir en pedido</button>
        <button class="btn btn-ghost btn-sm" id="btnPresuComprobante">Emitir comprobante</button>
        <button class="btn btn-primary btn-sm" id="btnImprimir">Imprimir / PDF</button>
        <div class="spacer" style="flex:1"></div>
        <select class="select" id="presuEstado">
          ${['borrador', 'enviado', 'aprobado', 'pagado', 'rechazado'].map((e) => `<option ${e === p.estado ? 'selected' : ''}>${e}</option>`).join('')}
        </select>
      </div>
      <div class="presupuesto-doc">
        <div class="presupuesto-head">
          <div class="presupuesto-brand">
            <svg viewBox="0 0 64 64" aria-hidden="true">
              <path d="M28 18 L16 32 L28 46" fill="none" stroke="#6B73C9" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/>
              <path d="M36 18 L48 32 L36 46" fill="none" stroke="#1a1a22" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
            <span><b>Code</b><i>Everything</i></span>
          </div>
          <div class="presupuesto-meta">
            <strong>Presupuesto #${p.numero}</strong>
            Fecha: ${fdate(p.creado_en)}<br>
            Validez: ${p.validez_dias} días
          </div>
        </div>
        <div class="presupuesto-cliente">
          <strong>${esc(p.cliente_nombre || 'Cliente')}</strong>
          ${esc(p.cliente_email || '')}<br>
          ${esc(p.cliente_telefono || '')}<br>
          ${esc(p.cliente_direccion || '')}
        </div>
        <table>
          <thead><tr><th>Descripción</th><th style="text-align:center">Cant.</th><th style="text-align:right">Precio unit.</th><th style="text-align:right">Subtotal</th></tr></thead>
          <tbody>
            ${p.items.map((i) => `<tr>
              <td>${esc(i.descripcion)}</td>
              <td style="text-align:center">${i.cantidad}</td>
              <td style="text-align:right">${money(i.precio)}</td>
              <td style="text-align:right">${money(i.cantidad * i.precio)}</td>
            </tr>`).join('')}
          </tbody>
        </table>
        <div class="presupuesto-total">Total: <span>${money(p.total)}</span></div>
        ${p.nota ? `<p class="presupuesto-nota"><strong>Nota:</strong> ${esc(p.nota)}</p>` : ''}
        <p class="presupuesto-nota">Estado: ${esc(p.estado)} · ${totalCantidad} ítem(s)</p>
      </div>`;

    $('#btnImprimir').addEventListener('click', () => window.print());

    $('#btnPresuPedido').addEventListener('click', async () => {
      if (!confirm('¿Crear un pedido con los datos de este presupuesto?')) return;
      try {
        const pedido = await api('/pedidos', {
          method: 'POST',
          body: {
            cliente_id: p.cliente_id,
            titulo: `Presupuesto #${p.numero}`,
            descripcion: `Convertido desde el presupuesto #${p.numero}.`,
            precio: p.total,
            estado: 'pendiente',
          },
        });
        toast('Pedido creado desde el presupuesto');
        location.hash = '#/pedidos/' + pedido.id;
      } catch (err) {
        toast(err.message, true);
      }
    });

    $('#btnPresuComprobante').addEventListener('click', () => {
      abrirNuevoComprobante({
        cliente_id: p.cliente_id,
        concepto: `Presupuesto #${p.numero}`,
        monto: p.total,
      });
    });

    $('#presuEstado').addEventListener('change', async (e) => {
      await api('/presupuestos/' + p.id, { method: 'PATCH', body: { estado: e.target.value } });
      toast('Estado actualizado');
    });

    $('#btnEditarPresu').addEventListener('click', () => {
      openModal({
        title: 'Editar presupuesto #' + p.numero,
        html: `
          ${itemsEditorHtml(p.items)}
          <div class="field"><label>Nota</label><textarea name="nota" rows="2">${esc(p.nota)}</textarea></div>`,
        onSubmit: async (fd) => {
          const items = readItems($('#modalBody'));
          if (!items.length) return toast('Agrega al menos un ítem', true);
          await api('/presupuestos/' + p.id, {
            method: 'PATCH',
            body: { items, nota: String(fd.get('nota') || '').trim() || null },
          });
          closeModal();
          toast('Presupuesto actualizado');
          navigate();
        },
      });
      bindItemsEditor($('#modalBody'));
    });
  }

  /* ---------- Comprobantes ---------- */

  const METODOS_PAGO = ['Efectivo', 'Yape / Plin', 'Transferencia', 'Tarjeta de crédito', 'Tarjeta de débito', 'Otro'];
  const TIPOS_COMPROBANTE = ['Boleta de Venta', 'Factura', 'Recibo de Pago'];

  function numComprobante(c) {
    return `${c.serie || 'B001'}-${String(c.numero || 0).padStart(8, '0')}`;
  }

  function serieDeTipo(tipo) {
    return ({ 'Boleta de Venta': 'B001', 'Factura': 'F001', 'Recibo de Pago': 'R001' })[tipo] || 'B001';
  }

  const UNI_LETRAS = ['cero', 'uno', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve', 'diez', 'once', 'doce', 'trece', 'catorce', 'quince', 'dieciséis', 'diecisiete', 'dieciocho', 'diecinueve', 'veinte', 'veintiuno', 'veintidós', 'veintitrés', 'veinticuatro', 'veinticinco', 'veintiséis', 'veintisiete', 'veintiocho', 'veintinueve'];
  const DEC_LETRAS = ['', '', 'veinte', 'treinta', 'cuarenta', 'cincuenta', 'sesenta', 'setenta', 'ochenta', 'noventa'];
  const CEN_LETRAS = ['', 'ciento', 'doscientos', 'trescientos', 'cuatrocientos', 'quinientos', 'seiscientos', 'setecientos', 'ochocientos', 'novecientos'];

  function letrasHasta999(n) {
    if (n === 100) return 'cien';
    const c = Math.floor(n / 100), r = n % 100;
    let s = c ? CEN_LETRAS[c] : '';
    if (r) {
      if (s) s += ' ';
      if (r < 30) s += UNI_LETRAS[r];
      else {
        const d = Math.floor(r / 10), u = r % 10;
        s += DEC_LETRAS[d] + (u ? ' y ' + UNI_LETRAS[u] : '');
      }
    }
    return s;
  }

  function letras(n) {
    if (n === 0) return 'cero';
    let s = '';
    const millones = Math.floor(n / 1000000);
    const resto = n % 1000000;
    if (millones) {
      s = millones === 1 ? 'un millón' : letrasHasta999(millones) + ' millones';
    }
    const miles = Math.floor(resto / 1000);
    const u = resto % 1000;
    if (miles) {
      s += (s ? ' ' : '') + (miles === 1 ? 'mil' : letrasHasta999(miles) + ' mil');
    }
    if (u) s += (s ? ' ' : '') + letrasHasta999(u);
    return s;
  }

  function sonSoles(monto) {
    const total = Math.abs(Number(monto) || 0);
    const entero = Math.floor(total);
    const centavos = Math.round((total - entero) * 100);
    return `SON: ${letras(entero).toUpperCase()} Y ${String(centavos).padStart(2, '0')}/100 SOLES`;
  }

  async function renderComprobantes() {
    view.innerHTML = `
      <div class="toolbar">
        <select class="select" id="filtroComprob">
          <option value="">Todos</option>
          <option>pagado</option>
          <option>anulado</option>
        </select>
        <button class="btn btn-ghost btn-sm" id="btnExportComprob">Exportar CSV</button>
        <div class="spacer"></div>
        <button class="btn btn-primary" id="btnNuevoComprob">+ Nuevo comprobante</button>
      </div>
      <div id="comprobTable"></div>`;

    const table = $('#comprobTable');
    let cache = [];
    let page = 0;

    async function load() {
      const estado = $('#filtroComprob').value;
      cache = await api('/comprobantes' + (estado ? '?estado=' + encodeURIComponent(estado) : ''));
      if (!cache.length) {
        table.innerHTML = '<div class="card empty"><strong>Sin comprobantes</strong>Crea el primero con el botón "+ Nuevo comprobante".</div>';
        return;
      }
      const info = paginar(cache, page);
      page = info.page;
      table.innerHTML = `
        <div class="table-wrap"><table>
          <thead><tr><th>Comprobante</th><th>Tipo</th><th>Cliente</th><th>Concepto</th><th>Monto</th><th>Método</th><th>Fecha</th><th>Estado</th><th></th></tr></thead>
          <tbody>${info.slice.map((c) => `
            <tr>
              <td><strong>${numComprobante(c)}</strong></td>
              <td class="muted">${esc(c.tipo || 'Boleta de Venta')}</td>
              <td>${esc(c.cliente_nombre || '—')}</td>
              <td class="muted">${esc(c.concepto)}</td>
              <td>${money(c.monto)}</td>
              <td class="muted">${esc(c.metodo_pago || '—')}</td>
              <td class="muted">${fdate(c.fecha)}</td>
              <td>${badge(c.estado)}</td>
              <td><div class="row-actions">
                <button class="icon-btn" data-ver="${c.id}">Ver</button>
                <button class="icon-btn" data-editar="${c.id}">Editar</button>
                <button class="icon-btn danger" data-borrar="${c.id}">Borrar</button>
              </div></td>
            </tr>`).join('')}
          </tbody>
        </table></div>` + pagerHtml(info);

      bindPager(table, (p) => { page = p; load(); });
      $$('[data-ver]', table).forEach((b) => b.addEventListener('click', () => { location.hash = '#/comprobantes/' + b.dataset.ver; }));
      $$('[data-borrar]', table).forEach((b) => b.addEventListener('click', async () => {
        if (!confirm('¿Borrar este comprobante?')) return;
        await api('/comprobantes/' + b.dataset.borrar, { method: 'DELETE' });
        toast('Comprobante eliminado');
        load();
      }));
      $$('[data-editar]', table).forEach((b) => b.addEventListener('click', async () => {
        const c = cache.find((x) => x.id === b.dataset.editar);
        const pedidos = await api('/pedidos');
        openModal({
          title: 'Editar comprobante ' + numComprobante(c),
          html: `
            <div class="field"><label>Concepto *</label><input name="concepto" required value="${esc(c.concepto)}"></div>
            <div class="field-row">
              <div class="field"><label>Tipo de comprobante</label>
                <select name="tipo">${TIPOS_COMPROBANTE.map((t) => `<option ${t === (c.tipo || 'Boleta de Venta') ? 'selected' : ''}>${t}</option>`).join('')}</select>
                <span class="muted">Al cambiar el tipo se emite con la serie correspondiente (${serieDeTipo(c.tipo)})</span></div>
              <div class="field"><label>Monto (S/) *</label><input type="number" step="0.01" min="0" name="monto" required value="${c.monto}"></div>
            </div>
            <div class="field-row">
              <div class="field"><label>Método de pago</label>
                <select name="metodo_pago">${METODOS_PAGO.map((m) => `<option ${m === c.metodo_pago ? 'selected' : ''}>${m}</option>`).join('')}</select></div>
              <div class="field"><label>Fecha</label><input type="date" name="fecha" value="${c.fecha ? String(c.fecha).slice(0, 10) : ''}"></div>
            </div>
            <div class="field"><label>Vincular a pedido (opcional)</label>
              <select name="pedido_id">
                <option value="">— Sin pedido —</option>
                ${pedidos.map((p) => `<option value="${p.id}" ${p.id === c.pedido_id ? 'selected' : ''}>${esc(p.titulo)}${p.cliente_nombre ? ' — ' + esc(p.cliente_nombre) : ''}</option>`).join('')}
              </select></div>
            <div class="field-row">
              <div class="field"><label>Estado</label>
                <select name="estado" id="editComprobEstado"><option ${c.estado === 'pagado' ? 'selected' : ''}>pagado</option><option ${c.estado === 'anulado' ? 'selected' : ''}>anulado</option></select></div>
            </div>
            <div class="field" id="campoMotivo" style="${c.estado === 'anulado' ? '' : 'display:none'}">
              <label>Motivo de anulación *</label>
              <textarea name="motivo_anulacion" rows="2" placeholder="Ej: Error en los datos del cliente">${esc(c.motivo_anulacion || '')}</textarea>
            </div>
            <div class="field"><label>Notas</label><textarea name="notas" rows="2">${esc(c.notas)}</textarea></div>`,
          onSubmit: async (fd) => {
            const estado = String(fd.get('estado') || 'pagado');
            const motivo = String(fd.get('motivo_anulacion') || '').trim();
            if (estado === 'anulado' && !motivo) return toast('Indica el motivo de anulación', true);
            await api('/comprobantes/' + c.id, {
              method: 'PATCH',
              body: {
                tipo: fd.get('tipo'),
                pedido_id: String(fd.get('pedido_id') || '') || null,
                concepto: String(fd.get('concepto') || '').trim(),
                monto: Number(fd.get('monto') || 0),
                metodo_pago: fd.get('metodo_pago'),
                fecha: fd.get('fecha'),
                estado,
                motivo_anulacion: estado === 'anulado' ? motivo : '',
                notas: String(fd.get('notas') || '').trim() || null,
              },
            });
            closeModal();
            toast('Comprobante actualizado');
            load();
          },
        });
        const toggleMotivo = () => {
          $('#campoMotivo').style.display = $('#editComprobEstado').value === 'anulado' ? '' : 'none';
        };
        $('#editComprobEstado').addEventListener('change', toggleMotivo);
      }));
    }

    $('#filtroComprob').addEventListener('change', () => { page = 0; load(); });

    $('#btnExportComprob').addEventListener('click', () => {
      if (!cache.length) return toast('No hay comprobantes para exportar', true);
      exportCsv('comprobantes.csv', cache, [
        { key: 'numero', label: 'Número' },
        { key: 'serie', label: 'Serie' },
        { key: 'tipo', label: 'Tipo' },
        { key: 'cliente_nombre', label: 'Cliente' },
        { key: 'concepto', label: 'Concepto' },
        { key: 'monto', label: 'Monto (S/)' },
        { key: 'metodo_pago', label: 'Método de pago' },
        { key: 'fecha', label: 'Fecha' },
        { key: 'estado', label: 'Estado' },
        { key: 'motivo_anulacion', label: 'Motivo de anulación' },
      ]);
    });

    $('#btnNuevoComprob').addEventListener('click', () => abrirNuevoComprobante());

    await load();
  }

  async function abrirNuevoComprobante(prefill) {
    prefill = prefill || {};
    const [clientes, pedidos] = await Promise.all([loadClientesForSelect(), api('/pedidos')]);
    if (!clientes.length) return toast('Primero crea un cliente', true);
    const hoy = new Date().toISOString().slice(0, 10);
    openModal({
      title: 'Nuevo comprobante de pago',
      submitLabel: 'Emitir comprobante',
      html: `
        <div class="field"><label>Cliente *</label>
          <select name="cliente_id" required><option value="">Selecciona…</option>${opcionesClientes(clientes, prefill.cliente_id || null)}</select></div>
        <div class="field"><label>Concepto *</label><input name="concepto" required value="${esc(prefill.concepto || '')}" placeholder="Ej: Instalación Microsoft Office 2021"></div>
        <div class="field-row">
          <div class="field"><label>Tipo de comprobante</label>
            <select name="tipo" id="nuevoComprobTipo">${TIPOS_COMPROBANTE.map((t) => `<option>${t}</option>`).join('')}</select></div>
          <div class="field"><label>Monto (S/) *</label><input type="number" step="0.01" min="0.01" name="monto" required value="${prefill.monto != null ? prefill.monto : ''}"></div>
        </div>
        <div class="field-row">
          <div class="field"><label>Método de pago</label>
            <select name="metodo_pago">${METODOS_PAGO.map((m) => `<option>${m}</option>`).join('')}</select></div>
          <div class="field"><label>Fecha</label><input type="date" name="fecha" value="${hoy}"></div>
        </div>
        <div class="field"><label>Vincular a pedido (opcional)</label>
          <select name="pedido_id">
            <option value="">— Sin pedido —</option>
            ${pedidos.map((p) => `<option value="${p.id}" ${p.id === prefill.pedido_id ? 'selected' : ''}>${esc(p.titulo)}${p.cliente_nombre ? ' — ' + esc(p.cliente_nombre) : ''}</option>`).join('')}
          </select></div>
        <div class="field"><label>Notas</label><textarea name="notas" rows="2"></textarea></div>`,
      onSubmit: async (fd) => {
        await api('/comprobantes', {
          method: 'POST',
          body: {
            cliente_id: fd.get('cliente_id'),
            pedido_id: String(fd.get('pedido_id') || '') || null,
            tipo: fd.get('tipo'),
            concepto: String(fd.get('concepto') || '').trim(),
            monto: Number(fd.get('monto') || 0),
            metodo_pago: fd.get('metodo_pago'),
            fecha: fd.get('fecha'),
            notas: String(fd.get('notas') || '').trim() || null,
          },
        });
        closeModal();
        toast('Comprobante emitido');
        navigate();
      },
    });
  }

  async function renderComprobanteDetalle(id) {
    const [co, empresa] = await Promise.all([api('/comprobantes/' + id), api('/empresa')]);
    const anulado = co.estado === 'anulado';
    const tipo = co.tipo || 'Boleta de Venta';

    view.innerHTML = `
      <div class="presupuesto-actions">
        <button class="btn btn-ghost btn-sm" onclick="location.hash='#/comprobantes'">← Volver</button>
        <button class="btn btn-primary btn-sm" id="btnImprimirBoleta">Imprimir / PDF</button>
        <div style="flex:1"></div>
        <select class="select" id="comprobEstado">
          <option ${co.estado === 'pagado' ? 'selected' : ''}>pagado</option>
          <option ${anulado ? 'selected' : ''}>anulado</option>
        </select>
      </div>
      <div class="boleta-doc ${anulado ? 'anulada' : ''}">
        ${anulado ? '<div class="boleta-watermark">ANULADO</div>' : ''}
        <div class="tk-head">
          <svg viewBox="0 0 64 64" aria-hidden="true">
            <path d="M28 18 L16 32 L28 46" fill="none" stroke="#000" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M36 18 L48 32 L36 46" fill="none" stroke="#000" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          <div class="tk-empresa">${esc(empresa.nombre || 'CodeEverything')}</div>
          ${empresa.ruc ? `<div>RUC ${esc(empresa.ruc)}</div>` : ''}
          ${empresa.direccion ? `<div>${esc(empresa.direccion)}</div>` : ''}
          ${empresa.telefono ? `<div>Tel. ${esc(empresa.telefono)}</div>` : ''}
          ${empresa.email ? `<div>${esc(empresa.email)}</div>` : ''}
          ${empresa.web ? `<div>${esc(empresa.web)}</div>` : ''}
        </div>
        <div class="tk-sep"></div>
        <div class="tk-tipo">${esc(tipo)}</div>
        <div class="tk-num">N° ${numComprobante(co)}</div>
        <div class="tk-sep"></div>
        <div class="tk-row"><span>Fecha</span><span>${fdate(co.fecha)}</span></div>
        <div class="tk-row"><span>Señor(a)</span><span>${esc(co.cliente_nombre || '—')}</span></div>
        ${co.cliente_documento ? `<div class="tk-row"><span>${String(co.cliente_documento).trim().length === 11 ? 'RUC' : 'DNI'}</span><span>${esc(co.cliente_documento)}</span></div>` : ''}
        ${co.cliente_direccion ? `<div class="tk-row"><span>Dirección</span><span>${esc(co.cliente_direccion)}</span></div>` : ''}
        ${co.cliente_telefono ? `<div class="tk-row"><span>Teléfono</span><span>${esc(co.cliente_telefono)}</span></div>` : ''}
        ${co.pedido_titulo ? `<div class="tk-row"><span>Pedido</span><span>${esc(co.pedido_titulo)}</span></div>` : ''}
        <div class="tk-sep"></div>
        <div class="tk-item">
          <div class="tk-item-desc">1&nbsp;&nbsp;${esc(co.concepto)}</div>
          <div class="tk-item-imp">${money(co.monto)}</div>
        </div>
        ${co.notas ? `<div class="tk-notas">${esc(co.notas)}</div>` : ''}
        <div class="tk-sep"></div>
        <div class="tk-row tk-total"><span>Total</span><span>${money(co.monto)}</span></div>
        <div class="tk-row"><span>Pago</span><span>${esc(co.metodo_pago || '—')}</span></div>
        <div class="tk-row"><span>Condición</span><span>${anulado ? 'Anulado' : 'Contado'}</span></div>
        ${anulado && co.motivo_anulacion ? `<div class="tk-row"><span>Motivo anulación</span><span>${esc(co.motivo_anulacion)}</span></div>` : ''}
        <div class="tk-son">${sonSoles(co.monto)}</div>
        <div class="tk-sep"></div>
        <p class="tk-leyenda">${esc(empresa.leyenda || '')}</p>
        <div class="tk-firma">
          <div class="tk-firma-linea"></div>
          <div>Firma</div>
        </div>
        ${empresa.ruc ? `<div class="tk-ruc-emisor">RUC ${esc(empresa.ruc)}</div>` : ''}
      </div>`;

    $('#btnImprimirBoleta').addEventListener('click', () => window.print());
    $('#comprobEstado').addEventListener('change', async (e) => {
      const nuevo = e.target.value;
      if (nuevo === 'anulado') {
        e.target.value = co.estado;
        abrirModalAnulacion(co.id);
        return;
      }
      await api('/comprobantes/' + co.id, { method: 'PATCH', body: { estado: nuevo } });
      toast('Estado actualizado');
      navigate();
    });
  }

  function abrirModalAnulacion(id) {
    openModal({
      title: 'Anular comprobante',
      submitLabel: 'Anular comprobante',
      html: `
        <p class="muted" style="margin-bottom:14px">El comprobante quedará anulado y no podrá usarse. Indica el motivo (obligatorio).</p>
        <div class="field"><label>Motivo de anulación *</label>
          <textarea name="motivo" rows="3" required placeholder="Ej: Error en los datos del cliente"></textarea></div>`,
      onSubmit: async (fd) => {
        const motivo = String(fd.get('motivo') || '').trim();
        if (!motivo) return toast('Indica el motivo de anulación', true);
        await api('/comprobantes/' + id, { method: 'PATCH', body: { estado: 'anulado', motivo_anulacion: motivo } });
        closeModal();
        toast('Comprobante anulado');
        navigate();
      },
    });
  }

  /* ---------- Mi empresa ---------- */

  async function renderEmpresa() {
    const e = await api('/empresa');
    view.innerHTML = `
      <div class="card" style="max-width:640px">
        <h3 class="section-title">Datos de tu empresa</h3>
        <p class="muted" style="margin-bottom:18px">Estos datos aparecen en el encabezado y pie de las boletas, facturas y recibos que imprimes o exportas en PDF desde el CRM.</p>
        <form id="empresaForm" style="display:flex;flex-direction:column;gap:16px">
          <div class="field"><label>Razón social / Nombre comercial *</label><input name="nombre" required value="${esc(e.nombre)}" placeholder="Ej: CodeEverything"></div>
          <div class="field-row">
            <div class="field"><label>RUC</label><input name="ruc" value="${esc(e.ruc)}" placeholder="Ej: 20601234567"></div>
            <div class="field"><label>Teléfono</label><input name="telefono" value="${esc(e.telefono)}" placeholder="Ej: 987 654 321"></div>
          </div>
          <div class="field-row">
            <div class="field"><label>Correo</label><input type="email" name="email" value="${esc(e.email)}"></div>
            <div class="field"><label>Sitio web</label><input name="web" value="${esc(e.web)}" placeholder="Ej: https://codeverything.com"></div>
          </div>
          <div class="field"><label>Dirección</label><input name="direccion" value="${esc(e.direccion)}" placeholder="Ej: Av. Principal 123, Lima"></div>
          <div class="field"><label>Leyenda del comprobante</label>
            <textarea name="leyenda" rows="2" placeholder="Texto al pie de boletas y facturas">${esc(e.leyenda)}</textarea>
            <span class="muted">Ej: "Gracias por su preferencia. Esta boleta no habilita crédito fiscal."</span></div>
          <button type="submit" class="btn btn-primary" style="align-self:flex-start">Guardar datos</button>
        </form>
      </div>
      <div class="card" style="max-width:640px;margin-top:20px">
        <h3 class="section-title">Seguridad</h3>
        <p class="muted" style="margin-bottom:18px">Cambia la contraseña con la que entras al CRM. Usa al menos 6 caracteres y no la compartas.</p>
        <form id="passForm" style="display:flex;flex-direction:column;gap:16px">
          <div class="field"><label>Contraseña actual</label>
            <input type="password" name="actual" autocomplete="current-password" required></div>
          <div class="field-row">
            <div class="field"><label>Contraseña nueva</label>
              <input type="password" name="nueva" autocomplete="new-password" required minlength="6"></div>
            <div class="field"><label>Repetir contraseña nueva</label>
              <input type="password" name="repetir" autocomplete="new-password" required minlength="6"></div>
          </div>
          <button type="submit" class="btn btn-primary" style="align-self:flex-start">Cambiar contraseña</button>
        </form>
      </div>
      <div class="card" style="max-width:640px;margin-top:20px">
        <h3 class="section-title">Copia de seguridad</h3>
        <p class="muted" style="margin-bottom:18px">Descarga todos tus datos (clientes, leads, servicios, pedidos, presupuestos, comprobantes y empresa) en un archivo JSON. Guárdalo en un lugar seguro.</p>
        <button class="btn btn-ghost" id="btnBackup">Descargar backup (JSON)</button>
      </div>`;

    $('#empresaForm').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const fd = new FormData(ev.target);
      await api('/empresa', {
        method: 'PUT',
        body: {
          nombre: String(fd.get('nombre') || '').trim(),
          ruc: String(fd.get('ruc') || '').trim(),
          telefono: String(fd.get('telefono') || '').trim(),
          email: String(fd.get('email') || '').trim(),
          web: String(fd.get('web') || '').trim(),
          direccion: String(fd.get('direccion') || '').trim(),
          leyenda: String(fd.get('leyenda') || '').trim(),
        },
      });
      toast('Datos de empresa guardados');
    });

    $('#passForm').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const fd = new FormData(ev.target);
      const nueva = String(fd.get('nueva') || '');
      if (nueva !== String(fd.get('repetir') || '')) return toast('Las contraseñas nuevas no coinciden', true);
      try {
        await api('/auth/cambiar-contrasena', {
          method: 'POST',
          body: { actual: String(fd.get('actual') || ''), nueva },
        });
        ev.target.reset();
        toast('Contraseña actualizada');
      } catch (err) {
        toast(err.message, true);
      }
    });

    $('#btnBackup').addEventListener('click', async () => {
      try {
        const dump = await api('/backup');
        const blob = new Blob([JSON.stringify(dump, null, 2)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'codeverything-backup-' + new Date().toISOString().slice(0, 10) + '.json';
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 4000);
        toast('Backup descargado');
      } catch (err) {
        toast(err.message, true);
      }
    });
  }

  /* ---------- Init ---------- */

  $('#topbarDate').textContent = new Date().toLocaleDateString('es-PE', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });

  (async function init() {
    try {
      const me = await api('/auth/me');
      showApp(me.usuario);
      navigate();
    } catch (e) {
      showLogin();
    }
  })();
})();
