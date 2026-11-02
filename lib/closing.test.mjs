// Prueba de la lógica de cierre de tarjeta. Correr con: node lib/closing.test.mjs
import assert from 'node:assert/strict';
import {
  mesPagoCredito, getInstallmentMonths, mesCierreDesdeFechaCierre, getClosingMonthsDesdeCierre, shiftMonthKey, fechaAplicacion
} from './closing.js';

const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
const label = (key) => { const [y, m] = key.split('-').map(Number); return `${MESES[m]} ${y}`; };
const d = (dd, mm, yyyy) => new Date(yyyy, mm - 1, dd);

let fallos = 0;
function caso(nombre, obtenido, esperado) {
  const ok = obtenido === esperado;
  if (!ok) fallos++;
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${nombre} -> ${obtenido}${ok ? '' : ` (esperado ${esperado})`}`);
}

// Tabla del pedido: tarjeta que cierra el día 20.
const tabla = [
  [d(5, 10, 2026), 'Noviembre 2026'], [d(15, 10, 2026), 'Noviembre 2026'], [d(19, 10, 2026), 'Noviembre 2026'],
  [d(20, 10, 2026), 'Diciembre 2026'], [d(21, 10, 2026), 'Diciembre 2026'], [d(31, 10, 2026), 'Diciembre 2026'],
  [d(5, 11, 2026), 'Diciembre 2026'], [d(19, 11, 2026), 'Diciembre 2026'],
  [d(20, 11, 2026), 'Enero 2027'], [d(25, 11, 2026), 'Enero 2027']
];
tabla.forEach(([f, esp]) => caso(`cierre 20 · compra ${f.toLocaleDateString('es-AR')}`, label(mesPagoCredito(f, 20)), esp));

// Cambio de año y cada tarjeta con su día.
caso('cierre 20 · 20/12/2026', label(mesPagoCredito(d(20, 12, 2026), 20)), 'Febrero 2027');
caso('cierre 20 · 19/12/2026', label(mesPagoCredito(d(19, 12, 2026), 20)), 'Enero 2027');
caso('cierre 15 · 14/10/2026', label(mesPagoCredito(d(14, 10, 2026), 15)), 'Noviembre 2026');
caso('cierre 15 · 15/10/2026', label(mesPagoCredito(d(15, 10, 2026), 15)), 'Diciembre 2026');
caso('cierre 25 · 24/10/2026', label(mesPagoCredito(d(24, 10, 2026), 25)), 'Noviembre 2026');
caso('cierre 25 · 25/10/2026', label(mesPagoCredito(d(25, 10, 2026), 25)), 'Diciembre 2026');
// Mes corto: cierre 31 en abril cierra el 30.
caso('cierre 31 · 29/04/2026', label(mesPagoCredito(d(29, 4, 2026), 31)), 'Mayo 2026');
caso('cierre 31 · 30/04/2026', label(mesPagoCredito(d(30, 4, 2026), 31)), 'Junio 2026');

// Cuotas: la primera cae en el mes de pago y las siguientes en meses consecutivos (cruza de año).
const cuotas = getInstallmentMonths(d(20, 11, 2026), 0, 3, { cierreDia: 20, cierreEnSiguiente: true }).map(label).join(', ');
caso('6 cuotas desde 20/11 (cierre 20), primeras 3', cuotas, 'Enero 2027, Febrero 2027, Marzo 2027');

// Regla histórica (sin día configurado, jueves de cierre) y no-crédito: no cambia.
// 1° jueves de octubre 2026 = 01/10. Compra el 01/10 con regla vieja todavía entra en ese cierre.
caso('legacy 1° jueves · 01/10/2026', label(getInstallmentMonths(d(1, 10, 2026), 1, 1)[0]), 'Noviembre 2026');
caso('legacy 1° jueves · 02/10/2026', label(getInstallmentMonths(d(2, 10, 2026), 1, 1)[0]), 'Diciembre 2026');
// Con la regla nueva (crédito) el mismo día del cierre pasa al período siguiente.
caso('crédito 1° jueves · 01/10/2026', label(getInstallmentMonths(d(1, 10, 2026), 1, 1, { cierreEnSiguiente: true })[0]), 'Diciembre 2026');

// Fecha de cierre cargada a mano (cierre 22/10/2026): antes del cierre -> noviembre; después -> diciembre.
const pagoManual = (compra, cierre) => label(shiftMonthKey(mesCierreDesdeFechaCierre(compra, cierre), 1));
caso('cierre manual 22/10 · compra 15/10 (antes)', pagoManual(d(15, 10, 2026), d(22, 10, 2026)), 'Noviembre 2026');
caso('cierre manual 22/10 · compra 23/10 (después)', pagoManual(d(23, 10, 2026), d(22, 10, 2026)), 'Diciembre 2026');
caso('cierre manual 22/10 · compra 22/10 (mismo día)', pagoManual(d(22, 10, 2026), d(22, 10, 2026)), 'Diciembre 2026');
caso('cierre manual 22/10 (viejo) · compra 23/11', pagoManual(d(23, 11, 2026), d(22, 10, 2026)), 'Enero 2027');
const cuotasManual = getClosingMonthsDesdeCierre(d(22, 10, 2026), 3, d(23, 10, 2026)).map((k) => label(shiftMonthKey(k, 1))).join(', ');
caso('3 cuotas, cierre manual 22/10, compra 23/10', cuotasManual, 'Diciembre 2026, Enero 2027, Febrero 2027');

// La fecha de compra no se toca.
const f = d(15, 10, 2026); const antes = f.getTime(); mesPagoCredito(f, 20);
caso('fecha de compra intacta', f.getTime() === antes ? 'igual' : 'modificada', 'igual');

// Fecha de aplicación ("ficticia"): tarjeta que cierra el 24.
const fmtD = (x) => x.toLocaleDateString('es-AR');
caso('cierre 24 · compra 25/10 -> se aplica', fmtD(fechaAplicacion(d(25, 10, 2026), 24)), '1/11/2026');
caso('cierre 24 · compra 25/10 -> paga con sueldo de', label(mesPagoCredito(d(25, 10, 2026), 24)), 'Diciembre 2026');
caso('cierre 24 · compra 23/10 -> se aplica', fmtD(fechaAplicacion(d(23, 10, 2026), 24)), '23/10/2026');
caso('cierre 24 · compra 23/10 -> paga con sueldo de', label(mesPagoCredito(d(23, 10, 2026), 24)), 'Noviembre 2026');
// El mes de cierre sale de la fecha de aplicación y coincide con mesPagoCredito para cualquier día de cierre y de compra.
let distintos = 0;
for (let dia = 1; dia <= 31; dia++) {
  for (let t = new Date(2026, 0, 1); t < new Date(2028, 0, 1); t = new Date(t.getFullYear(), t.getMonth(), t.getDate() + 1)) {
    const ap = fechaAplicacion(t, dia);
    const pago = shiftMonthKey(ap.getFullYear() + '-' + ap.getMonth(), 1);
    if (pago !== mesPagoCredito(t, dia)) distintos++;
  }
}
caso('fecha de aplicación coincide con mesPagoCredito (días 1-31, 2026-2027)', String(distintos), '0');
const g = d(25, 10, 2026); const antesG = g.getTime(); fechaAplicacion(g, 24);
caso('fechaAplicacion no modifica la fecha de compra', g.getTime() === antesG ? 'igual' : 'modificada', 'igual');

assert.equal(fallos, 0, `${fallos} casos fallaron`);
console.log('\nTodos los casos pasaron.');
