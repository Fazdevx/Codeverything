(function () {
  const nav = document.getElementById('siteNav');
  const toggle = document.getElementById('navToggle');
  const form = document.getElementById('contactForm');
  const formMsg = document.getElementById('formMsg');
  const servicioSelect = document.getElementById('servicio');
  const submitBtn = document.getElementById('contactSubmit');

  document.getElementById('year').textContent = new Date().getFullYear();

  toggle.addEventListener('click', function () {
    const open = nav.classList.toggle('open');
    toggle.setAttribute('aria-expanded', String(open));
  });

  nav.querySelectorAll('a').forEach(function (a) {
    a.addEventListener('click', function () {
      nav.classList.remove('open');
      toggle.setAttribute('aria-expanded', 'false');
    });
  });

  document.querySelectorAll('.link-solicitar').forEach(function (btn) {
    btn.addEventListener('click', function () {
      const servicio = btn.getAttribute('data-servicio');
      servicioSelect.value = servicio;
      document.getElementById('contacto').scrollIntoView({ behavior: 'smooth' });
      setTimeout(function () { document.getElementById('nombre').focus(); }, 600);
    });
  });

  form.addEventListener('submit', async function (e) {
    e.preventDefault();
    formMsg.textContent = '';
    formMsg.className = 'form-msg';

    const nombre = form.nombre.value.trim();
    const email = form.email.value.trim();
    if (!nombre) {
      formMsg.textContent = 'Ingresa tu nombre.';
      formMsg.classList.add('err');
      form.nombre.focus();
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      formMsg.textContent = 'Ingresa un email válido.';
      formMsg.classList.add('err');
      form.email.focus();
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = 'Enviando…';

    try {
      const res = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nombre: nombre,
          email: email,
          telefono: form.telefono.value.trim() || null,
          servicio: form.servicio.value || null,
          mensaje: form.mensaje.value.trim() || null,
        }),
      });
      const json = await res.json().catch(function () { return null; });
      if (!res.ok || !json || !json.ok) {
        throw new Error((json && json.error) || 'No se pudo enviar. Intenta de nuevo.');
      }
      form.reset();
      formMsg.textContent = '¡Gracias! Recibimos tu consulta y te contactamos a la brevedad.';
      formMsg.classList.add('ok');
    } catch (err) {
      formMsg.textContent = err.message || 'Ocurrió un error. Intenta de nuevo.';
      formMsg.classList.add('err');
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Enviar consulta';
    }
  });

  /* ---- Precios "Desde S/" (cargados desde el CRM) ---- */
  function normaliza(txt) {
    return String(txt || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
  }

  fetch('/api/publico')
    .then(function (res) { return res.ok ? res.json() : null; })
    .then(function (json) {
      var servicios = (json && json.ok && json.data && json.data.servicios) || [];
      if (!servicios.length) return;
      var porNombre = {};
      servicios.forEach(function (s) { porNombre[normaliza(s.nombre)] = Number(s.precio) || 0; });
      document.querySelectorAll('#servicios .card').forEach(function (card) {
        var h3 = card.querySelector('h3');
        if (!h3) return;
        var precio = porNombre[normaliza(h3.textContent)];
        if (precio > 0) {
          var span = document.createElement('span');
          span.className = 'precio-desde';
          span.textContent = 'Desde S/ ' + precio.toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
          h3.insertAdjacentElement('afterend', span);
        }
      });
    })
    .catch(function () { /* la landing funciona aunque falle */ });

  /* ---- Galería de trabajos (public/assets/trabajos/lista.json) ---- */
  function escHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  fetch('/assets/trabajos/lista.json')
    .then(function (res) { return res.ok ? res.json() : []; })
    .then(function (lista) {
      var items = (Array.isArray(lista) ? lista : []).filter(function (x) { return x && x.img; });
      if (!items.length) return;
      var grid = document.getElementById('trabajosGrid');
      grid.innerHTML = items.map(function (x) {
        return '<figure class="trabajo-card">' +
          '<img src="/assets/trabajos/' + escHtml(x.img) + '" alt="' + escHtml(x.titulo || 'Trabajo realizado') + '" loading="lazy">' +
          (x.titulo ? '<figcaption>' + escHtml(x.titulo) + '</figcaption>' : '') +
          '</figure>';
      }).join('');
      document.getElementById('trabajos').hidden = false;
    })
    .catch(function () { /* sin galería si falla */ });
})();
