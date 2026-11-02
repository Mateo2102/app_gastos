// Lógica de las rutas de acceso (iniciar login, volver de Google, salir). Las rutas de app/api/auth/* son
// envoltorios finos de estas funciones, que usan solo Request/Response estándar y se pueden probar sin Next.

import { google } from 'googleapis';
import {
  leerConfig, nombreCookieSesion, crearSesion, firmar, verificar, nuevoLogin, desafioPKCE, iguales,
  emailPermitido, leerCookie, cookieSet, COOKIE_LOGIN, DURACION_SESION_S, DURACION_LOGIN_S
} from './auth.js';

// Códigos que ve la pantalla de acceso (no se muestran detalles técnicos).
export const MOTIVOS = ['config', 'estado', 'expirado', 'google', 'no-permitido', 'cancelado'];

const SCOPE = 'openid email';
const AHORA = () => Math.floor(Date.now() / 1000);

function origenDe(req, config) {
  // En producción, si APP_URL está definida se usa esa (no se confía en cabeceras del pedido).
  return config.baseUrl || new URL(req.url).origin;
}

function redireccion(url, cookies = []) {
  const h = new Headers({ Location: url, 'Cache-Control': 'no-store' });
  cookies.forEach((c) => h.append('Set-Cookie', c));
  return new Response(null, { status: 302, headers: h });
}

const borrarLogin = (config) => cookieSet(COOKIE_LOGIN, '', { maxAge: 0, path: '/api/auth', produccion: config.produccion });

export function urlDeLogin({ clientId, redirectUri, state, nonce, desafio }) {
  const u = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  u.search = new URLSearchParams({
    client_id: clientId, redirect_uri: redirectUri, response_type: 'code', scope: SCOPE,
    state, nonce, code_challenge: desafio, code_challenge_method: 'S256', prompt: 'select_account'
  }).toString();
  return u.toString();
}

// GET /api/auth/google: arranca el login con Google.
export function iniciarLogin(req, env = process.env) {
  const config = leerConfig(env);
  const origen = origenDe(req, config);
  if (!config.completa) return redireccion(`${origen}/login?e=config`);

  const login = nuevoLogin();
  const cookieLogin = firmar({ t: 'login', ...login, exp: AHORA() + DURACION_LOGIN_S }, config.secret);
  const url = urlDeLogin({
    clientId: config.clientId, redirectUri: `${origen}/api/auth/callback`,
    state: login.state, nonce: login.nonce, desafio: desafioPKCE(login.verifier)
  });
  return redireccion(url, [cookieSet(COOKIE_LOGIN, cookieLogin, { maxAge: DURACION_LOGIN_S, path: '/api/auth', produccion: config.produccion })]);
}

// Valida lo que vuelve de Google. Devuelve { email } o lanza un Error con `codigo`.
export async function completarLogin({ code, state, cookieLogin, config, redirectUri, ahoraS = AHORA(), crearCliente }) {
  const falla = (codigo, detalle) => Object.assign(new Error(detalle || codigo), { codigo });
  const login = verificar(cookieLogin, config.secret, 'login', ahoraS);
  if (!login) throw falla('expirado');
  if (!state || !iguales(state, login.state)) throw falla('estado');
  if (!code) throw falla('google', 'falta el código');

  const cliente = crearCliente(config, redirectUri);
  let tokens;
  try {
    ({ tokens } = await cliente.getToken({ code, codeVerifier: login.verifier }));
  } catch (e) {
    throw falla('google', 'no se pudo canjear el código: ' + (e && e.message));
  }
  if (!tokens || !tokens.id_token) throw falla('google', 'Google no devolvió id_token');

  let datos;
  try {
    const ticket = await cliente.verifyIdToken({ idToken: tokens.id_token, audience: config.clientId });
    datos = ticket.getPayload();
  } catch (e) {
    throw falla('google', 'id_token inválido: ' + (e && e.message));
  }
  if (!datos || !iguales(datos.nonce || '', login.nonce)) throw falla('estado', 'nonce distinto');
  if (!emailPermitido(datos.email, datos.email_verified, config.permitidos)) {
    throw falla('no-permitido', 'correo no permitido o sin verificar');
  }
  return { email: String(datos.email).toLowerCase() };
}

const clienteGoogle = (config, redirectUri) => new google.auth.OAuth2(config.clientId, config.clientSecret, redirectUri);

// GET /api/auth/callback: vuelta de Google.
export async function terminarLogin(req, env = process.env, crearCliente = clienteGoogle) {
  const config = leerConfig(env);
  const origen = origenDe(req, config);
  if (!config.completa) return redireccion(`${origen}/login?e=config`);

  const params = new URL(req.url).searchParams;
  if (params.get('error')) return redireccion(`${origen}/login?e=cancelado`, [borrarLogin(config)]);

  try {
    const { email } = await completarLogin({
      code: params.get('code'), state: params.get('state'), cookieLogin: leerCookie(req.headers.get('cookie'), COOKIE_LOGIN),
      config, redirectUri: `${origen}/api/auth/callback`, crearCliente
    });
    const sesion = cookieSet(nombreCookieSesion(config), crearSesion(email, config.secret), { maxAge: DURACION_SESION_S, path: '/', produccion: config.produccion });
    return redireccion(`${origen}/`, [sesion, borrarLogin(config)]);
  } catch (e) {
    console.error('Login rechazado:', e && e.codigo, '-', e && e.message);
    const codigo = MOTIVOS.includes(e && e.codigo) ? e.codigo : 'google';
    return redireccion(`${origen}/login?e=${codigo}`, [borrarLogin(config)]);
  }
}

// POST /api/auth/salir: cierra la sesión.
export function cerrarSesion(env = process.env) {
  const config = leerConfig(env);
  const h = new Headers({ 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  h.append('Set-Cookie', cookieSet(nombreCookieSesion(config), '', { maxAge: 0, path: '/', produccion: config.produccion }));
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: h });
}
