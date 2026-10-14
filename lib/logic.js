import { CONFIG } from './config';
import { getProps, setProps } from './sheetsClient';
import {
  shiftMonthKey, getInstallmentMonths, getClosingMonthsDesdeCierre
} from './closing';

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
    piso: Number(props['PISO_DISPONIBLE']) || CONFIG.PISO_DEFAULT,
    cierreDias: parseCierreDias(props['CIERRE_DIAS'])
  };
}

// Día de cierre (1-31) de cada tarjeta, por banco: { "Santander": 20, "ICBC": 15 }.
function parseCierreDias(raw) {
  try {
    const obj = JSON.parse(raw || '{}');
    const limpio = {};
    Object.entries(obj || {}).forEach(([banco, dia]) => {
      const n = Math.floor(Number(dia));
      if (banco && n >= 1 && n <= 31) limpio[banco] = n;
    });
    return limpio;
  } catch {
    return {};
  }
}

export async function getCierreDias() {
  const props = await getProps();
  return parseCierreDias(props['CIERRE_DIAS']);
}

// Guarda (o borra, si dia viene vacío) el día de cierre de la tarjeta de ese banco. Al estar
// guardado solo el día —no el mes contable de cada gasto— todos los gastos, nuevos y viejos, se
// reubican solos en el mes que corresponde la próxima vez que se leen.
export async function guardarCierreDia(banco, dia) {
  const nombre = String(banco || '').trim();
  if (!nombre) throw new Error('Falta indicar la tarjeta.');
  const actual = await getCierreDias();
  if (dia === '' || dia === null || dia === undefined) {
    delete actual[nombre];
  } else {
    const n = Math.floor(Number(dia));
    if (!(n >= 1 && n <= 31)) throw new Error('El día de cierre debe estar entre 1 y 31.');
    actual[nombre] = n;
  }
  await setProps({ CIERRE_DIAS: JSON.stringify(actual) });
  return actual;
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

// ---------- Ahorro real: tenencia (lo que el usuario fue ahorrando de verdad) ----------
// Es una lista de movimientos { id, fecha: "YYYY-MM-DD", monto, moneda } guardada en la
// pestaña ConfigTablero. Cada uno queda en su moneda (ARS o USD): el total en pesos y el total
// en dólares se llevan por separado, y la equivalencia se calcula con el dólar blue vigente.

export async function getAhorroMovs() {
  const props = await getProps();
  let movs = null;
  if (props['AHORRO_MOVS']) {
    try { movs = JSON.parse(props['AHORRO_MOVS']); } catch { movs = null; }
  }
  if (!Array.isArray(movs)) {
    // Migración del formato anterior (un ahorro por mes, clave "YYYY-M"): cada uno pasa a ser
    // un movimiento fechado el día 1 de ese mes.
    let viejo = {};
    try { viejo = JSON.parse(props['AHORRO_REAL'] || '{}'); } catch { viejo = {}; }
    movs = Object.entries(viejo).map(([key, val]) => {
      const [y, m] = key.split('-').map(Number);
      const monto = typeof val === 'number' ? val : Number(val.monto) || 0;
      const moneda = typeof val === 'number' ? 'ARS' : (val.moneda || 'ARS');
      return {
        id: `mig-${key}`,
        fecha: `${y}-${String(m + 1).padStart(2, '0')}-01`,
        monto, moneda
      };
    });
    if (movs.length) await setProps({ AHORRO_MOVS: JSON.stringify(movs) });
  }
  return movs.sort((a, b) => String(a.fecha).localeCompare(String(b.fecha)));
}

export async function agregarAhorroMov({ fecha, monto, moneda }) {
  const movs = await getAhorroMovs();
  const hoy = new Date();
  const fechaOk = /^\d{4}-\d{2}-\d{2}$/.test(String(fecha || ''))
    ? fecha
    : `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}-${String(hoy.getDate()).padStart(2, '0')}`;
  movs.push({
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    fecha: fechaOk,
    monto: Number(monto) || 0,
    moneda: moneda === 'USD' ? 'USD' : 'ARS'
  });
  await setProps({ AHORRO_MOVS: JSON.stringify(movs) });
  return movs;
}

export async function eliminarAhorroMov(id) {
  const movs = (await getAhorroMovs()).filter(m => m.id !== id);
  await setProps({ AHORRO_MOVS: JSON.stringify(movs) });
  return movs;
}

// ---------- Fechas ----------

export function parseFecha(value) {
  if (value instanceof Date) return value;
  if (!value) return null;
  const s = String(value).trim();
  const m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (m) return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
  // "YYYY-MM-DD" (inputs de fecha): como fecha LOCAL; new Date(s) la tomaría en UTC y, en
  // Argentina, correría la compra un día para atrás (afecta la comparación con el cierre).
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

export function getCardKeyAndN(banco, cierreMap) {
  return banco ? (cierreMap[banco] || 0) : 0;
}

// La lógica de cierre (jueves de cierre, día fijo, meses de pago) vive en ./closing.js.

// Meses de PAGO de una fila de "Gasto variable". Solo cambia respecto del cálculo original
// cuando es una compra en tarjeta con fecha de cierre cargada a mano (dato nuevo, opcional):
// en ese caso se usa esa fecha tal cual. En cualquier otro caso —incluidas todas las filas que
// ya existían antes de separar Banco/Forma de pago— se sigue calculando exactamente igual que
// antes (jueves de cierre inferido a partir del banco), para no correr los montos de mes.
// ¿La fila es una compra con tarjeta de crédito? Las filas anteriores a separar "Forma de pago"
// no la tienen cargada; si el banco tiene regla de cierre (n > 0) siempre fueron de tarjeta.
export function esCompraCredito(row) {
  return row.formaPago === 'Tarjeta de Crédito' || (!row.formaPago && row.n > 0);
}

export function getPaymentMonths(row) {
  const credito = esCompraCredito(row);
  if (row.formaPago === 'Tarjeta de Crédito' && row.fechaCierre) {
    return getClosingMonthsDesdeCierre(row.fechaCierre, row.cuotas, row.fecha).map(k => shiftMonthKey(k, 1));
  }
  // Tarjeta de crédito: usa el día de cierre configurado para su banco (o el jueves de cierre
  // si no hay uno) y una compra hecha el mismo día del cierre pasa al período siguiente.
  // Efectivo, transferencias, débito y préstamos conservan exactamente la regla anterior.
  const opts = credito ? { cierreDia: row.cierreDia, cierreEnSiguiente: true } : undefined;
  return getInstallmentMonths(row.fecha, row.n, row.cuotas, opts);
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
      const installMonths = getPaymentMonths(row);
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
    // Nunca negativo: si los gastos + el piso superan los ingresos, el ahorro proyectado es 0.
    mo.ahorroProyectado = Math.max(0, mo.ingresos - mo.gastos - piso);
    // El piso que se muestra es el que realmente queda: ingresos - gastos - ahorro. Si no
    // alcanza para el piso configurado, se ajusta hacia abajo (y nunca es negativo).
    mo.margen = mo.ingresos - mo.gastos; // puede ser negativo (déficit); el ahorro y el piso se recortan a 0
    mo.pisoConfigurado = piso;
    mo.piso = Math.max(0, mo.ingresos - mo.gastos - mo.ahorroProyectado);
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
    const pagos = getPaymentMonths(row);
    if (!pagos.length) return;
    const restantes = pagos.filter(k => monthKeyToNum(k) >= hoyNum).length;
    if (restantes <= 0) return;
    detalle.push({
      desc: row.desc, medio: row.medio, moneda: row.moneda,
      formaPago: row.formaPago, banco: row.banco, marca: row.marca,
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
    const pagos = getPaymentMonths(row);
    const idx = pagos.indexOf(mesKey);
    if (idx === -1) return;
    detalle.push({
      desc: row.desc, medio: row.medio, moneda: row.moneda,
      formaPago: row.formaPago, banco: row.banco, marca: row.marca,
      montoCuota: row.montoOriginal,
      montoCuotaARS: row.montoARS,
      montoCuotaUSD: row.montoUSD,
      cuotaNumero: idx + 1, cuotasTotales: row.cuotas
    });
  });
  detalle.sort((a, b) => (a.medio || '').localeCompare(b.medio || ''));
  return detalle;
}

// Nombre de cuenta para agrupar: "VISA Santander" / "MASTERCARD ICBC" para tarjetas,
// "Santander" (banco) para transferencias/préstamos.
function nombreCuenta(row) {
  if (row.formaPago === 'Tarjeta de Crédito') {
    return [row.marca, row.banco].filter(Boolean).join(' ') || row.medio || 'Tarjeta';
  }
  return row.banco || row.formaPago || 'Otros';
}

// Cuánto hay que pagar de cada cuenta (cada tarjeta, y el banco por separado) mes a mes,
// a partir del mes siguiente al actual (o del mes ancla indicado), según las cuotas ya
// cargadas. Sirve para ver de un vistazo "cuánto pago de tarjeta X / banco Y" cada mes.
export function getProyeccionPorCuenta(rows, mesesAdelante, anchor) {
  let startY = anchor ? anchor.year : new Date().getFullYear();
  let startM = anchor ? anchor.month : new Date().getMonth() + 1;
  if (!anchor && startM > 11) { startM = 0; startY++; }

  const meses = [];
  for (let i = 0; i < mesesAdelante; i++) {
    let y = startY, m = startM + i;
    while (m > 11) { m -= 12; y++; }
    const key = y + '-' + m;
    meses.push({ key, year: y, month: m, label: labelMes(y, m), cuentas: {}, total: 0 });
  }
  const mesIndex = {};
  meses.forEach((mo, idx) => mesIndex[mo.key] = idx);

  const cuentas = new Set();
  rows.forEach(row => {
    if (row.gasto === 'Gasto fijo') {
      // Los gastos fijos (suscripciones, seguros, etc.) se repiten todos los meses, en la
      // cuenta que corresponda, igual que en el total general de la proyección.
      const cuenta = nombreCuenta(row);
      cuentas.add(cuenta);
      meses.forEach(mo => {
        mo.cuentas[cuenta] = (mo.cuentas[cuenta] || 0) + row.monto;
        mo.total += row.monto;
      });
      return;
    }
    if (row.gasto !== 'Gasto variable') return;
    const cuenta = nombreCuenta(row);
    cuentas.add(cuenta);
    getPaymentMonths(row).forEach(k => {
      if (!mesIndex.hasOwnProperty(k)) return;
      const mo = meses[mesIndex[k]];
      mo.cuentas[cuenta] = (mo.cuentas[cuenta] || 0) + row.monto;
      mo.total += row.monto;
    });
  });

  return { meses, cuentas: [...cuentas].sort() };
}

// Historial de gastos mes a mes: para cada mes de la ventana [anchor, anchor + cantidad), todos
// los gastos que caen ahí (los fijos se repiten cada mes; las cuotas, en el mes que se pagan),
// con su categoría (columna Tipo). Sirve para el desglose y el evolutivo de la pestaña "Gastos".
export function getGastosPorMes(rows, anchor, cantidad) {
  const meses = [];
  for (let i = 0; i < cantidad; i++) {
    const total = anchor.year * 12 + anchor.month + i;
    const year = Math.floor(total / 12), month = ((total % 12) + 12) % 12;
    meses.push({ key: year + '-' + month, year, month, label: labelMes(year, month), items: [] });
  }
  const idx = {};
  meses.forEach((mo, i) => idx[mo.key] = i);

  rows.forEach(row => {
    const base = {
      desc: row.desc, medio: row.medio, tipo: String(row.tipo || ''),
      categoria: row.categoria || 'Sin categorizar',
      moneda: row.moneda, montoARS: row.montoARS, montoUSD: row.montoUSD
    };
    if (row.gasto === 'Gasto fijo') {
      meses.forEach(mo => mo.items.push({ ...base, detalle: 'Fijo' }));
    } else if (row.gasto === 'Gasto variable') {
      getPaymentMonths(row).forEach((k, n) => {
        if (idx.hasOwnProperty(k)) {
          meses[idx[k]].items.push({ ...base, detalle: `Cuota ${n + 1} de ${row.cuotas}`, cuotaNumero: n + 1, cuotasTotales: row.cuotas });
        }
      });
    }
  });
  return meses;
}
