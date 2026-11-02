// Pruebas del acceso privado: sesión firmada, lista permitida y decisión de acceso. Correr con: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  leerConfig, firmar, verificar, crearSesion, leerSesion, desafioPKCE, nuevoLogin, emailPermitido,
  leerCookie, cookieSet, decidirAcceso, nombreCookieSesion, DURACION_SESION_S
} from './auth.js';

const SECRET = 'x'.repeat(40);
const AHORA = 1_800_000_000;
const ENV_OK = { NODE_ENV: 'production', AUTH_SECRET: SECRET, GOOGLE_OAUTH_CLIENT_ID: 'id.apps.googleusercontent.com', GOOGLE_OAUTH_CLIENT_SECRET: 'cs', AUTH_ALLOWED_EMAILS: 'Yo@Gmail.com, otra@x.com' };
const cfg = (extra = {}) => leerConfig({ ...ENV_OK, ...extra });
const cookieDe = (config, email = 'yo@gmail.com', ahora = AHORA) => `${nombreCookieSesion(config)}=${crearSesion(email, config.secret, ahora)}`;

// ------------------------------------------------------------ configuración

test('configuración completa: correos en minúscula y sin espacios', () => {
  const c = cfg();
  assert.equal(c.completa, true);
  assert.deepEqual(c.permitidos, ['yo@gmail.com', 'otra@x.com']);
  assert.equal(c.produccion, true);
  assert.equal(c.abiertoEnDesarrollo, false);
});

test('en producción, si falta CUALQUIER variable el acceso queda cerrado (nunca abierto)', () => {
  for (const faltante of ['AUTH_SECRET', 'GOOGLE_OAUTH_CLIENT_ID', 'GOOGLE_OAUTH_CLIENT_SECRET', 'AUTH_ALLOWED_EMAILS']) {
    const c = cfg({ [faltante]: '' });
    assert.equal(c.completa, false, faltante);
    assert.equal(c.abiertoEnDesarrollo, false, faltante + ' en producción no abre nada');
  }
  assert.equal(leerConfig({ NODE_ENV: 'production' }).abiertoEnDesarrollo, false, 'ni sin ninguna variable');
});

test('un secreto corto no cuenta como configuración completa', () => {
  assert.equal(cfg({ AUTH_SECRET: 'corto' }).completa, false);
  assert.equal(cfg({ AUTH_SECRET: 'y'.repeat(31) }).completa, false);
  assert.equal(cfg({ AUTH_SECRET: 'y'.repeat(32) }).completa, true);
});

test('solo en desarrollo y sin ninguna variable de acceso la app queda abierta', () => {
  assert.equal(leerConfig({ NODE_ENV: 'development' }).abiertoEnDesarrollo, true);
  assert.equal(leerConfig({}).abiertoEnDesarrollo, true, 'sin NODE_ENV (no es producción)');
  assert.equal(leerConfig({ NODE_ENV: 'development', AUTH_SECRET: SECRET }).abiertoEnDesarrollo, false, 'con configuración parcial no se abre');
  assert.equal(leerConfig({ NODE_ENV: 'development', AUTH_ALLOWED_EMAILS: 'a@b.com' }).abiertoEnDesarrollo, false);
  assert.equal(leerConfig({ ...ENV_OK, NODE_ENV: 'development' }).abiertoEnDesarrollo, false, 'configurado: se exige sesión también en local');
});

test('la cookie de producción usa el prefijo __Host-', () => {
  assert.equal(nombreCookieSesion(cfg()), '__Host-sesion');
  assert.equal(nombreCookieSesion(cfg({ NODE_ENV: 'development' })), 'sesion');
});

// ------------------------------------------------------------ firma de cookies

test('una sesión firmada se lee de vuelta', () => {
  const v = crearSesion('Yo@Gmail.com', SECRET, AHORA);
  const p = verificar(v, SECRET, 'sesion', AHORA + 10);
  assert.equal(p.email, 'yo@gmail.com');
  assert.equal(p.exp - p.iat, DURACION_SESION_S);
});

