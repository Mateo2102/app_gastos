// Cartera de InvertirOnline (IOL): SOLO LECTURA.
// Este módulo consulta el estado de cuenta y el portafolio. No tiene ninguna función para comprar, vender ni
// cancelar órdenes (un test lo verifica): la app muestra la cartera, no opera.
//
// Credenciales: variables de entorno IOL_USUARIO y IOL_CLAVE (en Vercel). Nunca viajan al navegador ni se
// escriben en la planilla. Si faltan, la integración queda apagada y el resto de la app no se entera.
//
// Ojo: la forma exacta de las respuestas de IOL se armó con la documentación pública y guías de terceros, y se
// lee de forma tolerante (campos que faltan = 0 / vacío). Conviene revisarla con datos reales al activar la API.

import { ErrorApp } from './errores.js';
import { getProps, actualizarProps } from './sheetsClient.js';
import { fechaISO } from './cobro.js';

const BASE_DEFECTO = 'https://api.invertironline.com';
const CACHE_MS = 10 * 60 * 1000; // la cartera se consulta como mucho cada 10 minutos
const MARGEN_TOKEN_MS = 60 * 1000;
const CLAVE_FOTOS = 'IOL_FOTOS';
const MAX_FOTOS = 800;

export function iolConfigurado(env = process.env) {
  return Boolean(String(env.IOL_USUARIO || '').trim() && String(env.IOL_CLAVE || '').trim());
}

const base = (env) => String(env.IOL_API_URL || BASE_DEFECTO).replace(/\/+$/, '');

// ---------- Sesión (solo en memoria del servidor) ----------
let sesion = null; // { access, refresh, vence }
let tokenEnCurso = null; // un solo login a la vez: las consultas en paralelo comparten el mismo
let cache = null; // { at, data }

