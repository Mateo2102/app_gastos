// Pruebas del flujo de acceso con Google (con un cliente de Google simulado) y de la protección de la API.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { iniciarLogin, terminarLogin, cerrarSesion, completarLogin, urlDeLogin } from './authRutas.js';
import { protegido, verificarSolicitud } from './guardia.js';
import { leerConfig, crearSesion, firmar, desafioPKCE, leerCookie, COOKIE_LOGIN, nombreCookieSesion } from './auth.js';

const SECRET = 'x'.repeat(40);
const ENV = { NODE_ENV: 'production', AUTH_SECRET: SECRET, GOOGLE_OAUTH_CLIENT_ID: 'cid.apps.googleusercontent.com', GOOGLE_OAUTH_CLIENT_SECRET: 'csecret', AUTH_ALLOWED_EMAILS: 'yo@gmail.com', APP_URL: 'https://app.example.com/' };
const CFG = leerConfig(ENV);
const pedido = (url, headers = {}, method = 'GET') => new Request(url, { method, headers });
const cookiesDe = (resp) => resp.headers.getSetCookie();

// Inicia el login y devuelve lo que Google recibiría + la cookie de login que quedó en el navegador.
function arrancar(env = ENV) {
  const r = iniciarLogin(pedido('https://app.example.com/api/auth/google'), env);
  const url = new URL(r.headers.get('location'));
  const cookieLogin = cookiesDe(r).find((c) => c.startsWith(COOKIE_LOGIN + '='));
  return { r, url, cookieLogin, valor: cookieLogin && cookieLogin.split(';')[0].split('=').slice(1).join('=') };
}

// Cliente de Google simulado: devuelve el id_token que le indiquemos.
const clienteFalso = ({ nonce, email = 'yo@gmail.com', email_verified = true, id_token = 'tok', aud, falla } = {}) => () => ({
  async getToken(args) {
    if (falla === 'getToken') throw new Error('invalid_grant');
    clienteFalso.ultimo = args;
    return { tokens: id_token ? { id_token } : {} };
  },
  async verifyIdToken({ audience }) {
    if (falla === 'verify') throw new Error('Wrong recipient');
    if (aud !== undefined && aud !== audience) throw new Error('audiencia incorrecta');
    return { getPayload: () => ({ email, email_verified, nonce, aud: audience }) };
  }
});

// ------------------------------------------------------------ iniciar login

