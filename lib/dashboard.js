import { CONFIG } from './config.js';
import { MAX_CUOTAS } from './entrada.js';
import { hoyEnZona, calcularCapacidad, periodoDeCobro } from './cobro.js';
import { readRows, getCierreMap } from './data.js';
import { getProps, actualizarProps } from './sheetsClient.js';
import {
  getDolarBlue, getConfiguracion, getCobros, compromisosPorCuenta, esGastoHecho, buildProjection, getComprasActivas,
  convertirMontos, getCardKeyAndN, getAhorroMovs, getProyeccionPorCuenta, parseFecha
} from './logic.js';

export async function getDashboardData(hipoteticoInput, anchorInput, ahora = new Date()) {
  const dolarBlue = await getDolarBlue();
  const rows = await readRows(dolarBlue);
  const config = await getConfiguracion();
  const ahorroMovs = await getAhorroMovs();

  let hipotetico = null;
  if (hipoteticoInput && hipoteticoInput.monto) {
    const cierreMap = await getCierreMap();
    const moneda = hipoteticoInput.moneda || 'ARS';
    const montoOriginal = Number(hipoteticoInput.monto) || 0;
    const { montoARS, montoUSD } = convertirMontos(montoOriginal, moneda, dolarBlue);
    const formaPago = hipoteticoInput.formaPago || 'Tarjeta de Crédito';
    const banco = hipoteticoInput.banco || '';
    hipotetico = {
      gasto: 'Gasto variable',
      medio: [hipoteticoInput.marca, banco].filter(Boolean).join(' ') || banco || formaPago,
      formaPago, banco, marca: hipoteticoInput.marca || '',
      desc: 'Simulación',
      fecha: parseFecha(hipoteticoInput.fecha) || new Date(),
      fechaCierre: hipoteticoInput.fechaCierre ? parseFecha(hipoteticoInput.fechaCierre) : null,
      cuotas: Math.min(MAX_CUOTAS, Math.max(1, Math.floor(Number(hipoteticoInput.cuotas)) || 1)),
      moneda, montoOriginal, monto: montoARS, montoARS, montoUSD,
      n: getCardKeyAndN(banco, cierreMap)
    };
  }

  // Sin mes elegido la proyección arranca en el MES EN CURSO (con la fecha de hoy en la zona de la app).
  const hoy = hoyEnZona(CONFIG.TZ, ahora);
  const anchor = (anchorInput && anchorInput.year !== undefined && anchorInput.month !== undefined && anchorInput.year !== '' && anchorInput.month !== '')
    ? { year: Number(anchorInput.year), month: Number(anchorInput.month) }
    : { year: hoy.getFullYear(), month: hoy.getMonth() };

  const meses = buildProjection(rows, CONFIG.MESES_PROYECCION, config.sueldoSchedule, config.piso, hipotetico, anchor);
  // Lo ahorrado de verdad en cada mes (suma de los movimientos de ese mes, en equivalente ARS/USD),
  // para superponerlo en el gráfico de Resumen.
  meses.forEach(mo => { mo.ahorroReal = ahorroRealDelMes(mo, ahorroMovs, dolarBlue); });
  const detalle = getComprasActivas(rows);
  const porCuenta = getProyeccionPorCuenta(rows, CONFIG.MESES_PROYECCION, { year: hoy.getFullYear(), month: hoy.getMonth() });
  return { meses, detalle, porCuenta, hoy: hoy.getFullYear() + '-' + hoy.getMonth(), capacidad: getCapacidad(rows, config, ahorroMovs, dolarBlue, hoy), config: { ...config, ahorroMovs }, dolarBlue };
}

