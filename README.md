# CodeEverything — Web + CRM (Perú)

Landing page pública y CRM en la nube para **CodeEverything** (instalación de software y desarrollo web) — adaptados a **Perú**.

- **Moneda**: Soles (`S/`, PEN) en todo el CRM — montos, gráficos y CSV.
- **Comprobantes**: boletas, facturas y recibos con series peruanas (`B001-00000001`, `F001-…`, `R001-…`), RUC del emisor y DNI/RUC del cliente.
- **Fechas y textos**: locale `es-PE` en toda la interfaz.

- **Página web** (`/`): landing con los 8 servicios (incluye **instalación y mantenimiento remoto**), sección "Servicio remoto en todo el Perú", "Por qué elegirnos", FAQ y formulario de contacto que genera **leads automáticos** en el CRM.
- **CRM** (`/crm`): login protegido con dashboard, clientes, leads (badge de nuevos + botón de WhatsApp), servicios (alta/edición/borrado), pedidos con ficha detallada y comprobantes vinculados, presupuestos imprimibles **convertibles en pedido o comprobante con un clic**, **comprobantes (boleta/factura/recibo)** con datos de empresa personalizables, **cambio de contraseña** desde el CRM y **exportación CSV** de todos los listados.

## Stack

| Capa | Tecnología |
|---|---|
| Frontend | HTML / CSS / JS (sin frameworks), Chart.js para gráficos |
| Backend | Node.js + Express (serverless en Vercel) |
| Base de datos | Supabase (Postgres) — en la nube y también en local |
| Auth | JWT en cookie httpOnly (usuario/contraseña por variables de entorno) |
| Hosting | Vercel |

## Estructura

```
├── server.js            # App Express (export default: Vercel la detecta sola)
├── start.js             # Arranque en local (npm run dev / npm start)
├── lib/
│   ├── routes.js        # Toda la API REST (/api/...)
│   ├── db.js            # Cliente Supabase (Postgres) + esquema + seed
│   ├── auth.js          # JWT, cookies, login
│   └── schema.js        # Esquema SQL y servicios iniciales
├── db/schema.sql        # Copia del esquema (referencia / SQL manual)
├── public/              # Sitio estático (lo sirve el CDN de Vercel)
│   ├── index.html       # Landing
│   ├── styles.css / main.js
│   ├── assets/          # Logos (1.png oscuro, 2.png claro)
│   └── crm/             # SPA del CRM (index.html, crm.css, crm.js)
└── vercel.json          # Headers de caché
```

## Desarrollo local

El proyecto usa **Supabase (Postgres) también en local**: sin conexión no hay base de datos.

1. Crea un proyecto gratis en <https://supabase.com> (o usa el de un cliente).
2. Copia la connection string: en el proyecto → *Settings → Database → Database settings* → copia la **URI** del modo **Pooler** (puerto `6543`).
3. Configura el entorno:

```bash
npm install
cp .env.example .env   # Windows: copy .env.example .env
```

Abre `.env` y pega la connection string en `SUPABASE_DB_URL`, y define `ADMIN_USER`, `ADMIN_PASS` y `JWT_SECRET`. Luego:

```bash
npm run dev
```

Abre <http://localhost:3000> (`npm run dev` carga `.env` solo, no hace falta exportar nada; requiere Node ≥ 22.9).

- CRM: <http://localhost:3000/crm>
- Usuario: `admin` + la contraseña de `ADMIN_PASS` en tu `.env` (si no existe `.env`, `admin` / `admin123`).

El esquema de tablas, los 8 servicios y los datos por defecto de la empresa se crean **solos en el primer request** (no hay migraciones que correr).

