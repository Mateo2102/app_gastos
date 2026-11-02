import { CONFIG } from './config.js';
import { getProps, setProps, actualizarProps } from './sheetsClient.js';
import { getPaymentMonths, esCompraCredito } from './closing.js';
import { ErrorApp, ErrorValidacion } from './errores.js';
import { hoyEnZona, fechaISO, periodoDeCobro } from './cobro.js';

// Las reglas de pago viven en closing.js (puras); se reexportan para no cambiar a quien las importa.
export { getPaymentMonths, esCompraCredito };

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
    // Sin cotización no se puede valuar un monto en dólares: contarlo como pesos falsearía los totales.
    if (!dolarBlue) throw new ErrorApp('No hay cotización del dólar disponible; reintentá en unos minutos.', 503);
    const montoARS = monto * dolarBlue;
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
// Cronograma de sueldo guardado en `props` (sin escribir nada). `migrado` avisa si salió del esquema viejo.
function leerSueldoSchedule(props) {
  let sueldoSchedule = [];
  let migrado = false;
  if (props['SUELDO_SCHEDULE']) {
    try { sueldoSchedule = JSON.parse(props['SUELDO_SCHEDULE']); } catch { sueldoSchedule = []; }
  } else if (props['SUELDO_MENSUAL']) {
    // Migración desde el esquema viejo (un solo campo "sueldo actual"): se guarda como el
    // primer tramo, vigente desde el mes corriente, para no perder lo que ya estaba cargado.
    const hoy = new Date();
    const key = hoy.getFullYear() + '-' + hoy.getMonth();
    sueldoSchedule = [{ key, monto: Number(props['SUELDO_MENSUAL']) || 0 }];
    migrado = true;
  }
  return { sueldoSchedule, migrado };
}

export async function getConfiguracion() {
  const props = await getProps();
  const { sueldoSchedule, migrado } = leerSueldoSchedule(props);
  if (migrado) await setProps({ SUELDO_SCHEDULE: JSON.stringify(sueldoSchedule) });

  sueldoSchedule.sort((a, b) => monthKeyToNum(a.key) - monthKeyToNum(b.key));

  return {
    sueldoSchedule,
    piso: Number(props['PISO_DISPONIBLE']) || CONFIG.PISO_DEFAULT,
    cierreDias: parseCierreDias(props['CIERRE_DIAS']),
    saldoActual: parseSaldo(props['SALDO_ACTUAL'])
  };
}

// Lo que el usuario dice que tiene hoy: { monto, pagados, fecha: "YYYY-MM-DD" } o null.
// `pagados` son los ids de los grupos comprometidos del período que ya pagó (cada tarjeta,
// transferencias, efectivo): lo que falta pagar es lo que NO está tildado.
function parseSaldo(raw) {
  try {
    const o = JSON.parse(raw || 'null');
    if (!o || typeof o !== 'object') return null;
    const monto = Number(o.monto);
    if (!Number.isFinite(monto) || !/^\d{4}-\d{2}-\d{2}$/.test(String(o.fecha))) return null;
    const pagados = Array.isArray(o.pagados) ? o.pagados.filter((x) => typeof x === 'string').slice(0, 60) : [];
    return { monto, pagados, fecha: String(o.fecha) };
  } catch {
    return null;
  }
}

// Qué hay que pagar en un mes (clave "YYYY-M"), agrupado como lo paga el usuario: una tarjeta por
// grupo, las transferencias por banco y el efectivo. La suma de los grupos es el comprometido del mes.
export function compromisosPorCuenta(rows, year, month) {
  const key = year + '-' + month;
  const grupos = new Map();
  const sumar = (id, nombre, tipo, monto) => {
    if (!grupos.has(id)) grupos.set(id, { id, nombre, tipo, total: 0 });
    grupos.get(id).total += monto;
  };
  rows.forEach((row) => {
    if (row.gasto === 'Gasto fijo') {
      if (!fijoVigenteEn(row, year, month)) return;
    } else if (row.gasto === 'Gasto variable') {
      if (!getPaymentMonths(row).includes(key)) return;
    } else {
      return;
    }
    if (row.formaPago === 'Tarjeta de Crédito') {
      const nombre = nombreCuenta(row);
      sumar('c:' + nombre, nombre, 'tarjeta', row.monto);
    } else if (row.formaPago === 'Efectivo') {
      sumar('e', 'Efectivo', 'efectivo', row.monto);
    } else {
      const banco = row.banco || '';
      sumar('t:' + (banco || 'otros'), banco ? `Transferencias ${banco}` : 'Transferencias', 'transferencia', row.monto);
    }
  });
  const orden = { tarjeta: 0, transferencia: 1, efectivo: 2 };
  return [...grupos.values()].sort((x, y) => orden[x.tipo] - orden[y.tipo] || y.total - x.total);
}

