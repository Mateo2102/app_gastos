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

// Mes de pago de una compra de un solo pago con una tarjeta de día de cierre fijo.
// Ej.: cierre el 20 -> compra del 19/10 se paga en noviembre, la del 20/10 en diciembre.
export function mesPagoCredito(fechaCompra, cierreDia) {
  return getInstallmentMonths(fechaCompra, 0, 1, { cierreDia, cierreEnSiguiente: true })[0] || null;
}