| Variable | Descripción |
|---|---|
| `SUPABASE_DB_URL` | **Obligatoria.** Connection string (Pooler) de Supabase |
| `SUPABASE_DB_CA_CERT` | Opcional: certificado CA de Supabase (PEM o base64) para verificar el servidor |
| `PG_POOL_MAX` | Opcional: conexiones del pool por instancia (por defecto 5) |
| `ADMIN_USER` / `ADMIN_PASS` | Usuario y contraseña del CRM |
| `JWT_SECRET` | Secreto para las sesiones (`openssl rand -hex 32`) |
| `LEAD_WEBHOOK_URL` | Opcional: webhook que recibe cada lead nuevo |
| `PORT` | Opcional: puerto en local (3000 por defecto) |

## Despliegue en Vercel + Supabase

Vercel tiene **detección cero-configuración de Express**: `server.js` exporta la app por defecto (`export default app`), así que no hay que configurar build ni entrypoint. La landing, los assets y `/crm` los sirve el **CDN de Vercel** desde `public/**` y toda la data pasa por la función (API `/api/*`) hacia Supabase.

1. **Sube el proyecto a GitHub** (o GitLab/Bitbucket).
2. En <https://vercel.com/new> importa el repo. Vercel detecta Express automáticamente (Framework Preset: **Express**, sin build command). Alternativa desde CLI: `npm i -g vercel` y `vercel` en la raíz del proyecto.
3. En <https://supabase.com/dashboard> crea el proyecto del cliente. Copia la connection string del modo **Pooler** (*Settings → Database → Database settings → URI*, puerto `6543`, usuario `postgres.<ref>`).
4. En Vercel → *Settings → Environment Variables* define (Production **y** Preview):
   - `SUPABASE_DB_URL` — connection string (Pooler) de Supabase
   - `SUPABASE_DB_CA_CERT` — opcional pero recomendado: pega el PEM de *Download CA certificate* (Settings → Database)
   - `ADMIN_USER` — usuario del CRM
   - `ADMIN_PASS` — contraseña del CRM
   - `JWT_SECRET` — secreto largo y aleatorio (ej. `openssl rand -hex 32`)
   - `LEAD_WEBHOOK_URL` — opcional: webhook (n8n, Make, Slack…) que recibe un POST `{ "source": "codeverything", "lead": {...} }` con cada lead nuevo del formulario web
5. Deploy. URLs finales:
   - `https://tu-proyecto.vercel.app/` → página web
   - `https://tu-proyecto.vercel.app/crm` → CRM

Notas:

- **Región**: la región por defecto de Vercel (`iad1`, Washington D. C.) queda a ~10 ms del pooler de Supabase `us-east-2` (Ohio) — no cambies nada. Si eliges otra región para el proyecto, que sea cercana a la región del pooler de Supabase.
- **Node**: `package.json` pide `engines.node >= 22.9.0`; Vercel usa una versión compatible sin tocar nada.
- Para probar en local como en producción: `vercel dev` (usa las env vars del proyecto con `vercel env pull`).
- El esquema de tablas, los 8 servicios y los datos por defecto de la empresa se crean **solos en el primer request** de cada entorno (no hay migraciones que correr; al actualizar el proyecto se agregan solos los servicios nuevos).

Cada cliente con el que trabajes: crea su proyecto en Supabase, usa su connection string como `SUPABASE_DB_URL` en Vercel (aparta un proyecto de Vercel por cliente si quieres aislar también los despliegues), y listo — CRM y web quedarán aislados con sus propios datos.

### Dominio propio

En Vercel → *Settings → Domains* puedes agregar tu dominio y apuntar el DNS según las instrucciones que muestra Vercel.

## Módulos del CRM

