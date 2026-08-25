import { CONFIG } from './config';
import { getProps, setProps } from './sheetsClient';

// ---------- Cotización del dólar (blue), cacheada en la pestaña ConfigTablero ----------

export async function getDolarBlue() {
  const props = await getProps();
  const cached = props['DOLAR_BLUE_CACHE'];
  const cachedAt = Number(props['DOLAR_BLUE_CACHE_TS']) || 0;
  const ahora = Date.now();
  const vigente = (ahora - cachedAt) < CONFIG.DOLAR_CACHE_MINUTOS * 60 * 1000;

  if (cached && vigente) return Number(cached);

  try {
    const resp = await fetch('https://dolarapi.com/v1/dolares/blue');
    const data = await resp.json();
    const venta = Number(data.venta) || Number(data.compra) || 0;
    if (venta > 0) {
      await setProps({ DOLAR_BLUE_CACHE: String(venta), DOLAR_BLUE_CACHE_TS: String(ahora) });
      return venta;
    }
  } catch (e) {
    console.error('Error obteniendo dólar blue:', e);
  }
  return Number(cached) || 0;
}

// Dado un monto en su moneda original, devuelve el equivalente en ARS y en USD.
export function convertirMontos(monto, moneda, dolarBlue) {
  const isUSD = String(moneda || '').trim().toUpperCase() === 'USD';
  if (isUSD) {
    const montoARS = dolarBlue ? monto * dolarBlue : monto;
    return { montoARS, montoUSD: monto };
  }
  const montoUSD = dolarBlue ? monto / dolarBlue : null;
  return { montoARS: monto, montoUSD };
}

// ---------- Configuración persistente (Piso / cronograma de sueldo) ----------

// El sueldo se guarda como una lista de tramos { key: "YYYY-M", monto }: "a partir de este
// mes, el sueldo pasa a ser este monto". Se usa el tramo vigente más reciente para cada mes,
// así que un aumento cargado hoy con fecha futura no pisa los meses anteriores, y queda un
// registro permanente de la evolución del sueldo (no depende de quién mire el tablero ni cuándo).
export async function getConfiguracion() {
  const props = await getProps();
  let sueldoSchedule = [];

  if (props['SUELDO_SCHEDULE']) {
    try { sueldoSchedule = JSON.parse(props['SUELDO_SCHEDULE']); } catch { sueldoSchedule = []; }
  } else if (props['SUELDO_MENSUAL']) {
    // Migración desde el esquema viejo (un solo campo "sueldo actual"): se guarda como el
    // primer tramo, vigente desde el mes corriente, para no perder lo que ya estaba cargado.
    const hoy = new Date();
    const key = hoy.getFullYear() + '-' + hoy.getMonth();
    sueldoSchedule = [{ key, monto: Number(props['SUELDO_MENSUAL']) || 0 }];
    await setProps({ SUELDO_SCHEDULE: JSON.stringify(sueldoSchedule) });
  }

  sueldoSchedule.sort((a, b) => monthKeyToNum(a.key) - monthKeyToNum(b.key));

  return {
    sueldoSchedule,
    piso: Number(props['PISO_DISPONIBLE']) || CONFIG.PISO_DEFAULT
  };
}

export async function guardarPiso(piso) {
  await setProps({ PISO_DISPONIBLE: String(Number(piso) || CONFIG.PISO_DEFAULT) });
}

// Agrega o reemplaza el tramo de sueldo vigente desde el mes/año indicado.
export async function agregarTramoSueldo({ year, month, monto }) {
  const { sueldoSchedule } = await getConfiguracion();
  const key = `${year}-${month}`;
  const sinDuplicado = sueldoSchedule.filter(t => t.key !== key);
  sinDuplicado.push({ key, monto: Number(monto) || 0 });
  sinDuplicado.sort((a, b) => monthKeyToNum(a.key) - monthKeyToNum(b.key));
  await setProps({ SUELDO_SCHEDULE: JSON.stringify(sinDuplicado) });
  return sinDuplicado;
}

export async function eliminarTramoSueldo(key) {
  const { sueldoSchedule } = await getConfiguracion();
  const filtrado = sueldoSchedule.filter(t => t.key !== key);
  await setProps({ SUELDO_SCHEDULE: JSON.stringify(filtrado) });
  return filtrado;
}

