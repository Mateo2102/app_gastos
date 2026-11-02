// Cartera de IOL: solo lectura, con respuestas simuladas (nunca se llama a IOL de verdad en los tests).

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { crearPlanillaFalsa, ENCABEZADO } from './__pruebas__/planillaFalsa.mjs';
import { ErrorApp } from './errores.js';

const cliente = await import('./sheetsClient.js');
const data = await import('./data.js');
const iol = await import('./iol.js');

const ENV = { IOL_USUARIO: 'usuario-de-prueba', IOL_CLAVE: 'clave-secreta-de-prueba' };

const ESTADO = {
  cuentas: [
    { tipo: 'inversion_Argentina_Pesos', moneda: 'peso_Argentino', disponible: 50000, comprometido: 0, saldo: 50000, titulosValorizados: 1200000, total: 1250000 },
    { tipo: 'inversion_Argentina_Dolares', moneda: 'dolar_Estadounidense', disponible: 100, comprometido: 0, saldo: 100, titulosValorizados: 300, total: 400 }
  ]
};
const PORTAFOLIO = {
  pais: 'argentina',
  activos: [
    { cantidad: 10, ultimoPrecio: 120000, valorizado: 1200000, gananciaDinero: 100000, gananciaPorcentaje: 9.09, variacionDiaria: 1.2, titulo: { simbolo: 'GGAL', descripcion: 'Grupo Galicia', tipo: 'ACCIONES', moneda: 'peso_Argentino' } },
    { cantidad: 5, ultimoPrecio: 60, valorizado: 300, gananciaDinero: 20, gananciaPorcentaje: 7.1, variacionDiaria: -0.3, titulo: { simbolo: 'AL30D', descripcion: 'Bonar 2030', tipo: 'TitulosPublicos', moneda: 'dolar_Estadounidense' } }
  ]
};

// IOL de mentira: registra los pedidos y responde según la ruta.
function iolFalso({ tokenOk = true, expiresIn = 900, rechazarPrimerGet = false } = {}) {
  const pedidos = [];
  let gets = 0;
  const fetchFn = async (url, opciones = {}) => {
    pedidos.push({ url, metodo: opciones.method, cuerpo: opciones.body, auth: opciones.headers && opciones.headers.Authorization });
    const respuesta = (cuerpo, status = 200) => ({ ok: status < 400, status, json: async () => cuerpo });
    if (url.endsWith('/token')) {
      if (!tokenOk) return respuesta({ error: 'invalid_grant', detalle: 'clave-secreta-de-prueba' }, 400);
      return respuesta({ access_token: `acceso-${pedidos.length}`, refresh_token: 'renovar-1', expires_in: expiresIn });
    }
    gets++;
    if (rechazarPrimerGet && gets === 1) return respuesta({}, 401);
    if (url.endsWith('/estadocuenta')) return respuesta(ESTADO);
    if (url.endsWith('/portafolio/argentina')) return respuesta(PORTAFOLIO);
    return respuesta({}, 404);
  };
  return { fetchFn, pedidos };
}

test('iolConfigurado: hace falta usuario Y clave', () => {
  assert.equal(iol.iolConfigurado(ENV), true);
  assert.equal(iol.iolConfigurado({ IOL_USUARIO: 'a' }), false);
  assert.equal(iol.iolConfigurado({ IOL_CLAVE: 'a' }), false);
  assert.equal(iol.iolConfigurado({ IOL_USUARIO: ' ', IOL_CLAVE: ' ' }), false);
  assert.equal(iol.iolConfigurado({}), false);
});

test('sin credenciales no se llama a IOL', async () => {
  iol.__prueba.reiniciar();
  const { fetchFn, pedidos } = iolFalso();
  await assert.rejects(() => iol.getCartera({ env: {}, fetchFn }), (e) => e instanceof ErrorApp && e.status === 503);
  assert.equal(pedidos.length, 0);
});

test('entra con usuario y clave, lee estado de cuenta y portafolio y normaliza por moneda', async () => {
  iol.__prueba.reiniciar();
  const { fetchFn, pedidos } = iolFalso();
  const c = await iol.getCartera({ env: ENV, fetchFn, ahora: 1000 });
  const token = pedidos[0];
  assert.equal(token.url, 'https://api.invertironline.com/token');
  assert.equal(token.metodo, 'POST');
  assert.deepEqual(Object.fromEntries(new URLSearchParams(token.cuerpo)), { username: 'usuario-de-prueba', password: 'clave-secreta-de-prueba', grant_type: 'password' });
  assert.equal(pedidos.filter((p) => p.url.endsWith('/token')).length, 1, 'las dos lecturas en paralelo comparten UN solo login');
  assert.ok(pedidos.slice(1).every((p) => p.metodo === 'GET' && /^Bearer acceso-/.test(p.auth)), 'el resto son GET con el token');
  assert.deepEqual(c.invertido, { ars: 1200000, usd: 300 });
  assert.deepEqual(c.disponible, { ars: 50000, usd: 100 });
  assert.deepEqual(c.total, { ars: 1250000, usd: 400 });
  assert.deepEqual(c.activos.map((a) => [a.simbolo, a.moneda]), [['GGAL', 'ARS'], ['AL30D', 'USD']]);
});