| Módulo | Qué hace |
|---|---|
| **Dashboard** | Ingresos del mes, leads, clientes, pedidos activos, gráfico de ingresos (6 meses) y servicios más pedidos |
| **Clientes** | Alta / edición / borrado, búsqueda, ficha con **documento (DNI/RUC)** e historial de pedidos, presupuestos **y comprobantes** (todos enlazados a su detalle) |
| **Leads** | Llegan del formulario web; estados nuevo → contactado → convertido/rechazado; botón "Convertir" que genera el cliente; **badge en el menú** con los leads nuevos y botón **WhatsApp** por lead (prefija el código 51) |
| **Servicios** | Alta / edición / borrado con precio de referencia (déjalo en 0 para cotizar caso por caso); ese precio es el que muestra la landing como *"Desde S/"* |
| **Pedidos** | Servicio asignado a un cliente con estado pendiente → en proceso → entregado/cancelado; ficha detallada (`Ver`) con **comprobantes vinculados** y botón para emitir uno; **búsqueda** por texto |
| **Presupuestos** | Ítems con cantidades y precios, estados borrador → enviado → aprobado/pagado, vista imprimible (`Imprimir / PDF`) y botones **"Convertir en pedido"** y **"Emitir comprobante"** |
| **Comprobantes** | Boletas, facturas y recibos numerados por serie (`B001-00000001`), con cliente, DNI/RUC, concepto, monto en soles y método de pago (incluye Yape/Plin); estados pagado/anulado con **motivo de anulación obligatorio**, sello "ANULADO", vista imprimible, **vinculación a un pedido** y **búsqueda** por texto |
| **Mi empresa** | Datos que aparecen en el encabezado y pie de los comprobantes: razón social, **RUC**, dirección, teléfono, correo, web y leyenda legal (ej. "Esta boleta no habilita crédito fiscal"); **cambio de contraseña** del CRM y **descarga de backup JSON** |
| **Exportar CSV** | Todos los listados (clientes, leads, pedidos, presupuestos, comprobantes) exportan CSV con un clic; comprobantes incluye el motivo de anulación |
| **Buscador global** | Barra en la cabecera del CRM: busca a la vez en clientes, pedidos y comprobantes (después de 2 caracteres) |
| **Paginación** | Todos los listados grandes muestran 25 filas por página con botones Anterior/Siguiente |

## Landing web

- **Botón flotante de WhatsApp** (esquina inferior derecha) que abre `https://wa.me/51981485822` con un mensaje prellenado.
- **Precios "Desde S/"** en la sección de servicios: se leen de la API pública (`/api/publico`) usando los *precios de referencia* cargados en el CRM. Si un precio está en 0 no se muestra (queda "cotizar caso por caso").
- **Galería de trabajos**: carpeta `public/assets/trabajos/` con tus fotos y un archivo `lista.json` de esta forma:

  ```json
  [
    { "img": "trabajo-1.jpg", "titulo": "Instalación de Office en contabilidad" },
    { "img": "trabajo-2.jpg", "titulo": "Tienda online para un cliente" }
  ]
  ```

  Coloca las imágenes en esa misma carpeta y ajusta `img` al nombre del archivo. Si `lista.json` está vacío (`[]`), la sección no se muestra.

## Seguridad

- Todo `/api/*` salvo `/api/health`, `/api/auth/login`, `/api/auth/me`, `/api/auth/logout`, `/api/contact` y `/api/publico` (solo precios de servicios) requiere sesión.
- `/api/backup` exige sesión y **no incluye** la tabla `settings` (donde está el hash de la contraseña).
- La cookie de sesión es `HttpOnly` + `SameSite=Lax` (+ `Secure` en Vercel).
- **Rate limit de login**: 5 intentos fallidos cada 15 minutos por IP + usuario → responde `429` hasta que pase la ventana.
- **Cambio de contraseña**: desde *Mi empresa → Seguridad*. La contraseña guardada en la base tiene prioridad sobre la variable `ADMIN_PASS`.
- El CRM tiene `<meta name="robots" content="noindex">`.
- Cambia `ADMIN_PASS` y `JWT_SECRET` antes de publicar.

## Colores de marca (del logo)

| Uso | Color |
|---|---|
| Primario (periwinkle) | `#6B73C9` |
| Hover / secundario | `#7B85D6` / `#8FA8E0` |
| Crema (texto sobre oscuro) | `#F5F0E8` |
| Fondo oscuro | `#0B0B0E` / `#111116` |