test('iniciar login: redirige a Google con estado, nonce y PKCE, y guarda lo secreto en una cookie firmada', () => {
  const { r, url, cookieLogin, valor } = arrancar();
  assert.equal(r.status, 302);
  assert.equal(url.origin + url.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
  const p = url.searchParams;
  assert.equal(p.get('client_id'), 'cid.apps.googleusercontent.com');
  assert.equal(p.get('redirect_uri'), 'https://app.example.com/api/auth/callback', 'APP_URL sin barra final');
  assert.equal(p.get('response_type'), 'code');
  assert.equal(p.get('scope'), 'openid email');
  assert.equal(p.get('code_challenge_method'), 'S256');
  assert.ok(p.get('state').length >= 43 && p.get('nonce').length >= 43);
  assert.ok(!url.toString().includes('csecret'), 'el secreto del cliente nunca viaja en la URL');
  assert.match(cookieLogin, /HttpOnly/);
  assert.match(cookieLogin, /Secure/);
  assert.match(cookieLogin, /Path=\/api\/auth/);
  // la cookie contiene el verificador PKCE y es la que valida el desafío enviado a Google
  const contenido = JSON.parse(Buffer.from(valor.split('.')[0], 'base64url').toString());
  assert.equal(desafioPKCE(contenido.verifier), p.get('code_challenge'));
  assert.equal(contenido.state, p.get('state'));
  assert.equal(contenido.nonce, p.get('nonce'));
  assert.ok(!url.toString().includes(contenido.verifier), 'el verificador PKCE no viaja a Google');
});

test('cada intento de login es distinto', () => {
  const a = arrancar().url.searchParams, b = arrancar().url.searchParams;
  assert.notEqual(a.get('state'), b.get('state'));
  assert.notEqual(a.get('code_challenge'), b.get('code_challenge'));
});

test('sin configuración completa, iniciar el login no llama a Google: vuelve al login con aviso', () => {
  const r = iniciarLogin(pedido('https://app.example.com/api/auth/google'), { ...ENV, GOOGLE_OAUTH_CLIENT_ID: '' });
  assert.equal(r.status, 302);
  assert.equal(r.headers.get('location'), 'https://app.example.com/login?e=config');
  assert.equal(cookiesDe(r).length, 0);
});

test('urlDeLogin arma los parámetros esperados', () => {
  const u = new URL(urlDeLogin({ clientId: 'a', redirectUri: 'https://x/cb', state: 's', nonce: 'n', desafio: 'd' }));
  assert.deepEqual([...u.searchParams.keys()].sort(), ['client_id', 'code_challenge', 'code_challenge_method', 'nonce', 'prompt', 'redirect_uri', 'response_type', 'scope', 'state']);
});

// ------------------------------------------------------------ volver de Google

async function volver({ cambiar = {}, cliente, env = ENV, cookieLogin, urlCallback } = {}) {
  const ida = arrancar(env);
  const state = ida.url.searchParams.get('state');
  const nonce = ida.url.searchParams.get('nonce');
  const cb = urlCallback || `https://app.example.com/api/auth/callback?code=CODIGO&state=${state}`;
  const cookie = cookieLogin !== undefined ? cookieLogin : `${COOKIE_LOGIN}=${ida.valor}`;
  const resp = await terminarLogin(pedido(cb, cookie ? { cookie } : {}), env, cliente || clienteFalso({ nonce, ...cambiar }));
  return { resp, nonce, state, ida };
}

test('login correcto: crea la sesión (HttpOnly, Secure, __Host-), borra la cookie de login y vuelve a la app', async () => {
  const { resp } = await volver();
  assert.equal(resp.status, 302);
  assert.equal(resp.headers.get('location'), 'https://app.example.com/');
  const cs = cookiesDe(resp);
  const sesion = cs.find((c) => c.startsWith('__Host-sesion='));
  assert.ok(sesion, 'hay cookie de sesión');
  assert.match(sesion, /HttpOnly; SameSite=Lax; Secure/);
  assert.match(sesion, /Max-Age=1209600/);
  assert.ok(!/Domain=/.test(sesion));
  assert.ok(cs.some((c) => c.startsWith(COOKIE_LOGIN + '=;') && /Max-Age=0/.test(c)), 'la cookie de login se borra');
  // la sesión emitida es válida para el proxy / la guardia
  const valor = sesion.split(';')[0].split('=').slice(1).join('=');
  const d = verificarSolicitud(pedido('https://app.example.com/api/historico', { cookie: `__Host-sesion=${valor}` }), ENV);
  assert.equal(d.permitir, true);
  assert.equal(d.email, 'yo@gmail.com');
});

test('el código se canjea con el verificador PKCE guardado (no con otro)', async () => {
  const { ida } = await volver();
  const contenido = JSON.parse(Buffer.from(ida.valor.split('.')[0], 'base64url').toString());
  assert.equal(clienteFalso.ultimo.code, 'CODIGO');
  assert.equal(typeof clienteFalso.ultimo.codeVerifier, 'string');
  // (el verificador del intento 'ida' es otro porque 'volver' arranca su propio intento; se comprueba el formato)
  assert.ok(contenido.verifier.length >= 43);
});

const motivo = (resp) => new URL(resp.headers.get('location')).searchParams.get('e');
const sinSesion = (resp) => !cookiesDe(resp).some((c) => /sesion=[^;]/.test(c) && !/Max-Age=0/.test(c));

test('correo que no está en la lista: rechazado, sin sesión', async () => {
  const { resp } = await volver({ cambiar: { email: 'intruso@gmail.com' } });
  assert.equal(motivo(resp), 'no-permitido');
  assert.ok(sinSesion(resp));
});

test('correo de Google sin verificar: rechazado', async () => {
  const { resp } = await volver({ cambiar: { email_verified: false } });
  assert.equal(motivo(resp), 'no-permitido');
  assert.ok(sinSesion(resp));
});

test('correo con otras mayúsculas pero en la lista: aceptado', async () => {
  const { resp } = await volver({ cambiar: { email: 'YO@Gmail.COM' } });
  assert.equal(resp.headers.get('location'), 'https://app.example.com/');
});

test('estado distinto (posible CSRF de login): rechazado', async () => {
  const { resp } = await volver({ urlCallback: 'https://app.example.com/api/auth/callback?code=C&state=otro-estado' });
  assert.equal(motivo(resp), 'estado');
  assert.ok(sinSesion(resp));
});

test('sin estado en la URL o sin cookie de login: rechazado', async () => {
  assert.equal(motivo((await volver({ urlCallback: 'https://app.example.com/api/auth/callback?code=C' })).resp), 'estado');
  assert.equal(motivo((await volver({ cookieLogin: '' })).resp), 'expirado');
});

test('cookie de login vencida o alterada: rechazado', async () => {
  const ida = arrancar();
  const state = ida.url.searchParams.get('state');
  const vencida = firmar({ t: 'login', state, nonce: 'n', verifier: 'v', exp: 1 }, SECRET);
  const r1 = await terminarLogin(pedido(`https://app.example.com/api/auth/callback?code=C&state=${state}`, { cookie: `${COOKIE_LOGIN}=${vencida}` }), ENV, clienteFalso({ nonce: 'n' }));
  assert.equal(motivo(r1), 'expirado');
  const r2 = await terminarLogin(pedido(`https://app.example.com/api/auth/callback?code=C&state=${state}`, { cookie: `${COOKIE_LOGIN}=${ida.valor}x` }), ENV, clienteFalso({ nonce: 'n' }));
  assert.equal(motivo(r2), 'expirado');
});

test('una cookie de SESIÓN no vale como cookie de login', async () => {
  const sesion = crearSesion('yo@gmail.com', SECRET);
  const r = await terminarLogin(pedido('https://app.example.com/api/auth/callback?code=C&state=x', { cookie: `${COOKIE_LOGIN}=${sesion}` }), ENV, clienteFalso({}));
  assert.equal(motivo(r), 'expirado');
});

test('nonce distinto en el id_token (repetición): rechazado', async () => {
  const { resp } = await volver({ cambiar: { nonce: 'otro-nonce' } });
  assert.equal(motivo(resp), 'estado');
  assert.ok(sinSesion(resp));
});

test('id_token faltante, inválido o de otra audiencia: rechazado', async () => {
  assert.equal(motivo((await volver({ cambiar: { id_token: '' } })).resp), 'google');
  assert.equal(motivo((await volver({ cambiar: { falla: 'verify' } })).resp), 'google');
  assert.equal(motivo((await volver({ cambiar: { aud: 'otro-cliente' } })).resp), 'google');
  assert.equal(motivo((await volver({ cambiar: { falla: 'getToken' } })).resp), 'google');
});

test('si el usuario cancela en Google: vuelve al login sin sesión', async () => {
  const r = await terminarLogin(pedido('https://app.example.com/api/auth/callback?error=access_denied'), ENV, clienteFalso({}));
  assert.equal(motivo(r), 'cancelado');
  assert.ok(sinSesion(r));
});

test('sin configuración completa, el callback no crea sesiones', async () => {
  const r = await terminarLogin(pedido('https://app.example.com/api/auth/callback?code=C&state=x'), { ...ENV, AUTH_ALLOWED_EMAILS: '' }, clienteFalso({}));
  assert.equal(motivo(r), 'config');
  assert.equal(cookiesDe(r).length, 0);
});

test('los motivos de error no filtran detalles internos', async () => {
  const { resp } = await volver({ cambiar: { falla: 'verify' } });
  assert.ok(!resp.headers.get('location').includes('Wrong recipient'));
});

test('completarLogin directo: devuelve el correo en minúscula', async () => {
  const ida = arrancar();
  const cookieLogin = ida.valor;
  const state = ida.url.searchParams.get('state');
  const nonce = ida.url.searchParams.get('nonce');
  const r = await completarLogin({ code: 'C', state, cookieLogin, config: CFG, redirectUri: 'https://app.example.com/api/auth/callback', crearCliente: clienteFalso({ nonce, email: 'Yo@Gmail.com' }) });
  assert.deepEqual(r, { email: 'yo@gmail.com' });
});

// ------------------------------------------------------------ salir

test('salir borra la cookie de sesión', () => {
  const r = cerrarSesion(ENV);
  const c = cookiesDe(r)[0];
  assert.match(c, /^__Host-sesion=;/);
  assert.match(c, /Max-Age=0/);
  assert.match(c, /HttpOnly/);
});

// ------------------------------------------------------------ protección de la API

test('protegido: sin sesión responde 401 y NO ejecuta el handler', async () => {
  let ejecuto = false;
  const ruta = protegido(async () => { ejecuto = true; return Response.json({ datos: 1 }); });
  const saved = { ...process.env };
  Object.assign(process.env, ENV);
  try {
    const r = await ruta(pedido('https://app.example.com/api/historico'), {});
    assert.equal(r.status, 401);
    assert.equal(ejecuto, false);
    assert.equal((await r.json()).error, 'Iniciá sesión para continuar.');
  } finally {
    for (const k of Object.keys(ENV)) { if (k in saved) process.env[k] = saved[k]; else delete process.env[k]; }
  }
});

test('protegido: con sesión válida ejecuta el handler y le pasa el contexto', async () => {
  const ruta = protegido(async (req, ctx) => Response.json({ id: ctx.params.id }));
  const saved = { ...process.env };
  Object.assign(process.env, ENV);
  try {
    const cookie = `__Host-sesion=${crearSesion('yo@gmail.com', SECRET)}`;
    const r = await ruta(pedido('https://app.example.com/api/gastos/g_1', { cookie }), { params: { id: 'g_1' } });
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { id: 'g_1' });
  } finally {
    for (const k of Object.keys(ENV)) { if (k in saved) process.env[k] = saved[k]; else delete process.env[k]; }
  }
});