// Guarda lo que tengo hoy, lo que ya pagué (ids de grupos) y, opcionalmente, cuánto ahorré en este período.
// La fecha es la de hoy en la zona de la app. `monto` vacío borra el saldo (vuelve la estimación).
// Si viene `ahorrado` (total ahorrado desde el último cobro), la pestaña Ahorro se llena sola: lo que falta
// sobre lo que ya hay cargado a mano se guarda como UN movimiento propio del período, que se reemplaza
// cada vez (no se duplica). El movimiento viejo conserva su fecha.
export async function guardarSaldo({ monto, pagados, ahorrado } = {}, { dolarBlue = 0, ahora = new Date() } = {}) {
  const borrar = monto === '' || monto === null || monto === undefined;
  const hoy = hoyEnZona(CONFIG.TZ, ahora);
  const hoyISO = fechaISO(hoy);
  const desde = fechaISO(periodoDeCobro(hoy).desde);
  const idAuto = 'auto_' + desde;

  let saldo = '';
  if (!borrar) {
    const m = Number(monto);
    if (!Number.isFinite(m) || m < 0 || m > 1e12) throw new ErrorValidacion('Lo que tenés hoy tiene que ser un monto desde 0.');
    const ids = Array.isArray(pagados) ? pagados : [];
    if (ids.length > 60 || ids.some((x) => typeof x !== 'string' || x.length > 120)) throw new ErrorValidacion('Los pagos marcados no son válidos.');
    saldo = JSON.stringify({ monto: m, pagados: ids, fecha: hoyISO });
  }

  const dejaAhorro = !borrar && ahorrado !== '' && ahorrado !== null && ahorrado !== undefined;
  let total = 0;
  if (dejaAhorro) {
    total = Number(ahorrado);
    if (!Number.isFinite(total) || total < 0 || total > 1e12) throw new ErrorValidacion('Lo que ahorraste tiene que ser un monto desde 0.');
  }

  await actualizarProps((props) => {
    const cambios = { SALDO_ACTUAL: saldo };
    if (dejaAhorro) {
      const { movs } = leerAhorroMovs(props); // lo último guardado, no el caché
      const previo = movs.find((x) => x.id === idAuto);
      const resto = movs.filter((x) => x.id !== idAuto);
      const aMano = resto
        .filter((x) => String(x.fecha) >= desde && String(x.fecha) <= hoyISO)
        .reduce((acc, x) => acc + convertirMontos(Number(x.monto) || 0, x.moneda, dolarBlue).montoARS, 0);
      if (total < aMano - 0.5) {
        throw new ErrorValidacion(`En Ahorro ya tenés ${Math.round(aMano).toLocaleString('es-AR')} cargados a mano en este período: no puede ser menos. Si hay un error, borralo desde la pestaña Ahorro.`);
      }
      const propio = Math.round((total - aMano) * 100) / 100;
      if (propio > 0) resto.push({ id: idAuto, fecha: previo ? previo.fecha : hoyISO, monto: propio, moneda: 'ARS' });
      cambios.AHORRO_MOVS = JSON.stringify(resto);
    }
    return cambios;
  });
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
  const borrar = dia === '' || dia === null || dia === undefined;
  const n = Math.floor(Number(dia));
  if (!borrar && !(n >= 1 && n <= 31)) throw new Error('El día de cierre debe estar entre 1 y 31.');
  let resultado = {};
  await actualizarProps((props) => {
    const actual = parseCierreDias(props['CIERRE_DIAS']); // lo último guardado, no el caché
    if (borrar) delete actual[nombre]; else actual[nombre] = n;
    resultado = actual;
    return { CIERRE_DIAS: JSON.stringify(actual) };
  });
  return resultado;
}

