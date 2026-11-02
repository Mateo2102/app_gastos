// Cierre de tarjeta: a qué mes de sueldo pertenece cada compra.
//
// Sin dependencias a propósito: es lógica de fechas pura, compartida entre el servidor
// (proyección, histórico) y el formulario de carga, y se puede probar con `node` directo.
//
// Claves de mes: "YYYY-M" con M en base 0 (enero = 0), igual que en el resto de la app.

export function shiftMonthKey(key, delta) {
  const [y, m] = key.split('-').map(Number);
  const total = y * 12 + m + delta;
  const ny = Math.floor(total / 12);
  const nm = ((total % 12) + 12) % 12;
  return ny + '-' + nm;
}

export function monthSequence(startDate, count) {
  if (!startDate || !count) return [];
  let key = startDate.getFullYear() + '-' + startDate.getMonth();
  const months = [];
  for (let i = 0; i < count; i++) { months.push(key); key = shiftMonthKey(key, 1); }
  return months;
}

// N-ésimo jueves del mes: la regla "histórica" de cierre (tabla Tarjeta/Cierre de la planilla).
export function nthThursdayMonth(year, monthIndex, n) {
  const first = new Date(year, monthIndex, 1);
  const firstDow = first.getDay() === 0 ? 7 : first.getDay();
  const offset = (4 - firstDow + 7) % 7;
  return new Date(year, monthIndex, 1 + offset + (n - 1) * 7);
}

// Día fijo de cierre dentro de un mes; si el mes es más corto (ej. día 31 en abril) cierra el
// último día del mes.
export function fechaCierreDia(year, monthIndex, dia) {
  const ultimo = new Date(year, monthIndex + 1, 0).getDate();
  return new Date(year, monthIndex, Math.min(Math.max(1, Math.floor(dia)), ultimo));
}