test('cualquier alteración invalida la sesión', () => {
  const v = crearSesion('yo@gmail.com', SECRET, AHORA);
  const [cuerpo, firma] = v.split('.');
  const otroCuerpo = Buffer.from(JSON.stringify({ t: 'sesion', email: 'intruso@x.com', iat: AHORA, exp: AHORA + 1e6 })).toString('base64url');
  assert.equal(verificar(otroCuerpo + '.' + firma, SECRET, 'sesion', AHORA), null, 'cuerpo cambiado');
  assert.equal(verificar(cuerpo + '.' + firma.slice(0, -2) + 'AA', SECRET, 'sesion', AHORA), null, 'firma alterada');
  assert.equal(verificar(v, 'z'.repeat(40), 'sesion', AHORA), null, 'otro secreto');
  for (const basura of ['', null, undefined, 'a', 'a.b.c', '.', 'a.', '.b', 'AAAA.BBBB', '%%%.%%%']) {
    assert.equal(verificar(basura, SECRET, 'sesion', AHORA), null, String(basura));
  }
});

test('una sesión vencida no sirve (y justo al vencer tampoco)', () => {
  const v = crearSesion('yo@gmail.com', SECRET, AHORA);
  assert.ok(verificar(v, SECRET, 'sesion', AHORA + DURACION_SESION_S - 1));
  assert.equal(verificar(v, SECRET, 'sesion', AHORA + DURACION_SESION_S), null);
  assert.equal(verificar(v, SECRET, 'sesion', AHORA + DURACION_SESION_S + 5000), null);
});

test('la cookie de login no se puede usar como sesión (el tipo cuenta)', () => {
  const login = firmar({ t: 'login', email: 'yo@gmail.com', exp: AHORA + 600 }, SECRET);
  assert.equal(verificar(login, SECRET, 'sesion', AHORA), null);
  assert.ok(verificar(login, SECRET, 'login', AHORA));
  const sinTipo = firmar({ email: 'yo@gmail.com', exp: AHORA + 600 }, SECRET);
  assert.equal(verificar(sinTipo, SECRET, 'sesion', AHORA), null);
});

test('una firma válida con exp inválido o sin exp se rechaza', () => {
  for (const exp of [undefined, 'mañana', null, NaN, AHORA - 1]) {
    assert.equal(verificar(firmar({ t: 'sesion', email: 'a@b.com', exp }, SECRET), SECRET, 'sesion', AHORA), null, String(exp));
  }
});

test('quitar un correo de la lista permitida revoca sus sesiones al instante', () => {
  const c = cfg();
  const valor = crearSesion('yo@gmail.com', c.secret, AHORA);
  assert.equal(leerSesion(valor, c, AHORA + 1).email, 'yo@gmail.com');
  const sinYo = cfg({ AUTH_ALLOWED_EMAILS: 'otra@x.com' });
  assert.equal(leerSesion(valor, sinYo, AHORA + 1), null);
});

// ------------------------------------------------------------ correo y PKCE

test('emailPermitido: exige correo verificado y que esté en la lista (sin distinguir mayúsculas)', () => {
  const lista = ['yo@gmail.com'];
  assert.equal(emailPermitido('YO@gmail.com', true, lista), true);
  assert.equal(emailPermitido(' yo@gmail.com ', true, lista), true);
  assert.equal(emailPermitido('yo@gmail.com', false, lista), false, 'no verificado');
  assert.equal(emailPermitido('yo@gmail.com', undefined, lista), false);
  assert.equal(emailPermitido('yo@gmail.com', 'true', lista), false, 'solo el booleano true');
  assert.equal(emailPermitido('otro@gmail.com', true, lista), false);
  assert.equal(emailPermitido('yo@gmail.com.evil.com', true, lista), false);
  assert.equal(emailPermitido('yo@gmail.com', true, []), false, 'lista vacía: nadie');
  assert.equal(emailPermitido(null, true, lista), false);
});

