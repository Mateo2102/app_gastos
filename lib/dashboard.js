import { CONFIG } from './config.js';
import { MAX_CUOTAS } from './entrada.js';
import { hoyEnZona, calcularCapacidad, periodoDeCobro } from './cobro.js';
import { readRows, getCierreMap } from './data.js';
import {
  getDolarBlue, getConfiguracion, getCobros, compromisosPorCuenta, buildProjection, getComprasActivas,
  convertirMontos, getCardKeyAndN, getAhorroMovs, getProyeccionPorCuenta, parseFecha
} from './logic.js';

export async function getDashboardData(hipoteticoInput, anchorInput) {
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
  const hoy = hoyEnZona(CONFIG.TZ);
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
  const grupos = compromisosPorCuenta(rows, py, pm);
  const c = calcularCapacidad(meses, hoy, config.saldoActual, ahorros, grupos);
  if (!c) return null;
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
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

// Datos de la sección Gráficos: evolutivo (lo que ya pasó) contra proyectado, mes a mes.
// La ventana arranca como mucho MESES_ATRAS meses atrás y no antes del primer sueldo cargado (antes no hay
// ingresos y los números no dirían nada), y sigue hasta el final de la proyección.
//  - ingresos / gastos: los del modelo. En meses pasados son lo que se pagó; en los que vienen, lo comprometido.
//  - ahorroProyectado: lo que el plan dice que se ahorra (ingresos - gastos - piso, nunca negativo).
//  - ahorroReal: lo que realmente se apartó en Ahorro (0 si no hubo); null en los meses futuros.
const MESES_ATRAS = 8;

export async function getGraficosData(ahora = new Date()) {
  const dolarBlue = await getDolarBlue();
  const rows = await readRows(dolarBlue);
  const config = await getConfiguracion();
  const ahorroMovs = await getAhorroMovs();
  const hoy = hoyEnZona(CONFIG.TZ, ahora);
  const numHoy = hoy.getFullYear() * 12 + hoy.getMonth();

  const primerSueldo = (config.sueldoSchedule || []).reduce((min, t) => {
    const [y, m] = String(t.key).split('-').map(Number);
    return Math.min(min, y * 12 + m);
  }, Infinity);
  const inicio = Math.max(numHoy - MESES_ATRAS, Number.isFinite(primerSueldo) ? primerSueldo : numHoy);
  const atras = numHoy - inicio;
  const anchor = { year: Math.floor(inicio / 12), month: inicio % 12 };

  const meses = buildProjection(rows, atras + CONFIG.MESES_PROYECCION, config.sueldoSchedule, config.piso, null, anchor);
  const cobros = await getCobros(); // lo que realmente se cobró (sueldo y extra)
  return {
    hoy: hoy.getFullYear() + '-' + hoy.getMonth(),
    cobros,
    meses: meses.map((mo) => {
      const num = mo.year * 12 + mo.month;
      const real = ahorroRealDelMes(mo, ahorroMovs, dolarBlue);
      return {
        key: mo.key, label: mo.label, year: mo.year, month: mo.month,
        estado: num < numHoy ? 'pasado' : (num === numHoy ? 'actual' : 'futuro'),
        ingresos: mo.ingresos, gastos: mo.gastos, gastoFijo: mo.gastoFijo, gastoVariable: mo.gastoVariable,
        ahorroProyectado: mo.ahorroProyectado,
        ahorroReal: num <= numHoy ? (real ? real.montoARS : 0) : null
      };
    })
  };
}