test('la cartera se guarda en caché 10 minutos y forzar la vuelve a pedir', async () => {
  iol.__prueba.reiniciar();
  const { fetchFn, pedidos } = iolFalso();
  await iol.getCartera({ env: ENV, fetchFn, ahora: 0 });
  const antes = pedidos.length;
  await iol.getCartera({ env: ENV, fetchFn, ahora: 5 * 60 * 1000 });
  assert.equal(pedidos.length, antes, 'a los 5 minutos no vuelve a llamar');
  await iol.getCartera({ env: ENV, fetchFn, ahora: 11 * 60 * 1000 });
  assert.ok(pedidos.length > antes, 'a los 11 minutos sí');
  const n = pedidos.length;
  await iol.getCartera({ env: ENV, fetchFn, ahora: 11 * 60 * 1000 + 1, forzar: true });
  assert.ok(pedidos.length > n, 'forzar saltea la caché');
});

test('el token vencido se renueva con el refresh token', async () => {
  iol.__prueba.reiniciar();
  const { fetchFn, pedidos } = iolFalso({ expiresIn: 900 });
  await iol.getCartera({ env: ENV, fetchFn, ahora: 0 });
  await iol.getCartera({ env: ENV, fetchFn, ahora: 20 * 60 * 1000 }); // pasaron 20 min: el token (15) venció
  const tokens = pedidos.filter((p) => p.url.endsWith('/token')).map((p) => Object.fromEntries(new URLSearchParams(p.cuerpo)));
  assert.equal(tokens[0].grant_type, 'password');
  assert.deepEqual(tokens[1], { refresh_token: 'renovar-1', grant_type: 'refresh_token' });
});

test('si IOL responde 401 se renueva el acceso y se reintenta una vez', async () => {
  iol.__prueba.reiniciar();
  const { fetchFn, pedidos } = iolFalso({ rechazarPrimerGet: true });
  const c = await iol.getCartera({ env: ENV, fetchFn, ahora: 0 });
  assert.equal(c.total.ars, 1250000);
  assert.ok(pedidos.filter((p) => p.url.endsWith('/token')).length >= 2);
});

test('usuario o clave incorrectos: error claro y la clave nunca aparece en el mensaje', async () => {
  iol.__prueba.reiniciar();
  const { fetchFn } = iolFalso({ tokenOk: false });
  await assert.rejects(() => iol.getCartera({ env: ENV, fetchFn }), (e) => {
    assert.equal(e.status, 502);
    assert.ok(!e.message.includes('clave-secreta-de-prueba') && !e.message.includes('usuario-de-prueba'));
    return /rechaz/i.test(e.message);
  });
});

test('una respuesta con campos que faltan no rompe la lectura', () => {
  const c = iol.normalizarCartera({}, { activos: [{ titulo: { simbolo: 'X' } }, null, {}] });
  assert.deepEqual(c.total, { ars: 0, usd: 0 });
  assert.equal(c.activos.length, 1);
  const vacia = iol.normalizarCartera(null, null);
  assert.deepEqual(vacia.activos, []);
});

test('SOLO LECTURA: el código de IOL no tiene forma de comprar, vender ni cancelar', () => {
  const codigo = ['lib/iol.js', 'app/api/iol/route.js'].map((f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8')).join('\n');
  assert.ok(!/operar|comprar|vender|eliminarorden|cancelar/i.test(codigo.replace(/\/\/.*$/gm, '')), 'no hay rutas ni funciones de operación');
  const metodos = [...codigo.matchAll(/method:\s*'(\w+)'/g)].map((m) => m[1]);
  assert.deepEqual(metodos, ['POST', 'GET'], 'un POST (el login) y un GET (leer): nada más');
});

// ---------------------------------------------------------------- fotos diarias

function nueva() {
  const p = crearPlanillaFalsa({ base: [ENCABEZADO], config: [] });
  cliente.__prueba.reiniciar();
  cliente.__prueba.usarSheets(p.api);
  data.__prueba.reiniciar();
  return p;
}
const cartera = (ars, usd) => ({ total: { ars, usd } });
const dia = (iso) => new Date(`${iso}T12:00:00`);

test('una foto por día: la primera lectura del día se guarda y las siguientes no la pisan', async () => {
  nueva();
  assert.equal(await iol.registrarFotoDiaria(cartera(1000, 5), dia('2026-11-02')), true);
  assert.equal(await iol.registrarFotoDiaria(cartera(9999, 9), dia('2026-11-02')), false);
  assert.equal(await iol.registrarFotoDiaria(cartera(1100.456, 6), dia('2026-11-03')), true);
  assert.deepEqual(await iol.getFotosCartera(), { '2026-11-02': { ars: 1000, usd: 5 }, '2026-11-03': { ars: 1100.46, usd: 6 } });
});