// Meses de CIERRE de cada cuota (sin corrimiento).
//   n               -> n° de jueves de cierre (regla histórica), usado si no hay cierreDia.
//   opts.cierreDia  -> día del mes (1-31) configurado para la tarjeta; tiene prioridad sobre n.
//   opts.cierreEnSiguiente -> una compra hecha EL MISMO día del cierre entra en el período
//                      siguiente (tarjetas de crédito). Sin esto se mantiene la regla vieja:
//                      el día del cierre todavía entra en el cierre de ese mes.
export function getClosingMonths(fechaCompra, n, cuotas, opts = {}) {
  const dia = Number(opts.cierreDia) || 0;
  if ((!n && !dia) || !cuotas || !fechaCompra) return [];
  const year = fechaCompra.getFullYear();
  const month = fechaCompra.getMonth();
  const compra = new Date(year, month, fechaCompra.getDate());
  const cierre = dia ? fechaCierreDia(year, month, dia) : nthThursdayMonth(year, month, n);

  const yaCerro = opts.cierreEnSiguiente ? compra >= cierre : compra > cierre;
  let startYear = year, startMonth = month;
  if (yaCerro) {
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

// Meses de PAGO (cierre + 1 mes): el mes de sueldo con el que se paga cada cuota.
export function getInstallmentMonths(fechaCompra, n, cuotas, opts = {}) {
  return getClosingMonths(fechaCompra, n, cuotas, opts).map((k) => shiftMonthKey(k, 1));
}

// Mes de cierre de una compra cuando la fecha de cierre se cargó a mano. Esa fecha fija el día
// del cierre y el mes de referencia. La tarjeta cierra una vez por mes: si la compra es anterior
// al cierre entra en ese cierre; si es del mismo día o posterior (misma regla que cierreEnSiguiente)
// ya cerró y pertenece al cierre del mes siguiente, y así hasta que el cierre quede después de la
// compra (esto además tolera una fecha de cierre de un mes viejo).
export function mesCierreDesdeFechaCierre(fechaCompra, fechaCierre) {
  const dia = fechaCierre.getDate();
  let y = fechaCierre.getFullYear();
  let m = fechaCierre.getMonth();
  if (fechaCompra) {
    const compra = new Date(fechaCompra.getFullYear(), fechaCompra.getMonth(), fechaCompra.getDate());
    for (let i = 0; i < 120 && compra >= fechaCierreDia(y, m, dia); i++) {
      m += 1;
      if (m > 11) { m = 0; y++; }
    }
  }
  return y + '-' + m;
}

// Cierres de una compra con fecha de cierre indicada a mano (sin pasar por el jueves de cierre).
// Si se pasa la fecha de compra, una compra posterior al cierre arranca en el cierre siguiente.
export function getClosingMonthsDesdeCierre(fechaCierre, cuotas, fechaCompra = null) {
  if (!fechaCierre || !cuotas) return [];
  const months = [];
  let key = mesCierreDesdeFechaCierre(fechaCompra, fechaCierre);
  for (let i = 0; i < cuotas; i++) { months.push(key); key = shiftMonthKey(key, 1); }
  return months;
}

// Fecha de aplicación ("ficticia") de una compra con tarjeta de día de cierre fijo. Solo sirve para
// calcular a qué cierre pertenece: si la compra es del día del cierre o posterior, la tarjeta ya cerró y
// se toma como hecha el 1° del mes siguiente (entra en el cierre siguiente); si no, es la misma fecha.
// La fecha real de la compra NUNCA se modifica: se guarda tal cual en la planilla.
// Ej.: cierre el 24 -> compra del 25/10 se aplica el 01/11 (sueldo de diciembre); la del 23/10 queda
// el 23/10 (sueldo de noviembre).
export function fechaAplicacion(fechaCompra, cierreDia) {
  const compra = new Date(fechaCompra.getFullYear(), fechaCompra.getMonth(), fechaCompra.getDate());
  const cierre = fechaCierreDia(compra.getFullYear(), compra.getMonth(), cierreDia);
  return compra >= cierre ? new Date(compra.getFullYear(), compra.getMonth() + 1, 1) : compra;
}

// Mes de pago de una compra de un solo pago con una tarjeta de día de cierre fijo.
// Ej.: cierre el 20 -> compra del 19/10 se paga en noviembre, la del 20/10 en diciembre.
export function mesPagoCredito(fechaCompra, cierreDia) {
  return getInstallmentMonths(fechaCompra, 0, 1, { cierreDia, cierreEnSiguiente: true })[0] || null;
}

// ---------- En qué meses se paga una compra (regla única de proyección y formulario) ----------

// Meses consecutivos desde el mes de la fecha dada, sin cierre ni desplazamientos. Es la regla
// PROVISORIA para todo lo que no es tarjeta de crédito con regla de cierre: efectivo, transferencia
// y cualquier forma de pago sin regla -> el primer mes es el mes de la compra.
export function mesesDesdeFecha(fecha, cuotas) {
  if (!(fecha instanceof Date) || isNaN(fecha.getTime())) return [];
  const n = Math.floor(Number(cuotas));
  if (!(n >= 1)) return [];
  return monthSequence(fecha, n);
}

// ¿La fila es una compra con tarjeta de crédito? Las filas anteriores a separar "Forma de pago"
// no la tienen cargada; si el banco tiene regla de cierre (n > 0) siempre fueron de tarjeta.
export function esCompraCredito(row) {
  return row.formaPago === 'Tarjeta de Crédito' || (!row.formaPago && row.n > 0);
}

// Devuelve la regla aplicada y los meses de PAGO (uno por cuota) de una compra.
//   fila: { formaPago, fecha (Date real, nunca se modifica), cuotas, fechaCierre?, cierreDia?, n? }
//   regla: 'cierre-manual' | 'cierre-dia' | 'cierre-jueves' | 'mes-de-compra'
// Solo una tarjeta de crédito CON regla de cierre desplaza el mes. Todo lo demás cae en el mes de
// la compra; una tarjeta sin regla de cierre también (antes la compra desaparecía de la proyección).
export function describirPago(fila) {
  const fecha = fila.fecha;
  const cuotas = Math.floor(Number(fila.cuotas));
  if (!(fecha instanceof Date) || isNaN(fecha.getTime()) || !(cuotas >= 1)) return { regla: 'mes-de-compra', meses: [] };

  if (esCompraCredito(fila)) {
    if (fila.formaPago === 'Tarjeta de Crédito' && fila.fechaCierre) {
      return { regla: 'cierre-manual', meses: getClosingMonthsDesdeCierre(fila.fechaCierre, cuotas, fecha).map((k) => shiftMonthKey(k, 1)) };
    }
    if (Number(fila.cierreDia) > 0) {
      return { regla: 'cierre-dia', meses: getInstallmentMonths(fecha, fila.n, cuotas, { cierreDia: fila.cierreDia, cierreEnSiguiente: true }) };
    }
    if (fila.n > 0) {
      return { regla: 'cierre-jueves', meses: getInstallmentMonths(fecha, fila.n, cuotas, { cierreDia: null, cierreEnSiguiente: true }) };
    }
  }
  return { regla: 'mes-de-compra', meses: mesesDesdeFecha(fecha, cuotas) };
}

export function getPaymentMonths(fila) {
  return describirPago(fila).meses;
}
