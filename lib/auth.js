import { createHmac, createHash, timingSafeEqual } from 'node:crypto';
import { getSetting } from './db.js';

const COOKIE = 'cv_session';
const TTL_MS = 1000 * 60 * 60 * 12;

function secret() {
  return process.env.JWT_SECRET || 'dev-secret-cambiar-en-produccion';
}

function b64url(input) {
  return Buffer.from(input).toString('base64url');
}

export function signToken(payload) {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify({ ...payload, exp: Date.now() + TTL_MS }));
  const sig = createHmac('sha256', secret()).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${sig}`;
}

export function verifyToken(token) {
  if (!token) return null;
  const parts = String(token).split('.');
  if (parts.length !== 3) return null;
  const [h, b, s] = parts;
  const expected = createHmac('sha256', secret()).update(`${h}.${b}`).digest('base64url');
  const sb = Buffer.from(s);
  const eb = Buffer.from(expected);
  if (sb.length !== eb.length || !timingSafeEqual(sb, eb)) return null;
  try {
    const payload = JSON.parse(Buffer.from(b, 'base64url').toString());
    if (!payload.exp || payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

export function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of String(header).split(';')) {
    const idx = part.indexOf('=');
    if (idx > -1) out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

function secure() {
  return process.env.VERCEL ? '; Secure' : '';
}

export function setSession(res, user) {
  const token = signToken({ sub: user });
  res.setHeader(
    'Set-Cookie',
    `${COOKIE}=${token}; HttpOnly; Path=/; Max-Age=${TTL_MS / 1000}; SameSite=Lax${secure()}`
  );
}

export function clearSession(res) {
  res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax${secure()}`);
}

export function currentUser(req) {
  const cookies = parseCookies(req.headers.cookie);
  return verifyToken(cookies[COOKIE]);
}

function safeEq(a, b) {
  const ab = Buffer.from(String(a ?? ''));
  const bb = Buffer.from(String(b ?? ''));
  if (ab.length !== bb.length) {
    timingSafeEqual(ab, ab);
    return false;
  }
  return timingSafeEqual(ab, bb);
}

export function hashPassword(pass) {
  return createHash('sha256').update(`${secret()}:${String(pass ?? '')}`).digest('hex');
}

export async function credentialsOk(user, pass) {
  const expectedUser = process.env.ADMIN_USER || 'admin';
  const expectedPass = process.env.ADMIN_PASS || 'admin123';
  const storedHash = await getSetting('admin_pass_hash');
  const okUser = safeEq(user, expectedUser);
  const okPass = storedHash ? safeEq(hashPassword(pass), storedHash) : safeEq(pass, expectedPass);
  return okUser && okPass;
}

export function requireAuth(req, res, next) {
  if (!currentUser(req)) {
    return res.status(401).json({ ok: false, error: 'No autenticado' });
  }
  next();
}