// Cuánto se puede gastar hasta el próximo cobro. Se calcula SIEMPRE desde hoy (no depende del mes que
// se esté mirando ni de la simulación): proyección de los próximos meses sin compra hipotética.
function getCapacidad(rows, config, ahorroMovs, dolarBlue, hoy) {
  const meses = buildProjection(rows, 3, config.sueldoSchedule, config.piso, null, { year: hoy.getFullYear(), month: hoy.getMonth() });
  const ahorros = (ahorroMovs || []).map((m) => ({ fecha: String(m.fecha), montoARS: convertirMontos(m.monto, m.moneda, dolarBlue).montoARS }));
  const [py, pm] = periodoDeCobro(hoy).mesKey.split('-').map(Number); // el mes que paga este sueldo
  const grupos = compromisosPorCuenta(rows, py, pm, { hoy }); // sin los pagos únicos que ya salieron
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const hechos = rows
    .filter((r) => esGastoHecho(r, hoy) && r.fecha.getFullYear() === py && r.fecha.getMonth() === pm)
    .map((r) => ({ fecha: iso(r.fecha), montoARS: r.monto, creado: r.creado }));
  const c = calcularCapacidad(meses, hoy, config.saldoActual, ahorros, grupos, hechos);
  if (!c) return null;
  return { ...c, desde: iso(c.desde), hasta: iso(c.hasta) };
}

// Lo ahorrado de verdad en un mes (suma de los movimientos de Ahorro de ese mes, en ARS y USD), o null si no hubo.
function ahorroRealDelMes(mo, ahorroMovs, dolarBlue) {
  const prefijo = `${mo.year}-${String(mo.month + 1).padStart(2, '0')}`;
  const delMes = ahorroMovs.filter(m => String(m.fecha).startsWith(prefijo));
  if (!delMes.length) return null;
  let montoARS = 0, montoUSD = 0;
  delMes.forEach(m => {
    const conv = convertirMontos(m.monto, m.moneda, dolarBlue);
    montoARS += conv.montoARS;
    montoUSD += conv.montoUSD || 0;
  });
  return { montoARS, montoUSD };
}

// ---------- Fotos de la proyección ----------
// Lo proyectado de un mes se CONGELA cuando el mes arranca: así se ve cuánto se desvió lo real de lo que se
// esperaba. Antes de que el mes empiece, la proyección se va actualizando sola con lo que se carga.
// La foto de un mes se guarda la primera vez que se piden los gráficos en ese mes (conviene abrir la app el
// día 1). Los meses anteriores a la primera foto no se pueden reconstruir: se completan con lo que la app
// calcula hoy y quedan marcados como aproximados (aprox) para no hacerlos pasar por un plan real.
//   { "2026-10": { ingresos, gastos, ahorro, aprox, fecha } }  (clave = "año-mes en base 0")
const CLAVE_FOTOS = 'PROYECCION_FOTOS';
const MAX_FOTOS = 240;
const numDeClave = (k) => { const [y, m] = String(k).split('-').map(Number); return y * 12 + m; };

export function leerFotos(props) {
  try {
    const o = JSON.parse(props[CLAVE_FOTOS] || '{}');
    return o && typeof o === 'object' && !Array.isArray(o) ? o : {};
  } catch {
    return {};
  }
}

// Devuelve las fotos, creando las que falten para los meses que ya empezaron (mes en curso y anteriores).
async function asegurarFotos(mesesModelo, numHoy, hoyISO) {
  const fotos = leerFotos(await getProps());
  const faltan = mesesModelo.filter((mo) => mo.year * 12 + mo.month <= numHoy && !fotos[mo.key]);
  if (!faltan.length) return fotos;
  let resultado = fotos;
  await actualizarProps((props) => {
    const f = leerFotos(props); // lo último guardado, no el caché
    faltan.forEach((mo) => {
      if (f[mo.key]) return;
      f[mo.key] = { ingresos: mo.ingresos, gastos: mo.gastos, ahorro: mo.ahorroProyectado, aprox: mo.year * 12 + mo.month < numHoy, fecha: hoyISO };
    });
    const claves = Object.keys(f).sort((x, y) => numDeClave(x) - numDeClave(y));
    while (claves.length > MAX_FOTOS) delete f[claves.shift()];
    resultado = f;
    return { [CLAVE_FOTOS]: JSON.stringify(f) };
  });
  return resultado;
}