// Sueldo vigente para un mes dado: el monto del tramo más reciente cuyo inicio sea <= ese mes.
function sueldoVigente(sueldoScheduleOrdenado, key) {
  const num = monthKeyToNum(key);
  let monto = 0;
  for (const tramo of sueldoScheduleOrdenado) {
    if (monthKeyToNum(tramo.key) <= num) monto = tramo.monto;
    else break;
  }
  return monto;
}

// ---------- Ahorro real (lo que el usuario cargó a mano por mes, no lo proyectado) ----------
// Se guarda en la moneda que el usuario haya cargado (ARS o USD); la equivalencia en la otra
// moneda se recalcula al leer, con la cotización del dólar blue vigente en ese momento.

export async function getAhorroReal() {
  const props = await getProps();
  let raw = {};
  try { raw = JSON.parse(props['AHORRO_REAL'] || '{}'); } catch { raw = {}; }
  const normalizado = {};
  Object.entries(raw).forEach(([key, val]) => {
    normalizado[key] = (typeof val === 'number')
      ? { monto: val, moneda: 'ARS' } // compatibilidad con el formato viejo (solo ARS)
      : { monto: Number(val.monto) || 0, moneda: val.moneda || 'ARS' };
  });
  return normalizado;
}

export async function guardarAhorroReal({ year, month, monto, moneda }) {
  const ahorro = await getAhorroReal();
  const key = `${year}-${month}`;
  ahorro[key] = { monto: Number(monto) || 0, moneda: moneda || 'ARS' };
  await setProps({ AHORRO_REAL: JSON.stringify(ahorro) });
  return ahorro;
}

export async function eliminarAhorroReal(key) {
  const ahorro = await getAhorroReal();
  delete ahorro[key];
  await setProps({ AHORRO_REAL: JSON.stringify(ahorro) });
  return ahorro;
}

// ---------- Fechas ----------