export async function guardarPiso(piso) {
  await setProps({ PISO_DISPONIBLE: String(Number(piso) || CONFIG.PISO_DEFAULT) });
}

// Agrega o reemplaza el tramo de sueldo vigente desde el mes/año indicado.
export async function agregarTramoSueldo({ year, month, monto }) {
  const key = `${year}-${month}`;
  let resultado = [];
  await actualizarProps((props) => {
    const { sueldoSchedule } = leerSueldoSchedule(props);
    const sinDuplicado = sueldoSchedule.filter(t => t.key !== key);
    sinDuplicado.push({ key, monto: Number(monto) || 0 });
    sinDuplicado.sort((a, b) => monthKeyToNum(a.key) - monthKeyToNum(b.key));
    resultado = sinDuplicado;
    return { SUELDO_SCHEDULE: JSON.stringify(sinDuplicado) };
  });
  return resultado;
}

export async function eliminarTramoSueldo(key) {
  let resultado = [];
  await actualizarProps((props) => {
    const { sueldoSchedule } = leerSueldoSchedule(props);
    resultado = sueldoSchedule.filter(t => t.key !== key);
    return { SUELDO_SCHEDULE: JSON.stringify(resultado) };
  });
  return resultado;
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

// Movimientos de ahorro guardados en `props` (sin escribir nada). `migrado` avisa si salió del formato viejo.
function leerAhorroMovs(props) {
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
    return { movs, migrado: movs.length > 0 };
  }
  return { movs, migrado: false };
}

export async function getAhorroMovs() {
  const props = await getProps();
  const { movs, migrado } = leerAhorroMovs(props);
  if (migrado) await setProps({ AHORRO_MOVS: JSON.stringify(movs) });
  return movs.sort((a, b) => String(a.fecha).localeCompare(String(b.fecha)));
}

export async function agregarAhorroMov({ fecha, monto, moneda }) {
  const hoy = new Date();
  const fechaOk = /^\d{4}-\d{2}-\d{2}$/.test(String(fecha || ''))
    ? fecha
    : `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}-${String(hoy.getDate()).padStart(2, '0')}`;
  const nuevo = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    fecha: fechaOk,
    monto: Number(monto) || 0,
    moneda: moneda === 'USD' ? 'USD' : 'ARS'
  };
  let resultado = [];
  await actualizarProps((props) => {
    const { movs } = leerAhorroMovs(props); // lo último guardado, no el caché
    movs.push(nuevo);
    resultado = movs;
    return { AHORRO_MOVS: JSON.stringify(movs) };
  });
  return resultado;
}

export async function eliminarAhorroMov(id) {
  let resultado = [];
  await actualizarProps((props) => {
    resultado = leerAhorroMovs(props).movs.filter(m => m.id !== id);
    return { AHORRO_MOVS: JSON.stringify(resultado) };
  });
  return resultado;
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

// En qué meses se paga cada compra: ver describirPago en closing.js (única fuente de la regla).

export function monthKeyToNum(key) {
  const [y, m] = key.split('-').map(Number);
  return y * 12 + m;
}

// ---------- Vigencia de los gastos fijos ----------
// Un fijo se paga en los meses que van desde el mes de su fecha (E) hasta el mes de fin (si lo hay),
// salvo el tramo pausado. Sin fecha o sin fin no hay límite de ese lado. Los meses cuentan completos.
const numMes = (d) => d.getFullYear() * 12 + d.getMonth();

export function fijoVigenteEn(row, year, month) {
  const n = year * 12 + month;
  if (row.fecha && n < numMes(row.fecha)) return false;
  if (row.fechaFin && n > numMes(row.fechaFin)) return false;
  if (row.pausaDesde && n >= numMes(row.pausaDesde) && (!row.pausaHasta || n <= numMes(row.pausaHasta))) return false;
  return true;
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
      meses.forEach(mo => { if (fijoVigenteEn(row, mo.year, mo.month)) mo.gastoFijo += row.monto; });
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
        if (!fijoVigenteEn(row, mo.year, mo.month)) return;
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
      meses.forEach(mo => { if (fijoVigenteEn(row, mo.year, mo.month)) mo.items.push({ ...base, detalle: 'Fijo' }); });
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