test('PKCE: coincide con el vector de prueba del RFC 7636', () => {
  assert.equal(desafioPKCE('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'), 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
});

test('cada login genera estado, nonce y verificador distintos y largos', () => {
  const a = nuevoLogin(), b = nuevoLogin();
  for (const k of ['state', 'nonce', 'verifier']) {
    assert.ok(a[k].length >= 43, k);
    assert.notEqual(a[k], b[k], k);
  }
  assert.equal(new Set([a.state, a.nonce, a.verifier]).size, 3);
});

// ------------------------------------------------------------ cookies

test('leerCookie encuentra la cookie correcta entre varias', () => {
  assert.equal(leerCookie('a=1; sesion=xyz; b=2', 'sesion'), 'xyz');
  assert.equal(leerCookie('a=1; xsesion=nope', 'sesion'), null);
  assert.equal(leerCookie('sesion=a=b=c', 'sesion'), 'a=b=c');
  assert.equal(leerCookie(null, 'sesion'), null);
  assert.equal(leerCookie('', 'sesion'), null);
});

test('cookieSet: HttpOnly y SameSite siempre; Secure en producción', () => {
  const prod = cookieSet('__Host-sesion', 'v', { maxAge: 100, produccion: true });
  assert.match(prod, /HttpOnly/);
  assert.match(prod, /SameSite=Lax/);
  assert.match(prod, /Secure/);
  assert.match(prod, /Path=\//);
  assert.ok(!/Domain=/.test(prod), '__Host- exige no tener Domain');
  assert.ok(!/Secure/.test(cookieSet('sesion', 'v', { maxAge: 1, produccion: false })));
});

// ------------------------------------------------------------ decisión de acceso

const pedir = (config, o = {}) => decidirAcceso({ pathname: '/', method: 'GET', cookie: null, origin: null, host: 'app.example.com', ...o }, config, AHORA + 5);

test('sin sesión: las páginas redirigen al login y la API responde 401', () => {
  const c = cfg();
  const pagina = pedir(c, { pathname: '/' });
  assert.deepEqual([pagina.permitir, pagina.api, pagina.status, pagina.destino], [false, false, 401, '/login']);
  for (const p of ['/api/historico', '/api/gastos', '/api/gastos/g_1', '/api/dashboard', '/api/opciones', '/api/config', '/api/sueldo/2026-1', '/api/ahorro']) {
    const d = pedir(c, { pathname: p });
    assert.deepEqual([p, d.permitir, d.api, d.status], [p, false, true, 401]);
  }
});

test('con sesión válida pasa todo', () => {
  const c = cfg();
  const cookie = cookieDe(c);
  for (const p of ['/', '/api/historico', '/api/gastos']) assert.equal(pedir(c, { pathname: p, cookie }).permitir, true, p);
  assert.equal(pedir(c, { cookie }).email, 'yo@gmail.com');
});

test('solo el login y las rutas de acceso son públicas', () => {
  const c = cfg();
  for (const p of ['/login', '/api/auth/google', '/api/auth/callback', '/api/auth/salir']) assert.equal(pedir(c, { pathname: p }).permitir, true, p);
  for (const p of ['/login/x', '/api/auth', '/api/auth/otra', '/api/auth/google/x', '/Login', '//login', '/api/authx', '/api/gastos/../auth/google']) {
    assert.equal(pedir(c, { pathname: p }).permitir, false, p + ' no debe ser pública');
  }
});

test('configuración incompleta en producción: 503 explícito, no entra nadie (ni con cookie)', () => {
  const c = cfg({ GOOGLE_OAUTH_CLIENT_SECRET: '' });
  const api = pedir(c, { pathname: '/api/historico', cookie: `__Host-sesion=${crearSesion('yo@gmail.com', SECRET, AHORA)}` });
  assert.deepEqual([api.permitir, api.status, api.api], [false, 503, true]);
  const pag = pedir(c, { pathname: '/' });
  assert.deepEqual([pag.permitir, pag.status, pag.destino], [false, 503, '/login?e=config']);
});

test('desarrollo sin variables: abierto; con variables: exige sesión', () => {
  assert.equal(pedir(leerConfig({ NODE_ENV: 'development' }), { pathname: '/api/historico' }).permitir, true);
  assert.equal(pedir(leerConfig({ ...ENV_OK, NODE_ENV: 'development' }), { pathname: '/api/historico' }).permitir, false);
});

test('cookies inválidas, de otro tipo o de otro secreto no entran', () => {
  const c = cfg();
  const nombre = nombreCookieSesion(c);
  const ajena = crearSesion('yo@gmail.com', 'z'.repeat(40), AHORA);
  const login = firmar({ t: 'login', email: 'yo@gmail.com', exp: AHORA + 600 }, SECRET);
  const vencida = crearSesion('yo@gmail.com', SECRET, AHORA - DURACION_SESION_S - 10);
  const noPermitido = crearSesion('intruso@x.com', SECRET, AHORA);
  for (const valor of [ajena, login, vencida, noPermitido, 'basura', '']) {
    assert.equal(pedir(c, { pathname: '/api/historico', cookie: `${nombre}=${valor}` }).permitir, false);
  }
  assert.equal(pedir(c, { pathname: '/api/historico', cookie: `sesion=${crearSesion('yo@gmail.com', SECRET, AHORA)}` }).permitir, false, 'en producción vale solo la cookie __Host-');
});

test('pedidos que modifican datos desde otro origen se rechazan (403) aunque haya sesión', () => {
  const c = cfg();
  const cookie = cookieDe(c);
  const mal = pedir(c, { pathname: '/api/gastos', method: 'POST', cookie, origin: 'https://sitio-malo.com', host: 'app.example.com' });
  assert.deepEqual([mal.permitir, mal.status], [false, 403]);
  for (const m of ['POST', 'DELETE', 'PUT', 'PATCH']) {
    assert.equal(pedir(c, { pathname: '/api/gastos', method: m, cookie, origin: 'https://sitio-malo.com', host: 'app.example.com' }).permitir, false, m);
  }
  assert.equal(pedir(c, { pathname: '/api/gastos', method: 'POST', cookie, origin: 'https://app.example.com', host: 'app.example.com' }).permitir, true, 'mismo origen: ok');
  assert.equal(pedir(c, { pathname: '/api/gastos', method: 'POST', cookie, origin: 'no es una url', host: 'app.example.com' }).permitir, false, 'origen ilegible');
  assert.equal(pedir(c, { pathname: '/api/historico', method: 'GET', cookie, origin: 'https://otro.com', host: 'app.example.com' }).permitir, true, 'las lecturas no se filtran por origen');
});

test('la sesión se elige por el nombre exacto de la cookie', () => {
  const c = cfg();
  const valor = crearSesion('yo@gmail.com', SECRET, AHORA);
  assert.equal(pedir(c, { cookie: `x__Host-sesion=${valor}` }).permitir, false);
  assert.equal(pedir(c, { cookie: `otra=1; __Host-sesion=${valor}; z=2` }).permitir, true);
});

test('comparaciones de secreto con tiempo constante: usa timingSafeEqual', () => {
  // la firma se compara por Buffer con timingSafeEqual; un largo distinto no debe lanzar excepción
  const v = crearSesion('yo@gmail.com', SECRET, AHORA);
  const [cuerpo] = v.split('.');
  assert.doesNotThrow(() => verificar(cuerpo + '.' + 'A', SECRET, 'sesion', AHORA));
  assert.equal(verificar(cuerpo + '.' + crypto.randomBytes(8).toString('base64url'), SECRET, 'sesion', AHORA), null);
});