export function parseFecha(value) {
  if (value instanceof Date) return value;
  if (!value) return null;
  const s = String(value).trim();
  const m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (m) return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

export function getCardKeyAndN(medioDePago, cierreMap) {
  const s = String(medioDePago || '');
  let key = null;
  if (s.indexOf('Santander') >= 0) key = 'Santander';
  else if (s.indexOf('ICBC') >= 0) key = 'ICBC';
  else if (s.indexOf('MercadoPago') >= 0) key = 'MercadoPago';
  return key ? (cierreMap[key] || 0) : 0;
}

function nthThursdayMonth(year, monthIndex, n) {
  const first = new Date(year, monthIndex, 1);
  const firstDow = first.getDay() === 0 ? 7 : first.getDay();
  const offset = (4 - firstDow + 7) % 7;
  return new Date(year, monthIndex, 1 + offset + (n - 1) * 7);
}

// Meses de CIERRE de cada cuota (sin corrimiento)
export function getClosingMonths(fechaCompra, n, cuotas) {
  if (!n || !cuotas || !fechaCompra) return [];
  const year = fechaCompra.getFullYear();
  const month = fechaCompra.getMonth();
  const firstClosing = nthThursdayMonth(year, month, n);

  let startYear = year, startMonth = month;
  if (fechaCompra > firstClosing) {
    startMonth += 1;
    if (startMonth > 11) { startMonth = 0; startYear++; }
  }

  const months = [];
  let cy = startYear, cm = startMonth;
  for (let i = 0; i < cuotas; i++) {
    months.push(cy + '-' + cm);
    cm++;
    if (cm > 11) { cm = 0; cy++; }
  }
  return months;
}

// Meses de PAGO (cierre +1 mes)
export function getInstallmentMonths(fechaCompra, n, cuotas) {
  return getClosingMonths(fechaCompra, n, cuotas).map(k => shiftMonthKey(k, 1));
}

export function shiftMonthKey(key, delta) {
  const [y, m] = key.split('-').map(Number);
  const total = y * 12 + m + delta;
  const ny = Math.floor(total / 12);
  const nm = ((total % 12) + 12) % 12;
  return ny + '-' + nm;
}

export function monthKeyToNum(key) {
  const [y, m] = key.split('-').map(Number);
  return y * 12 + m;
}

const MESES_NOMBRE_CORTO = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

function labelMes(year, month) {
  return `${MESES_NOMBRE_CORTO[month]} ${year}`;
}

// ---------- Proyección mensual ----------

export function buildProjection(rows, mesesAdelante, sueldoSchedule, piso, hipotetico, anchor) {
  let startY = anchor ? anchor.year : new Date().getFullYear();
  let startM = anchor ? anchor.month : new Date().getMonth() + 1;
  if (!anchor && startM > 11) { startM = 0; startY++; }

  const scheduleOrdenado = [...(sueldoSchedule || [])].sort((a, b) => monthKeyToNum(a.key) - monthKeyToNum(b.key));

  const meses = [];
  for (let i = 0; i < mesesAdelante; i++) {
    let y = startY, m = startM + i;
    while (m > 11) { m -= 12; y++; }
    const key = y + '-' + m;
    const sueldoBase = sueldoVigente(scheduleOrdenado, key);
    const aguinaldo = (m === 0 || m === 6) ? sueldoBase * 0.5 : 0;
    const ingresos = sueldoBase + aguinaldo;
    meses.push({ key, year: y, month: m, ingresos, aguinaldo, ingresoExtra: 0, gastoFijo: 0, gastoVariable: 0 });
  }
  const mesIndex = {};
  meses.forEach((mo, idx) => mesIndex[mo.key] = idx);

  function addRow(row) {
    if (row.gasto === 'Gasto fijo') {
      meses.forEach(mo => mo.gastoFijo += row.monto);
    } else if (row.gasto === 'Gasto variable') {
      const installMonths = getInstallmentMonths(row.fecha, row.n, row.cuotas);
      installMonths.forEach(k => {
        if (mesIndex.hasOwnProperty(k)) meses[mesIndex[k]].gastoVariable += row.monto;
      });
    } else if (row.gasto === 'Ingreso extra') {
      if (row.fecha) {
        const key = row.fecha.getFullYear() + '-' + row.fecha.getMonth();
        if (mesIndex.hasOwnProperty(key)) {
          meses[mesIndex[key]].ingresoExtra += row.monto;
          meses[mesIndex[key]].ingresos += row.monto;
        }
      }
    }
  }

  rows.forEach(addRow);
  if (hipotetico) addRow(hipotetico);

  meses.forEach(mo => {
    mo.gastos = mo.gastoFijo + mo.gastoVariable;
    mo.ahorroProyectado = mo.ingresos - mo.gastos - piso;
    mo.piso = piso;
    mo.label = labelMes(mo.year, mo.month);
  });
  return meses;
}

export function getComprasActivas(rows) {
  const hoy = new Date();
  const hoyNum = monthKeyToNum(hoy.getFullYear() + '-' + hoy.getMonth());
  const detalle = [];
  rows.forEach(row => {
    if (row.gasto !== 'Gasto variable') return;
    const cierres = getClosingMonths(row.fecha, row.n, row.cuotas);
    if (!cierres.length) return;
    const restantes = cierres.filter(k => monthKeyToNum(k) >= hoyNum).length;
    if (restantes <= 0) return;
    detalle.push({
      desc: row.desc, medio: row.medio, moneda: row.moneda,
      montoCuota: row.montoOriginal,
      montoCuotaARS: row.montoARS,
      montoCuotaUSD: row.montoUSD,
      cuotasTotales: row.cuotas, cuotasRestantes: restantes
    });
  });
  detalle.sort((a, b) => a.cuotasRestantes - b.cuotasRestantes);
  return detalle;
}

// Qué cuotas de "Gasto variable" caen exactamente en el mes indicado (clave "YYYY-M"),
// con el número de cuota que corresponde a ese mes (ej. cuota 3 de 6).
export function getCuotasPorMes(rows, mesKey) {
  const detalle = [];
  rows.forEach(row => {
    if (row.gasto !== 'Gasto variable') return;
    const installMonths = getInstallmentMonths(row.fecha, row.n, row.cuotas);
    const idx = installMonths.indexOf(mesKey);
    if (idx === -1) return;
    detalle.push({
      desc: row.desc, medio: row.medio, moneda: row.moneda,
      montoCuota: row.montoOriginal,
      montoCuotaARS: row.montoARS,
      montoCuotaUSD: row.montoUSD,
      cuotaNumero: idx + 1, cuotasTotales: row.cuotas
    });
  });
  detalle.sort((a, b) => (a.medio || '').localeCompare(b.medio || ''));
  return detalle;
}