// Datos de la sección Gráficos: lo proyectado contra lo real, mes a mes.
// La ventana arranca como mucho MESES_ATRAS meses atrás y no antes del primer sueldo cargado (antes no hay
// ingresos y los números no dirían nada), y sigue hasta el final de la proyección.
//  - ingresos / gastos / ahorroProyectado: lo PROYECTADO. En el mes en curso y los anteriores es la foto
//    (fija); en los que vienen, la proyección de hoy (cambia con lo que se carga).
//  - gastosReal: lo que el modelo calcula hoy para ese mes (todo lo cargado); null en los meses futuros.
//  - ahorroReal: lo que realmente se apartó en Ahorro (0 si no hubo); null en los meses futuros.
//  - ingresosReal: lo cobrado y anotado en Sueldos ese mes (sueldo + extra); null si no hay nada anotado.
//  - fijo: el proyectado ya está congelado. aprox: la foto es una aproximación (no existía cuando empezó el mes).
const MESES_ATRAS = 8;

export async function getGraficosData(ahora = new Date()) {
  const dolarBlue = await getDolarBlue();
  const rows = await readRows(dolarBlue);
  const config = await getConfiguracion();
  const ahorroMovs = await getAhorroMovs();
  const hoy = hoyEnZona(CONFIG.TZ, ahora);
  const numHoy = hoy.getFullYear() * 12 + hoy.getMonth();
  const hoyISO = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}-${String(hoy.getDate()).padStart(2, '0')}`;

  const primerSueldo = (config.sueldoSchedule || []).reduce((min, t) => {
    const [y, m] = String(t.key).split('-').map(Number);
    return Math.min(min, y * 12 + m);
  }, Infinity);
  const inicio = Math.max(numHoy - MESES_ATRAS, Number.isFinite(primerSueldo) ? primerSueldo : numHoy);
  const atras = numHoy - inicio;
  const anchor = { year: Math.floor(inicio / 12), month: inicio % 12 };

  const meses = buildProjection(rows, atras + CONFIG.MESES_PROYECCION, config.sueldoSchedule, config.piso, null, anchor);
  const fotos = await asegurarFotos(meses, numHoy, hoyISO);
  const cobros = await getCobros(); // lo que realmente se cobró (sueldo y extra)
  const cobradoPorMes = {};
  cobros.forEach((c) => {
    const [y, m] = String(c.fecha).split('-').map(Number);
    const k = y + '-' + (m - 1);
    cobradoPorMes[k] = (cobradoPorMes[k] || 0) + c.monto;
  });

  return {
    hoy: hoy.getFullYear() + '-' + hoy.getMonth(),
    cobros,
    meses: meses.map((mo) => {
      const num = mo.year * 12 + mo.month;
      const empezo = num <= numHoy;
      const foto = empezo ? fotos[mo.key] : null;
      const real = ahorroRealDelMes(mo, ahorroMovs, dolarBlue);
      return {
        key: mo.key, label: mo.label, year: mo.year, month: mo.month,
        estado: num < numHoy ? 'pasado' : (num === numHoy ? 'actual' : 'futuro'),
        ingresos: foto ? foto.ingresos : mo.ingresos,
        gastos: foto ? foto.gastos : mo.gastos,
        ahorroProyectado: foto ? foto.ahorro : mo.ahorroProyectado,
        fijo: Boolean(foto), aprox: Boolean(foto && foto.aprox),
        gastosReal: empezo ? mo.gastos : null,
        ahorroReal: empezo ? (real ? real.montoARS : 0) : null,
        ingresosReal: empezo && cobradoPorMes[mo.key] !== undefined ? cobradoPorMes[mo.key] : null
      };
    })
  };
}