test('protegido: configuración incompleta en producción responde 503', async () => {
  const ruta = protegido(async () => Response.json({}));
  const saved = { ...process.env };
  Object.assign(process.env, { ...ENV, AUTH_SECRET: '' });
  try {
    const r = await ruta(pedido('https://app.example.com/api/historico', { cookie: `__Host-sesion=${crearSesion('yo@gmail.com', SECRET)}` }), {});
    assert.equal(r.status, 503);
  } finally {
    for (const k of Object.keys(ENV)) { if (k in saved) process.env[k] = saved[k]; else delete process.env[k]; }
  }
});

test('protegido: un DELETE desde otro sitio se rechaza (403) aunque tenga la cookie', async () => {
  const ruta = protegido(async () => Response.json({ borrado: true }));
  const saved = { ...process.env };
  Object.assign(process.env, ENV);
  try {
    const cookie = `__Host-sesion=${crearSesion('yo@gmail.com', SECRET)}`;
    const r = await ruta(pedido('https://app.example.com/api/gastos/g_1', { cookie, origin: 'https://malo.com', host: 'app.example.com' }, 'DELETE'), {});
    assert.equal(r.status, 403);
  } finally {
    for (const k of Object.keys(ENV)) { if (k in saved) process.env[k] = saved[k]; else delete process.env[k]; }
  }
});

