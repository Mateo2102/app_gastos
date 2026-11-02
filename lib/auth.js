// Acceso privado: sesión firmada, lista de correos permitidos y decisión de acceso.
// Todo es puro (solo node:crypto, sin Next ni red) para poder probarlo. Falla CERRADO: si falta algo de la
// configuración en producción, no entra nadie.

import crypto from 'node:crypto';

export const DURACION_SESION_S = 14 * 24 * 3600; // 14 días
export const DURACION_LOGIN_S = 10 * 60;         // el "ida y vuelta" a Google tiene 10 minutos
export const COOKIE_LOGIN = 'login_tmp';

// Rutas que se pueden abrir sin sesión (el resto exige sesión).
const PUBLICAS = new Set(['/login', '/api/auth/google', '/api/auth/callback', '/api/auth/salir']);

// ---------- Configuración ----------

export function leerConfig(env = process.env) {
  const produccion = env.NODE_ENV === 'production';
  const secret = String(env.AUTH_SECRET || '');
  const clientId = String(env.GOOGLE_OAUTH_CLIENT_ID || '').trim();
  const clientSecret = String(env.GOOGLE_OAUTH_CLIENT_SECRET || '').trim();
  const permitidos = String(env.AUTH_ALLOWED_EMAILS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  const baseUrl = String(env.APP_URL || '').trim().replace(/\/+$/, '');
  const completa = secret.length >= 32 && !!clientId && !!clientSecret && permitidos.length > 0;
  // Solo en desarrollo y sin NINGUNA variable de acceso configurada la app queda abierta (para trabajar en local).
  // En producción nunca: si falta algo, el acceso queda cerrado.
  const abiertoEnDesarrollo = !produccion && !secret && !clientId && !clientSecret && permitidos.length === 0;
  return { produccion, secret, clientId, clientSecret, permitidos, baseUrl, completa, abiertoEnDesarrollo };
}

// En producción la cookie lleva el prefijo __Host- (obliga a Secure, Path=/ y sin Domain).
export function nombreCookieSesion(config) {
  return config.produccion ? '__Host-sesion' : 'sesion';
}

// ---------- Firma de cookies (HMAC-SHA256) ----------

export function firmar(payload, secret) {
  const cuerpo = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const firma = crypto.createHmac('sha256', secret).update(cuerpo).digest('base64url');
  return cuerpo + '.' + firma;
}

// Devuelve el contenido si la firma es válida, el tipo coincide y no venció; si no, null.
export function verificar(valor, secret, tipo, ahoraS = Math.floor(Date.now() / 1000)) {
  if (!valor || !secret) return null;
  const partes = String(valor).split('.');
  if (partes.length !== 2 || !partes[0] || !partes[1]) return null;
  const esperada = crypto.createHmac('sha256', secret).update(partes[0]).digest();
  let recibida;
  try { recibida = Buffer.from(partes[1], 'base64url'); } catch { return null; }
  if (recibida.length !== esperada.length || !crypto.timingSafeEqual(recibida, esperada)) return null;
  let p;
  try { p = JSON.parse(Buffer.from(partes[0], 'base64url').toString('utf8')); } catch { return null; }
  if (!p || typeof p !== 'object' || p.t !== tipo) return null;
  if (typeof p.exp !== 'number' || p.exp <= ahoraS) return null;
  return p;
}

export function crearSesion(email, secret, ahoraS = Math.floor(Date.now() / 1000)) {
  return firmar({ t: 'sesion', email: String(email).toLowerCase(), iat: ahoraS, exp: ahoraS + DURACION_SESION_S }, secret);
}

// Sesión válida: firma correcta, vigente y el correo SIGUE en la lista permitida (quitarlo la revoca al instante).
export function leerSesion(valorCookie, config, ahoraS = Math.floor(Date.now() / 1000)) {
  const p = verificar(valorCookie, config.secret, 'sesion', ahoraS);
  if (!p || typeof p.email !== 'string') return null;
  return config.permitidos.includes(p.email.toLowerCase()) ? { email: p.email.toLowerCase() } : null;
}

// ---------- Login con Google: estado, nonce y PKCE ----------

const aleatorio = () => crypto.randomBytes(32).toString('base64url');

export function nuevoLogin() {
  return { state: aleatorio(), nonce: aleatorio(), verifier: aleatorio() };
}

export function desafioPKCE(verifier) {
  return crypto.createHash('sha256').update(verifier).digest('base64url');
}

export function iguales(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

export function emailPermitido(email, verificado, permitidos) {
  return verificado === true && typeof email === 'string' && permitidos.includes(email.trim().toLowerCase());
}

// ---------- Cookies ----------

export function leerCookie(header, nombre) {
  if (!header) return null;
  for (const par of String(header).split(';')) {
    const i = par.indexOf('=');
    if (i < 0) continue;
    if (par.slice(0, i).trim() === nombre) return par.slice(i + 1).trim();
  }
  return null;
}

export function cookieSet(nombre, valor, { maxAge, path = '/', produccion = false } = {}) {
  return `${nombre}=${valor}; Path=${path}; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${produccion ? '; Secure' : ''}`;
}

// ---------- Decisión de acceso ----------

// Devuelve { permitir: true } o { permitir: false, api, status, mensaje, destino }.
//   solicitud: { pathname, method, cookie, origin, host }
export function decidirAcceso({ pathname, method = 'GET', cookie = null, origin = null, host = null }, config, ahoraS = Math.floor(Date.now() / 1000)) {
  if (PUBLICAS.has(pathname)) return { permitir: true };
  if (config.abiertoEnDesarrollo) return { permitir: true };

  const api = pathname === '/api' || pathname.startsWith('/api/');

  if (!config.completa) {
    return { permitir: false, api, status: 503, mensaje: 'El acceso todavía no está configurado en el servidor.', destino: '/login?e=config' };
  }

  const sesion = leerSesion(leerCookie(cookie, nombreCookieSesion(config)), config, ahoraS);
  if (!sesion) {
    return { permitir: false, api, status: 401, mensaje: 'Iniciá sesión para continuar.', destino: '/login' };
  }

  // Defensa extra contra pedidos de otro sitio que cambian datos (además de SameSite=Lax).
  const modifica = !['GET', 'HEAD', 'OPTIONS'].includes(String(method).toUpperCase());
  if (modifica && origin) {
    let hostOrigen = null;
    try { hostOrigen = new URL(origin).host; } catch { /* origen inválido */ }
    if (!hostOrigen || (host && hostOrigen !== host)) {
      return { permitir: false, api, status: 403, mensaje: 'Pedido rechazado (origen no permitido).', destino: '/login' };
    }
  }
  return { permitir: true, email: sesion.email };
}