async function pedirToken(cuerpo, { fetchFn, env, ahora }) {
  let resp;
  try {
    resp = await fetchFn(`${base(env)}/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(cuerpo).toString()
    });
  } catch {
    throw new ErrorApp('No se pudo conectar con IOL. Probá de nuevo en unos minutos.', 502);
  }
  if (!resp.ok) {
    // No se incluye el cuerpo de la respuesta ni el usuario: solo lo necesario para entender qué pasó.
    throw new ErrorApp(resp.status === 400 || resp.status === 401
      ? 'IOL rechazó el usuario o la contraseña, o la API todavía no está activa en tu cuenta.'
      : `IOL respondió con un error (${resp.status}).`, 502);
  }
  const datos = await resp.json().catch(() => ({}));
  if (!datos.access_token) throw new ErrorApp('IOL no devolvió un acceso válido.', 502);
  const segundos = Number(datos.expires_in) > 0 ? Number(datos.expires_in) : 900;
  sesion = { access: datos.access_token, refresh: datos.refresh_token || null, vence: ahora + segundos * 1000 };
  return sesion.access;
}

async function conseguirToken(ctx) {
  if (sesion && sesion.refresh) {
    try {
      return await pedirToken({ refresh_token: sesion.refresh, grant_type: 'refresh_token' }, ctx);
    } catch { /* si la renovación falla se vuelve a entrar con usuario y contraseña */ }
  }
  return pedirToken({ username: ctx.env.IOL_USUARIO, password: ctx.env.IOL_CLAVE, grant_type: 'password' }, ctx);
}

async function obtenerToken(ctx) {
  if (sesion && ctx.ahora < sesion.vence - MARGEN_TOKEN_MS) return sesion.access;
  if (!tokenEnCurso) {
    const pedido = conseguirToken(ctx);
    tokenEnCurso = pedido;
    const soltar = () => { if (tokenEnCurso === pedido) tokenEnCurso = null; };
    pedido.then(soltar, soltar);
  }
  return tokenEnCurso;
}

// GET autenticado. Si IOL dice 401 (token vencido antes de tiempo) renueva y reintenta UNA vez.
export async function iolGet(ruta, ctx) {
  for (let intento = 0; intento < 2; intento++) {
    const token = await obtenerToken(ctx);
    let resp;
    try {
      resp = await ctx.fetchFn(`${base(ctx.env)}${ruta}`, { method: 'GET', headers: { Authorization: `Bearer ${token}` } });
    } catch {
      throw new ErrorApp('No se pudo conectar con IOL. Probá de nuevo en unos minutos.', 502);
    }
    if (resp.status === 401 && intento === 0) { sesion = null; continue; }
    if (!resp.ok) throw new ErrorApp(`IOL respondió con un error (${resp.status}) al leer ${ruta.split('?')[0]}.`, 502);
    return resp.json();
  }
  throw new ErrorApp('IOL rechazó el acceso.', 502);
}

// ---------- Normalización ----------
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const monedaDe = (m) => (/dolar|usd/i.test(String(m || '')) ? 'USD' : 'ARS');

export function normalizarCartera(estado, portafolio) {
  const activos = (Array.isArray(portafolio && portafolio.activos) ? portafolio.activos : []).map((original) => {
    const a = original || {};
    const t = a.titulo || {};
    return {
      simbolo: String(t.simbolo || ''), descripcion: String(t.descripcion || ''), tipo: String(t.tipo || ''),
      moneda: monedaDe(t.moneda),
      cantidad: num(a.cantidad), ultimoPrecio: num(a.ultimoPrecio), valorizado: num(a.valorizado),
      gananciaDinero: num(a.gananciaDinero), gananciaPorcentaje: num(a.gananciaPorcentaje), variacionDiaria: num(a.variacionDiaria)
    };
  }).filter((a) => a.simbolo || a.valorizado);

  const cuentas = (Array.isArray(estado && estado.cuentas) ? estado.cuentas : []).map((c) => ({
    tipo: String((c && c.tipo) || ''), moneda: monedaDe(c && c.moneda),
    disponible: num(c && c.disponible), comprometido: num(c && c.comprometido),
    saldo: num(c && c.saldo), titulosValorizados: num(c && c.titulosValorizados), total: num(c && c.total)
  }));

  const suma = (lista, campo, moneda) => lista.filter((x) => x.moneda === moneda).reduce((acc, x) => acc + x[campo], 0);
  const invertido = { ars: suma(activos, 'valorizado', 'ARS'), usd: suma(activos, 'valorizado', 'USD') };
  const disponible = { ars: suma(cuentas, 'disponible', 'ARS'), usd: suma(cuentas, 'disponible', 'USD') };
  return {
    activos: activos.sort((x, y) => y.valorizado - x.valorizado),
    cuentas, invertido, disponible,
    total: { ars: invertido.ars + disponible.ars, usd: invertido.usd + disponible.usd }
  };
}

// ---------- Lectura con caché ----------
export async function getCartera({ forzar = false, env = process.env, fetchFn = fetch, ahora = Date.now() } = {}) {
  if (!iolConfigurado(env)) throw new ErrorApp('IOL no está configurado.', 503);
  if (!forzar && cache && ahora - cache.at < CACHE_MS) return cache.data;
  const ctx = { env, fetchFn, ahora };
  const [estado, portafolio] = await Promise.all([iolGet('/api/v2/estadocuenta', ctx), iolGet('/api/v2/portafolio/argentina', ctx)]);
  const data = { ...normalizarCartera(estado, portafolio), actualizado: new Date(ahora).toISOString() };
  cache = { at: ahora, data };
  return data;
}

// ---------- Fotos diarias del valor de la cartera (para el evolutivo) ----------
// Una por día: la primera lectura del día. { "2026-11-02": { ars, usd } } (totales por moneda, sin convertir).
function leerFotos(props) {
  try {
    const o = JSON.parse(props[CLAVE_FOTOS] || '{}');
    return o && typeof o === 'object' && !Array.isArray(o) ? o : {};
  } catch {
    return {};
  }
}

export async function getFotosCartera() {
  return leerFotos(await getProps());
}

export async function registrarFotoDiaria(cartera, hoy) {
  const dia = fechaISO(hoy);
  if (leerFotos(await getProps())[dia]) return false;
  let escribio = false;
  await actualizarProps((props) => {
    const f = leerFotos(props); // lo último guardado, no el caché
    if (f[dia]) return {};
    f[dia] = { ars: Math.round(cartera.total.ars * 100) / 100, usd: Math.round(cartera.total.usd * 100) / 100 };
    const dias = Object.keys(f).sort();
    while (dias.length > MAX_FOTOS) delete f[dias.shift()];
    escribio = true;
    return { [CLAVE_FOTOS]: JSON.stringify(f) };
  });
  return escribio;
}

// ---------- Solo para tests ----------
export const __prueba = { reiniciar() { sesion = null; cache = null; tokenEnCurso = null; } };