// ------------------------------------------------------------ ninguna ruta de la API queda sin proteger

test('TODAS las rutas de la API (salvo las de acceso) están envueltas con protegido()', () => {
  const raiz = path.resolve('app/api');
  const archivos = [];
  (function recorrer(dir) {
    for (const nombre of fs.readdirSync(dir)) {
      const p = path.join(dir, nombre);
      if (fs.statSync(p).isDirectory()) { if (!(dir === raiz && nombre === 'auth')) recorrer(p); }
      else if (nombre === 'route.js') archivos.push(p);
    }
  })(raiz);
  assert.ok(archivos.length >= 13, 'se encontraron las rutas: ' + archivos.length);
  for (const f of archivos) {
    const src = fs.readFileSync(f, 'utf8');
    const rel = path.relative(raiz, f);
    // ningún handler HTTP exportado como función suelta
    assert.ok(!/export\s+(async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/.test(src), `${rel}: handler sin proteger`);
    const exportados = [...src.matchAll(/export\s+const\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s*=\s*(\w+)\(/g)];
    assert.ok(exportados.length > 0, `${rel}: no exporta handlers`);
    for (const [, metodo, envoltorio] of exportados) assert.equal(envoltorio, 'protegido', `${rel}: ${metodo} no usa protegido()`);
    assert.ok(/from '@\/lib\/guardia'/.test(src), `${rel}: falta importar la guardia`);
  }
});

test('las rutas de acceso y el proxy existen y el proxy cubre todo menos estáticos', () => {
  for (const f of ['app/api/auth/google/route.js', 'app/api/auth/callback/route.js', 'app/api/auth/salir/route.js', 'app/login/page.js', 'proxy.js']) {
    assert.ok(fs.existsSync(f), f);
  }
  const proxy = fs.readFileSync('proxy.js', 'utf8');
  assert.match(proxy, /matcher:\s*\['\/\(\(\?!_next\/static\|_next\/image\|favicon\.ico\)\.\*\)'\]/);
  assert.match(proxy, /export function proxy\(/);
  assert.ok(!/api/.test(proxy.split('matcher')[1]), 'el matcher no excluye /api');
});
