import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildRouter } from './lib/routes.js';
import { hasDatabase } from './lib/db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const onVercel = Boolean(process.env.VERCEL);

if (!hasDatabase) {
  console.warn(
    'AVISO: falta SUPABASE_DB_URL (o POSTGRES_URL). Copia .env.example a .env y pega la connection string de Supabase.'
  );
}

export const app = express();
app.disable('x-powered-by');
if (onVercel) app.set('trust proxy', 1);

app.use('/api', buildRouter());

// En local sirve la landing y /crm desde public/.
if (!onVercel) {
  app.use(express.static(path.join(__dirname, 'public')));
}

// En Vercel el CDN sirve public/**; estos son respaldo por si una peticion
// sin extension (/, /crm) llega igual a la funcion.
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});
app.get(['/crm', '/crm/'], (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'crm', 'index.html'));
});

app.use((req, res) => {
  res.status(404).json({ ok: false, error: 'No encontrado' });
});

app.use((err, req, res, next) => {
  console.error(err);
  if (err && err.dbConfig) {
    return res.status(503).json({ ok: false, error: err.message });
  }
  res.status(500).json({ ok: false, error: 'Error interno del servidor' });
});

export default app;
